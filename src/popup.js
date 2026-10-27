/* Blockwave — popup */

import { CONFIG } from '../config.js';

const STORAGE_KEY = 'blockwave:run';

const LABELS = {
  pending: 'attente',
  working: 'en cours',
  blocked: 'bloqué',
  already: 'déjà',
  notfound: 'introuvable',
  login: 'session',
  error: 'échec',
  skipped: 'ignoré',
};

const el = {
  start: document.getElementById('start'),
  reset: document.getElementById('reset'),
  refresh: document.getElementById('refresh'),
  source: document.getElementById('source'),
  list: document.getElementById('list'),
  status: document.getElementById('status'),
  warning: document.getElementById('warning'),
};

const ORIGIN_LABEL = {
  remote: 'liste partagée',
  cache: 'cache local',
  fallback: 'liste de secours',
};

let state = null;

/* ------------------------------------------------------------------ */

function isInstagramUrl(url) {
  return /^https:\/\/([a-z0-9-]+\.)?instagram\.com\//i.test(url || '');
}

function describeSource(source) {
  if (!source) return 'liste non chargée';

  const count =
    source.planned < source.total
      ? `${source.planned}/${source.total}`
      : `${source.total}`;

  const when = source.fetchedAt
    ? new Date(source.fetchedAt).toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return [
    `${count} comptes`,
    ORIGIN_LABEL[source.origin] ?? source.origin,
    when,
  ]
    .filter(Boolean)
    .join(' · ');
}

function render() {
  const accounts = state?.accounts ?? [];
  const running = Boolean(state?.running);

  const count = accounts.length;

  el.start.disabled = running || count === 0;
  el.start.textContent = running
    ? 'Blocage en cours…'
    : count
      ? `Bloquer les ${count} comptes`
      : 'Bloquer les comptes';

  el.reset.hidden = running || !state?.finishedAt;
  el.refresh.disabled = running;
  el.source.textContent = describeSource(state?.source);

  el.list.replaceChildren(
    ...accounts.map((account) => {
      const item = document.createElement('li');
      item.className = 'item';
      item.dataset.state = account.state;
      if (account.detail) item.title = account.detail;

      const name = document.createElement('span');
      name.className = 'item-name';
      name.textContent = `@${account.username}`;

      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = LABELS[account.state] ?? account.state;

      item.append(name, pill);
      return item;
    }),
  );

  el.status.textContent = state?.message ?? 'Prêt.';
}

function showWarning(text) {
  el.warning.textContent = text;
  el.warning.hidden = false;
}

/* ------------------------------------------------------------------ */

async function init() {
  try {
    state = await chrome.runtime.sendMessage({ type: 'GET' });
  } catch {
    state = null;
  }
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STORAGE_KEY]) return;
  state = changes[STORAGE_KEY].newValue;
  render();
});

el.start.addEventListener('click', async () => {
  el.warning.hidden = true;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !isInstagramUrl(tab.url)) {
    showWarning(
      "Ouvre d'abord un onglet instagram.com (connecté à ton compte), puis relance.",
    );
    return;
  }

  el.start.disabled = true;

  try {
    await chrome.runtime.sendMessage({ type: 'START', tabId: tab.id });
  } catch (error) {
    showWarning(`Impossible de démarrer : ${error.message}`);
    el.start.disabled = false;
  }
});

el.reset.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'RESET' });
  el.warning.hidden = true;
});

el.refresh.addEventListener('click', async () => {
  el.refresh.disabled = true;
  el.refresh.textContent = '…';

  try {
    const next = await chrome.runtime.sendMessage({ type: 'REFRESH' });
    if (next?.error) throw new Error(next.error);
    state = next;
  } catch (error) {
    showWarning(`Actualisation impossible : ${error.message}`);
  }

  el.refresh.textContent = 'Actualiser';
  render();
});

if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) {
  showWarning(
    "Supabase n'est pas configuré : l'extension utilise la liste de secours." +
      ' Renseigne supabaseUrl et supabaseAnonKey dans config.js.',
  );
}

init();
