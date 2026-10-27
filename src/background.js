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

/**
 * Liste de secours : utilisée seulement si Supabase est injoignable ET qu'aucun
 * cache n'existe. En temps normal la liste vient de la table `accounts`.
 */
const FALLBACK_ACCOUNTS = [
  'jordanbardella',
  'marine_lepen',
  'edwige_diaz',
  'ericzemmour_',
  'sarahknafo1',
  'tanguyjeanphilippe',
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
};

/* Rythme du bot. Valeurs en millisecondes, tirées au hasard entre les bornes.
 * Augmente-les si tu veux quelque chose de (encore) plus lent et discret. */
const PACING = {
  /** Temps laissé à la page après le chargement avant de lancer le script. */
  pageSettle: [1200, 2300],
  /** Pause normale entre deux profils. */
  betweenProfiles: [2500, 5500],
  /** De temps en temps, une pause plus longue, comme quelqu'un qui s'interrompt. */
  longPauseChance: 0.2,
  longPause: [8000, 14000],
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
 * Quatre niveaux de repli, du plus frais au plus dégradé :
 *   cache frais → réseau → cache périmé → liste de secours.
 * L'extension doit rester utilisable même si Supabase est tombé.
 */
async function getPool({ force = false } = {}) {
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

function buildRun(pool) {
  const max = CONFIG.maxPerRun ?? 250;
  const planned = pool.usernames.slice(0, max);

  return {
    running: false,
    startedAt: null,
    finishedAt: null,
    current: null,
    message: 'Prêt.',
    source: {
      origin: pool.origin,
      fetchedAt: pool.fetchedAt,
      total: pool.usernames.length,
      planned: planned.length,
    },
    accounts: planned.map((username) => ({
      username,
      url: `https://www.instagram.com/${username}/`,
      state: 'pending',
      detail: '',
    })),
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
/* Navigation / messagerie                                            */
/* ------------------------------------------------------------------ */

async function navigateAndWait(tabId, url, timeout = 45000) {
  await chrome.tabs.update(tabId, { url });
  const startedAt = Date.now();
  await sleep(800);

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
    if (tab.status === 'complete' && Date.now() - startedAt > 1200) return;
    await sleep(300);
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

  active = true;
  fresh.running = true;
  fresh.startedAt = Date.now();
  fresh.message = 'Démarrage du bot…';
  await writeRun(fresh);

  const queue = fresh.accounts;

  try {
    for (let i = 0; i < queue.length; i++) {
      const account = queue[i];

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
      run.message = `Terminé — ${blocked} bloqué(s), ${already} déjà bloqué(s).`;
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
