/* Blockwave — service worker
 *
 * Rôle : orchestrer le blocage, compte par compte.
 * Le service worker navigue dans l'onglet Instagram, puis demande au
 * content script de faire le travail DOM (menu « Options » → « Bloquer »).
 *
 * L'état est persisté dans chrome.storage.local pour que le popup puisse
 * se fermer sans interrompre le bot.
 */

import { CONFIG } from '../config.js';
import { normalizeHandle } from '../handles.js';

const HOME_URL = 'https://www.instagram.com/';
const STORAGE_KEY = 'blockwave:run';
const POOL_KEY = 'blockwave:pool';
const LOCAL_KEY = 'blockwave:local';
const DONE_KEY = 'blockwave:done';

/**
 * Liste de secours : utilisée seulement si Supabase est injoignable ET qu'aucun
 * cache n'existe. En temps normal la liste vient de la table `accounts`, qui
 * est la source de vérité (`supabase/seed.sql`, `supabase/migrations/`).
 *
 * Volontairement figée : c'est un amorçage dégradé pour une première
 * installation hors-ligne, pas un miroir de la base. Inutile de la compléter à
 * chaque ajout — elle n'a pas à suivre la liste collaborative.
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
  return data[POOL_KEY] ?? null;
}

/** Comptes ajoutés depuis le popup. Ils n'attendent aucune validation. */
async function readLocal() {
  const data = await chrome.storage.local.get(LOCAL_KEY);
  return Array.isArray(data[LOCAL_KEY]) ? data[LOCAL_KEY] : [];
}

async function writeLocal(usernames) {
  await chrome.storage.local.set({ [LOCAL_KEY]: usernames });
  return usernames;
}

/**
 * Registre des comptes déjà traités : { pseudo: timestamp }.
 * Évite de rouvrir un profil qu'on a déjà bloqué lors d'une exécution
 * précédente — c'est le principal gain de temps sur les relances.
 */
async function readDone() {
  const data = await chrome.storage.local.get(DONE_KEY);
  const value = data[DONE_KEY];
  return value && typeof value === 'object' ? value : {};
}

async function markDone(username) {
  const done = await readDone();
  if (done[username]) return done;

  done[username] = Date.now();
  await chrome.storage.local.set({ [DONE_KEY]: done });
  return done;
}

async function clearDone() {
  await chrome.storage.local.set({ [DONE_KEY]: {} });
}

/** Interroge Supabase. La RLS ne renvoie de toute façon que les approuvés. */
async function fetchRemotePool() {
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) return null;

  const base = CONFIG.supabaseUrl.replace(/\/+$/, '');
  const endpoint = `${base}/rest/v1/accounts?select=username&status=eq.approved&order=username.asc`;

  const response = await fetch(endpoint, {
    headers: {
      apikey: CONFIG.supabaseAnonKey,
      Authorization: `Bearer ${CONFIG.supabaseAnonKey}`,
    },
  });

  if (!response.ok) throw new Error(`Supabase a répondu ${response.status}`);

  const rows = await response.json();
  const usernames = [
    ...new Set(rows.map((row) => normalizeHandle(row.username)).filter(Boolean)),
  ];

  return usernames.length ? usernames : null;
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
      const pool = { usernames: remote, origin: 'remote', fetchedAt: Date.now() };
      await chrome.storage.local.set({ [POOL_KEY]: pool });
      return pool;
    }
  } catch (error) {
    console.warn('[Blockwave] liste distante indisponible :', error.message);
  }

  if (cached?.usernames?.length) {
    return { ...cached, origin: 'cache' };
  }

  return { usernames: FALLBACK_ACCOUNTS, origin: 'fallback', fetchedAt: null };
}

/**
 * Liste finale = ajouts locaux d'abord, puis liste partagée.
 * Les ajouts manuels passent devant : c'est ce que l'utilisateur vient de
 * demander, il veut le voir traité en premier.
 */
async function getPool(options) {
  const [local, remote, done] = await Promise.all([
    readLocal(),
    resolveRemote(options),
    readDone(),
  ]);

  return { ...remote, local, done };
}

function buildRun(pool) {
  const max = CONFIG.maxPerRun ?? 250;
  const local = pool.local ?? [];
  const done = pool.done ?? {};
  const localSet = new Set(local);
  const merged = [...new Set([...local, ...pool.usernames])];
  const planned = merged.slice(0, max);

  const accounts = planned.map((username) => ({
    username,
    url: `https://www.instagram.com/${username}/`,
    state: done[username] ? 'done' : 'pending',
    detail: done[username] ? 'Déjà bloqué par Blockwave.' : '',
    local: localSet.has(username),
  }));

  return {
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

async function readRun() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] ?? buildRun(await getPool());
}

async function writeRun(run) {
  await chrome.storage.local.set({ [STORAGE_KEY]: run });
  return run;
}

async function update(mutator) {
  const run = await readRun();
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
async function submitSuggestion(handle) {
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
      body: JSON.stringify({ username: handle, status: 'pending' }),
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

async function addAccount(username) {
  const handle = normalizeHandle(username);
  if (!handle) return { ok: false, error: 'invalid' };

  const local = await readLocal();
  const existed = local.includes(handle);

  if (!existed) {
    await writeLocal([handle, ...local]);
  }

  // Un compte déjà ajouté à la main a déjà été proposé : inutile de refaire
  // l'appel réseau et de se heurter au conflit d'unicité.
  const shareResult = existed ? null : await submitSuggestion(handle);

  if (!active) await writeRun(buildRun(await getPool()));

  return { ok: true, duplicate: existed, share: shareResult, run: await readRun() };
}

async function removeAccount(username) {
  const handle = normalizeHandle(username);
  if (!handle) return { ok: false, error: 'invalid' };

  const local = await readLocal();
  const next = local.filter((item) => item !== handle);

  if (next.length !== local.length) await writeLocal(next);
  if (!active) await writeRun(buildRun(await getPool()));

  return { ok: true, run: await readRun() };
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
      throw new Error("L'onglet Instagram a été fermé");
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

async function start(tabId) {
  if (active) return;

  const pool = await getPool();
  const fresh = buildRun(pool);

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
  fresh.running = true;
  fresh.startedAt = Date.now();
  fresh.message = 'Démarrage du bot…';
  await writeRun(fresh);

  const queue = fresh.accounts;

  try {
    for (let i = 0; i < queue.length; i++) {
      const account = queue[i];

      // Déjà bloqué lors d'une exécution précédente : on ne navigue même pas.
      if (account.state === 'done') continue;

      await update((run) => {
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

      await update((run) => {
        run.accounts[i].state = result.status || 'error';
        run.accounts[i].detail = result.detail || '';
        run.message = `@${account.username} — ${LABELS[result.status] || result.status}`;
      });

      // Le compte est bloqué (par nous ou déjà le cas) : on le mémorise pour
      // ne plus jamais rouvrir son profil lors des prochaines exécutions.
      if (result.status === 'blocked' || result.status === 'already') {
        await markDone(account.username);
      }

      if (result.status === 'login') {
        await update((run) => {
          for (let j = i + 1; j < run.accounts.length; j++) {
            run.accounts[j].state = 'skipped';
            run.accounts[j].detail = 'Session expirée';
          }
          run.message = 'Session Instagram expirée — reconnecte-toi puis relance.';
        });
        break;
      }

      if (i === queue.length - 1) break;

      const next = queue[i + 1].username;
      const long_ = Math.random() < PACING.longPauseChance;
      const pause = jitter(long_ ? PACING.longPause : PACING.betweenProfiles);

      await update((run) => {
        run.message = `Pause de ${Math.round(pause / 1000)} s avant @${next}…`;
      });

      await humanDelay(pause);
    }
  } finally {
    active = false;

    await update((run) => {
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
      await chrome.tabs.update(tabId, { url: HOME_URL });
    } catch {
      /* l'onglet a peut-être été fermé, sans importance */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Messages venant du popup                                           */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'START') {
    start(message.tabId).catch((error) => console.error('[Blockwave]', error));
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'ADD_ACCOUNT') {
    addAccount(message.username)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'REMOVE_ACCOUNT') {
    removeAccount(message.username)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'GET') {
    readRun().then(sendResponse);
    return true;
  }

  if (message?.type === 'REFRESH') {
    if (active) {
      readRun().then(sendResponse);
      return true;
    }
    getPool({ force: true })
      .then((pool) => writeRun(buildRun(pool)))
      .then(sendResponse)
      .catch((error) => sendResponse({ error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'CLEAR_DONE') {
    if (active) {
      sendResponse({ ok: false, reason: 'running' });
      return false;
    }
    clearDone()
      .then(() => getPool())
      .then((pool) => writeRun(buildRun(pool)))
      .then(sendResponse)
      .catch((error) => sendResponse({ error: String(error?.message || error) }));
    return true;
  }

  if (message?.type === 'RESET') {
    if (active) {
      sendResponse({ ok: false, reason: 'running' });
      return false;
    }
    getPool()
      .then((pool) => writeRun(buildRun(pool)))
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(async () => {
  await writeRun(buildRun(await getPool()));
});
