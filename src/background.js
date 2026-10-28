/* Blockwave — service worker
 *
 * Rôle : orchestrer le blocage, compte par compte, sur la plateforme de
 * l'onglet piloté. Le service worker navigue d'un profil à l'autre, puis
 * demande au content script du réseau concerné de faire le travail DOM
 * (menu « … » → « Bloquer »).
 *
 * L'état est persisté dans chrome.storage.local pour que le popup puisse
 * se fermer sans interrompre le bot.
 */

import { CONFIG } from '../config.js';
import { normalizeHandle } from '../handles.js';
import { PLATFORMS, PLATFORM_IDS, isPlatform } from './platforms.js';

/* Une exécution ne concerne qu'une seule plateforme : celle de l'onglet depuis
 * lequel le popup a été ouvert. Les états sont donc rangés par plateforme —
 * sans quoi ouvrir le popup sur Facebook écraserait la progression Instagram. */
const STORAGE_VERSION = 2;
const VERSION_KEY = 'blockwave:version';
const POOL_KEY = 'blockwave:pool';
const DONE_KEY = 'blockwave:done';

const runKey = (platform) => `blockwave:run:${platform}`;
const localKey = (platform) => `blockwave:local:${platform}`;
const doneKey = (platform, username) => `${platform}:${username}`;

/**
 * Liste de secours : utilisée seulement si Supabase est injoignable ET qu'aucun
 * cache n'existe. En temps normal la liste vient de la table `accounts`, qui
 * est la source de vérité (`supabase/seed.sql`, `supabase/migrations/`).
 *
 * Volontairement figée et limitée à Instagram : c'est un amorçage dégradé pour
 * une première installation hors-ligne, pas un miroir de la base. Inutile de la
 * compléter à chaque ajout — elle n'a pas à suivre la liste collaborative.
 */
const FALLBACK_ACCOUNTS = [
  'ericzemmour_',
  'edwige_diaz',
  'marine_lepen',
  'vincentfou12',
  'auroreberge.fr',
  'voxpopuli988',
  'va_plus',
  'jordanflorentin_',
  'lucasfourcadeoffi',
  'alice_cordier_',
  'yona.faedda',
  'vincent.lapierre',
  'hugonemesisdeux',
  'tanguyjeanphilippe',
  'julien_odoul',
  'collectif.nemesis',
  'sarahknafo1',
  'frontieresmedia',
  'jordanbardella',
  'cnews',
  'mc_pao',
  'le___carlito',
  'impact33news',
];

const LABELS = {
  pending: 'en attente',
  working: 'en cours',
  blocked: 'bloqué',
  already: 'déjà bloqué',
  notfound: 'profil introuvable',
  login: 'session expirée',
  error: 'échec',
  skipped: 'ignoré',
  done: 'déjà traité',
};

/* Rythme du bot. Valeurs en millisecondes, tirées au hasard entre les bornes.
 * Augmente-les si tu veux quelque chose de (encore) plus lent et discret. */
const PACING = {
  /** Temps laissé à la page après le chargement avant de lancer le script. */
  pageSettle: [600, 1200],
  /** Pause normale entre deux profils. */
  betweenProfiles: [800, 2000],
  /** De temps en temps, une pause plus longue, comme quelqu'un qui s'interrompt. */
  longPauseChance: 0.15,
  longPause: [4000, 7000],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rand = (min, max) => min + Math.random() * (max - min);
const jitter = ([min, max]) => rand(min, max);

/**
 * Sommeil long découpé en tranches : chaque appel d'API extension remet à zéro
 * le compteur d'inactivité du service worker (sinon il est tué au bout de 30 s).
 */
async function humanDelay(ms) {
  let remaining = ms;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 4000);
    await sleep(chunk);
    remaining -= chunk;
    await chrome.runtime.getPlatformInfo().catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* Liste collaborative (Supabase, lecture seule côté extension)       */
/* ------------------------------------------------------------------ */

async function readPoolCache() {
  const data = await chrome.storage.local.get(POOL_KEY);
  const cached = data[POOL_KEY];
  /* Le cache d'avant la v2 ne contenait qu'une liste de pseudos, sans
   * plateforme : il est ignoré et reconstruit au premier passage réseau. */
  return Array.isArray(cached?.rows) ? cached : null;
}

/** Comptes ajoutés depuis le popup, pour cette plateforme. */
async function readLocal(platform) {
  const data = await chrome.storage.local.get(localKey(platform));
  const value = data[localKey(platform)];
  return Array.isArray(value) ? value : [];
}

async function writeLocal(platform, usernames) {
  await chrome.storage.local.set({ [localKey(platform)]: usernames });
  return usernames;
}

/**
 * Registre des comptes déjà traités : { "instagram:marine_lepen": timestamp }.
 * La clé porte la plateforme, sinon bloquer « marine_lepen » sur Instagram
 * ferait sauter son homonyme Facebook — deux personnes différentes.
 */
async function readDone() {
  const data = await chrome.storage.local.get(DONE_KEY);
  const value = data[DONE_KEY];
  return value && typeof value === 'object' ? value : {};
}

async function markDone(platform, username) {
  const done = await readDone();
  const key = doneKey(platform, username);
  if (done[key]) return done;

  done[key] = Date.now();
  await chrome.storage.local.set({ [DONE_KEY]: done });
  return done;
}

/** Oublie les comptes traités d'une seule plateforme. */
async function clearDone(platform) {
  const done = await readDone();
  const prefix = `${platform}:`;
  const next = Object.fromEntries(
    Object.entries(done).filter(([key]) => !key.startsWith(prefix)),
  );
  await chrome.storage.local.set({ [DONE_KEY]: next });
}

/** Interroge Supabase. La RLS ne renvoie de toute façon que les approuvés. */
async function fetchRemotePool() {
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) return null;

  const base = CONFIG.supabaseUrl.replace(/\/+$/, '');
  const endpoint = `${base}/rest/v1/accounts?select=platform,username&status=eq.approved&order=platform.asc,username.asc`;

  const response = await fetch(endpoint, {
    headers: {
      apikey: CONFIG.supabaseAnonKey,
      Authorization: `Bearer ${CONFIG.supabaseAnonKey}`,
    },
  });

  if (!response.ok) throw new Error(`Supabase a répondu ${response.status}`);

  const data = await response.json();

  /* Une plateforme inconnue de cette version de l'extension (ajoutée en base
   * après coup) est ignorée plutôt que de casser la liste entière. */
  const seen = new Set();
  const rows = [];

  for (const row of data) {
    const platform = isPlatform(row.platform) ? row.platform : null;
    const username = normalizeHandle(row.username);
    if (!platform || !username) continue;

    const key = doneKey(platform, username);
    if (seen.has(key)) continue;

    seen.add(key);
    rows.push({ platform, username });
  }

  return rows.length ? rows : null;
}

/**
 * Résout la liste distante. Quatre niveaux de repli, du plus frais au plus
 * dégradé : cache frais → réseau → cache périmé → liste de secours.
 * L'extension doit rester utilisable même si Supabase est tombé.
 */
async function resolveRemote({ force = false } = {}) {
  const ttl = CONFIG.listTtlMs ?? 6 * 60 * 60 * 1000;
  const cached = await readPoolCache();

  if (cached && !force && Date.now() - cached.fetchedAt < ttl) {
    return cached;
  }

  try {
    const remote = await fetchRemotePool();
    if (remote) {
      const pool = { rows: remote, origin: 'remote', fetchedAt: Date.now() };
      await chrome.storage.local.set({ [POOL_KEY]: pool });
      return pool;
    }
  } catch (error) {
    console.warn('[Blockwave] liste distante indisponible :', error.message);
  }

  if (cached?.rows?.length) {
    return { ...cached, origin: 'cache' };
  }

  return {
    rows: FALLBACK_ACCOUNTS.map((username) => ({ platform: 'instagram', username })),
    origin: 'fallback',
    fetchedAt: null,
  };
}

/**
 * Liste finale pour une plateforme = ajouts locaux d'abord, puis liste
 * partagée. Les ajouts manuels passent devant : c'est ce que l'utilisateur
 * vient de demander, il veut le voir traité en premier.
 */
async function getPool(platform, options) {
  const [local, remote, done] = await Promise.all([
    readLocal(platform),
    resolveRemote(options),
    readDone(),
  ]);

  return { ...remote, local, done };
}

function buildRun(pool, platform) {
  const max = CONFIG.maxPerRun ?? 250;
  const local = pool.local ?? [];
  const done = pool.done ?? {};
  const localSet = new Set(local);

  const shared = (pool.rows ?? [])
    .filter((row) => row.platform === platform)
    .map((row) => row.username);

  const merged = [...new Set([...local, ...shared])];
  const planned = merged.slice(0, max);

  const accounts = planned.map((username) => {
    const already = Boolean(done[doneKey(platform, username)]);

    return {
      username,
      platform,
      url: PLATFORMS[platform].profileUrl(username),
      state: already ? 'done' : 'pending',
      detail: already ? 'Déjà bloqué par Blockwave.' : '',
      local: localSet.has(username),
    };
  });

  return {
    platform,
    running: false,
    startedAt: null,
    finishedAt: null,
    current: null,
    message: 'Prêt.',
    source: {
      origin: pool.origin,
      fetchedAt: pool.fetchedAt,
      total: merged.length,
      planned: planned.length,
      local: accounts.filter((account) => account.local).length,
      done: accounts.filter((account) => account.state === 'done').length,
    },
    accounts,
  };
}

async function readRun(platform) {
  const key = runKey(platform);
  const data = await chrome.storage.local.get(key);
  return data[key] ?? buildRun(await getPool(platform), platform);
}

async function writeRun(run) {
  await chrome.storage.local.set({ [runKey(run.platform)]: run });
  return run;
}

async function update(platform, mutator) {
  const run = await readRun(platform);
  mutator(run);
  return writeRun(run);
}

/* ------------------------------------------------------------------ */
/* Ajout / retrait depuis le popup                                    */
/* ------------------------------------------------------------------ */

/**
 * Envoie une proposition à la liste partagée. Elle part forcément en
 * `pending` : la politique RLS d'insertion refuse tout autre statut.
 */
async function submitSuggestion(handle, platform) {
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) {
    return { shared: false, reason: 'Supabase non configuré' };
  }

  const base = CONFIG.supabaseUrl.replace(/\/+$/, '');

  try {
    const response = await fetch(`${base}/rest/v1/accounts`, {
      method: 'POST',
      headers: {
        apikey: CONFIG.supabaseAnonKey,
        Authorization: `Bearer ${CONFIG.supabaseAnonKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ username: handle, platform, status: 'pending' }),
    });

    if (response.status === 409) return { shared: true, duplicate: true };

    if (!response.ok) {
      let reason = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        reason = body.message || reason;
      } catch {
        /* corps non JSON, on garde le code HTTP */
      }
      return { shared: false, reason };
    }

    return { shared: true };
  } catch (error) {
    return { shared: false, reason: String(error?.message || error) };
  }
}

async function addAccount(username, platform) {
  const handle = normalizeHandle(username);
  /* Un segment d'URL comme « profile.php » passe le format mais n'est pas un
   * profil : c'est la liste de réservés de la plateforme qui tranche. */
  if (!handle || !isPlatform(platform) || PLATFORMS[platform].reserved.has(handle)) {
    return { ok: false, error: 'invalid' };
  }

  const local = await readLocal(platform);
  const existed = local.includes(handle);

  if (!existed) {
    await writeLocal(platform, [handle, ...local]);
  }

  // Un compte déjà ajouté à la main a déjà été proposé : inutile de refaire
  // l'appel réseau et de se heurter au conflit d'unicité.
  const shareResult = existed ? null : await submitSuggestion(handle, platform);

  if (!active) await writeRun(buildRun(await getPool(platform), platform));

  return { ok: true, duplicate: existed, share: shareResult, run: await readRun(platform) };
}

async function removeAccount(username, platform) {
  const handle = normalizeHandle(username);
  if (!handle) return { ok: false, error: 'invalid' };

  const local = await readLocal(platform);
  const next = local.filter((item) => item !== handle);

  if (next.length !== local.length) await writeLocal(platform, next);
  if (!active) await writeRun(buildRun(await getPool(platform), platform));

  return { ok: true, run: await readRun(platform) };
}

/* ------------------------------------------------------------------ */
/* Navigation / messagerie                                            */
/* ------------------------------------------------------------------ */

async function navigateAndWait(tabId, url, timeout = 45000) {
  await chrome.tabs.update(tabId, { url });
  const startedAt = Date.now();
  await sleep(400);

  for (;;) {
    if (Date.now() - startedAt > timeout) {
      throw new Error('Délai de chargement dépassé');
    }
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      throw new Error("L'onglet a été fermé");
    }
    if (tab.status === 'complete' && Date.now() - startedAt > 600) return;
    await sleep(200);
  }
}

async function ask(tabId, message, attempts = 12) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      if (response) return response;
    } catch (error) {
      lastError = error;
    }
    await sleep(400);
  }
  throw new Error(
    `Communication impossible avec la page (${lastError?.message || 'raison inconnue'})`,
  );
}

/* ------------------------------------------------------------------ */
/* Boucle principale                                                  */
/* ------------------------------------------------------------------ */

let active = false;
let activePlatform = null;

async function start(tabId, platform) {
  if (active || !isPlatform(platform)) return;

  const pool = await getPool(platform);
  const fresh = buildRun(pool, platform);

  if (!fresh.accounts.length) {
    fresh.message = 'Liste vide — ajoute des comptes avant de lancer.';
    await writeRun(fresh);
    return;
  }

  if (!fresh.accounts.some((account) => account.state !== 'done')) {
    fresh.message = 'Tous les comptes sont déjà traités. Utilise « Revérifier » pour les recontrôler.';
    await writeRun(fresh);
    return;
  }

  active = true;
  activePlatform = platform;
  fresh.running = true;
  fresh.startedAt = Date.now();
  fresh.message = `Démarrage du bot ${PLATFORMS[platform].label}…`;
  await writeRun(fresh);

  const queue = fresh.accounts;

  try {
    for (let i = 0; i < queue.length; i++) {
      const account = queue[i];

      // Déjà bloqué lors d'une exécution précédente : on ne navigue même pas.
      if (account.state === 'done') continue;

      await update(platform, (run) => {
        run.current = i;
        run.accounts[i].state = 'working';
        run.message = `Ouverture de @${account.username}…`;
      });

      let result;
      try {
        await navigateAndWait(tabId, account.url);
        // La page vient de s'afficher : on laisse le temps de « la regarder ».
        await humanDelay(jitter(PACING.pageSettle));
        result = await ask(tabId, { type: 'BLOCKWAVE_BLOCK' });
      } catch (error) {
        result = { status: 'error', detail: String(error?.message || error) };
      }

      await update(platform, (run) => {
        run.accounts[i].state = result.status || 'error';
        run.accounts[i].detail = result.detail || '';
        run.message = `@${account.username} — ${LABELS[result.status] || result.status}`;
      });

      // Le compte est bloqué (par nous ou déjà le cas) : on le mémorise pour
      // ne plus jamais rouvrir son profil lors des prochaines exécutions.
      if (result.status === 'blocked' || result.status === 'already') {
        await markDone(platform, account.username);
      }

      if (result.status === 'login') {
        await update(platform, (run) => {
          for (let j = i + 1; j < run.accounts.length; j++) {
            run.accounts[j].state = 'skipped';
            run.accounts[j].detail = 'Session expirée';
          }
          run.message = `Session ${PLATFORMS[platform].label} expirée — reconnecte-toi puis relance.`;
        });
        break;
      }

      if (i === queue.length - 1) break;

      const next = queue[i + 1].username;
      const long_ = Math.random() < PACING.longPauseChance;
      const pause = jitter(long_ ? PACING.longPause : PACING.betweenProfiles);

      await update(platform, (run) => {
        run.message = `Pause de ${Math.round(pause / 1000)} s avant @${next}…`;
      });

      await humanDelay(pause);
    }
  } finally {
    active = false;
    activePlatform = null;

    await update(platform, (run) => {
      run.running = false;
      run.current = null;
      run.finishedAt = Date.now();
      const blocked = run.accounts.filter((a) => a.state === 'blocked').length;
      const already = run.accounts.filter((a) => a.state === 'already').length;
      const skipped = run.accounts.filter((a) => a.state === 'done').length;

      run.message =
        `Terminé — ${blocked} bloqué(s), ${already} déjà bloqué(s)` +
        (skipped ? `, ${skipped} ignoré(s)` : '') +
        '.';
    });

    try {
      await chrome.tabs.update(tabId, { url: PLATFORMS[platform].homeUrl });
    } catch {
      /* l'onglet a peut-être été fermé, sans importance */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Messages venant du popup                                           */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const platform = message?.platform;

  if (message?.type === 'START') {
    if (!isPlatform(platform)) {
      sendResponse({ ok: false, error: 'unsupported' });
      return false;
    }
    start(message.tabId, platform).catch((error) => console.error('[Blockwave]', error));
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'ADD_ACCOUNT') {
    addAccount(message.username, platform)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'REMOVE_ACCOUNT') {
    removeAccount(message.username, platform)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'GET') {
    if (!isPlatform(platform)) {
      sendResponse({ unsupported: true });
      return false;
    }

    readRun(platform)
      .then((run) => sendResponse({ ...run, busy: active && activePlatform !== platform }))
      .catch((error) => sendResponse({ error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'REFRESH') {
    if (!isPlatform(platform)) {
      sendResponse({ error: 'unsupported' });
      return false;
    }
    if (active) {
      readRun(platform).then(sendResponse);
      return true;
    }
    getPool(platform, { force: true })
      .then((pool) => writeRun(buildRun(pool, platform)))
      .then(sendResponse)
      .catch((error) => sendResponse({ error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'CLEAR_DONE') {
    if (!isPlatform(platform)) {
      sendResponse({ error: 'unsupported' });
      return false;
    }
    if (active) {
      sendResponse({ ok: false, reason: 'running' });
      return false;
    }
    clearDone(platform)
      .then(() => getPool(platform))
      .then((pool) => writeRun(buildRun(pool, platform)))
      .then(sendResponse)
      .catch((error) => sendResponse({ error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'RESET') {
    if (!isPlatform(platform)) {
      sendResponse({ error: 'unsupported' });
      return false;
    }
    if (active) {
      sendResponse({ ok: false, reason: 'running' });
      return false;
    }
    getPool(platform)
      .then((pool) => writeRun(buildRun(pool, platform)))
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

/* ------------------------------------------------------------------ */
/* Migration depuis la version mono-plateforme                        */
/* ------------------------------------------------------------------ */

/**
 * Avant la v2, tout était indexé par pseudo seul. Sans cette reprise, les
 * comptes ajoutés à la main et le registre des comptes déjà traités seraient
 * perdus au moment de la mise à jour — c'est-à-dire l'essentiel du travail
 * déjà effectué par l'utilisateur.
 */
async function migrateStorage() {
  const stored = await chrome.storage.local.get(VERSION_KEY);
  if ((stored[VERSION_KEY] ?? 1) >= STORAGE_VERSION) return;

  const legacy = await chrome.storage.local.get([
    'blockwave:local',
    'blockwave:done',
    'blockwave:run',
  ]);

  const local = Array.isArray(legacy['blockwave:local']) ? legacy['blockwave:local'] : [];
  if (local.length) {
    await chrome.storage.local.set({ [localKey('instagram')]: local });
  }

  const done = legacy['blockwave:done'];
  if (done && typeof done === 'object') {
    const migrated = Object.fromEntries(
      Object.entries(done).map(([username, at]) => [doneKey('instagram', username), at]),
    );
    await chrome.storage.local.set({ [DONE_KEY]: migrated });
  }

  // Le cache de liste et le run mono-plateforme ne sont plus lisibles.
  await chrome.storage.local.remove(['blockwave:local', 'blockwave:done', 'blockwave:run', POOL_KEY]);
  await chrome.storage.local.set({ [VERSION_KEY]: STORAGE_VERSION });
}

chrome.runtime.onInstalled.addListener(async () => {
  await migrateStorage();
  await Promise.all(
    PLATFORM_IDS.map(async (platform) => {
      await writeRun(buildRun(await getPool(platform), platform));
    }),
  );
});
