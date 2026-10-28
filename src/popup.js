/* Blockwave — popup */

import { CONFIG } from '../config.js';
import { handleFromUrl } from '../handles.js';

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
  done: 'traité',
};

const el = {
  start: document.getElementById('start'),
  reset: document.getElementById('reset'),
  refresh: document.getElementById('refresh'),
  recheck: document.getElementById('recheck'),
  source: document.getElementById('source'),
  addForm: document.getElementById('add-form'),
  addInput: document.getElementById('add-input'),
  addSubmit: document.getElementById('add-submit'),
  addMessage: document.getElementById('add-message'),
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

  const parts = [`${count} comptes`];

  if (source.local) {
    parts.push(`${source.local} ajout${source.local > 1 ? 's' : ''}`);
  }

  if (source.done) {
    parts.push(`${source.done} traité${source.done > 1 ? 's' : ''}`);
  }

  parts.push(ORIGIN_LABEL[source.origin] ?? source.origin);
  if (when) parts.push(when);

  return parts.join(' · ');
}

function render() {
  const accounts = state?.accounts ?? [];
  const running = Boolean(state?.running);

  const todo = accounts.filter((account) => account.state !== 'done').length;

  el.start.disabled = running || todo === 0;
  el.start.textContent = running
    ? 'Blocage en cours…'
    : todo
      ? `Bloquer les ${todo} comptes`
      : 'Tout est déjà traité';

  el.reset.hidden = running || !state?.finishedAt;
  el.refresh.disabled = running;
  el.recheck.hidden = running || !state?.source?.done;
  el.addInput.disabled = running;
  el.addSubmit.disabled = running;
  el.source.textContent = describeSource(state?.source);

  // Remplacer les enfants peut remettre le défilement à zéro : on le restaure.
  const previousScroll = el.list.scrollTop;

  el.list.replaceChildren(
    ...accounts.map((account) => {
      const item = document.createElement('li');
      item.className = 'item';
      item.dataset.state = account.state;
      if (account.detail) item.title = account.detail;

      const name = document.createElement('span');
      name.className = 'item-name';
      name.textContent = `@${account.username}`;
      if (account.local) name.dataset.local = 'true';

      const right = document.createElement('span');
      right.className = 'item-right';

      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = LABELS[account.state] ?? account.state;
      right.append(pill);

      if (account.local) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.title = 'Retirer de ma liste';
        remove.setAttribute('aria-label', `Retirer @${account.username}`);
        remove.textContent = '×';
        remove.addEventListener('click', () => removeAccount(account.username));
        right.append(remove);
      }

      item.append(name, right);
      return item;
    }),
  );

  el.list.scrollTop = previousScroll;
  keepActiveVisible();
  el.status.textContent = state?.message ?? 'Prêt.';
}

/**
 * Garde le compte en cours dans la zone visible, et seulement s'il en est sorti :
 * scroller à chaque rendu ferait sauter la liste sous le curseur.
 */
function keepActiveVisible() {
  const item = el.list.querySelector('[data-state="working"]');
  if (!item) return;

  const listBox = el.list.getBoundingClientRect();
  const itemBox = item.getBoundingClientRect();

  const above = itemBox.top < listBox.top;
  const below = itemBox.bottom > listBox.bottom;
  if (!above && !below) return;

  const target =
    el.list.scrollTop +
    (itemBox.top - listBox.top) -
    (el.list.clientHeight - itemBox.height) / 2;

  el.list.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
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
  await prefillFromActiveTab();
}

/**
 * Si l'utilisateur est sur un profil, on met le pseudo dans le champ et on le
 * sélectionne : ouvrir le popup puis appuyer sur Entrée suffit à ajouter le
 * compte qu'il est en train de regarder.
 */
async function prefillFromActiveTab() {
  if (el.addInput.value) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const handle = handleFromUrl(tab?.url);
    if (!handle) return;

    el.addInput.value = handle;
    el.addInput.select();
  } catch {
    /* activeTab non accordée : on laisse le champ vide */
  }
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

el.recheck.addEventListener('click', async () => {
  el.recheck.disabled = true;

  try {
    const next = await chrome.runtime.sendMessage({ type: 'CLEAR_DONE' });
    if (next?.error) throw new Error(next.error);
    state = next;
  } catch (error) {
    showWarning(`Réinitialisation impossible : ${error.message}`);
  }

  el.recheck.disabled = false;
  render();
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

/* ------------------------------------------------------------------ */
/* Ajout manuel                                                       */
/* ------------------------------------------------------------------ */

function showAddMessage(text, isError) {
  el.addMessage.textContent = text;
  el.addMessage.dataset.error = String(Boolean(isError));
  el.addMessage.hidden = false;
}

el.addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  el.addMessage.hidden = true;

  if (!el.addInput.value.trim()) return;

  el.addSubmit.disabled = true;

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ADD_ACCOUNT',
      username: el.addInput.value,
    });

    if (!result?.ok) {
      showAddMessage(
        result?.error === 'invalid'
          ? "Ce n'est pas un pseudo Instagram valide."
          : result?.error || 'Ajout impossible.',
        true,
      );
      return;
    }

    state = result.run;
    el.addInput.value = '';
    render();

    if (result.duplicate) {
      showAddMessage('Déjà dans ta liste.', false);
    } else if (result.share && result.share.shared === false) {
      showAddMessage(`Ajouté, mais le partage a échoué : ${result.share.reason}`, true);
    } else if (result.share?.duplicate) {
      showAddMessage('Ajouté · déjà présent dans la liste partagée.', false);
    } else {
      showAddMessage('Ajouté · proposition envoyée pour validation.', false);
    }
  } catch (error) {
    showAddMessage(`Ajout impossible : ${error.message}`, true);
  } finally {
    el.addSubmit.disabled = false;
  }
});

async function removeAccount(username) {
  el.addMessage.hidden = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'REMOVE_ACCOUNT',
      username,
    });
    if (result?.run) state = result.run;
  } catch (error) {
    showAddMessage(`Retrait impossible : ${error.message}`, true);
  }
}

if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) {
  showWarning(
    "Supabase n'est pas configuré : l'extension utilise la liste de secours." +
      ' Renseigne supabaseUrl et supabaseAnonKey dans config.js.',
  );
}

init();
