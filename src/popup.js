/* Blockwave — popup */

import { CONFIG } from '../config.js';
import { PLATFORMS, handleFromProfileUrl, platformFromUrl } from './platforms.js';

/* Une exécution = une plateforme, celle de l'onglet actif. Le popup ne montre
 * donc jamais qu'une seule liste : celle du réseau sur lequel il a été ouvert. */
const runKey = (platform) => `blockwave:run:${platform}`;

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
  pause: document.getElementById('pause'),
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
  platform: document.getElementById('platform'),
};

const ORIGIN_LABEL = {
  remote: 'liste partagée',
  cache: 'cache local',
  fallback: 'liste de secours',
};

let state = null;
let platform = null;

/* ------------------------------------------------------------------ */

async function detectPlatform() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return platformFromUrl(tab?.url);
  } catch {
    /* activeTab non accordée */
    return null;
  }
}

function describeSource(source, doneCount = 0) {
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

  if (doneCount) {
    parts.push(`${doneCount} traité${doneCount > 1 ? 's' : ''}`);
  }

  parts.push(ORIGIN_LABEL[source.origin] ?? source.origin);
  if (when) parts.push(when);

  return parts.join(' · ');
}

function render() {
  const accounts = state?.accounts ?? [];
  const running = Boolean(state?.running);
  const busy = Boolean(state?.busy); // un autre réseau tourne déjà
  const paused = Boolean(state?.paused);
  const pausing = Boolean(state?.pausing);

  const todo = accounts.filter((account) => account.state !== 'done').length;

  el.start.disabled = !platform || running || busy || todo === 0;
  el.start.hidden = running;
  el.start.textContent = busy
    ? 'Blocage en cours…'
    : paused
      ? `Reprendre (${todo} comptes)`
      : todo
        ? `Bloquer les ${todo} comptes`
        : platform
          ? 'Tout est déjà traité'
          : 'Aucune plateforme';

  // Pendant un blocage, la pause remplace le bouton de lancement : il n'y a
  // jamais deux actions concurrentes à l'écran.
  el.pause.hidden = !running;
  el.pause.disabled = pausing;
  el.pause.textContent = pausing ? 'Pause en cours…' : 'Mettre en pause';

  el.reset.hidden = running || !state?.finishedAt;
  el.refresh.disabled = running;
  el.recheck.hidden = running || !state?.doneCount;
  refreshRecheckButton();
  el.addInput.disabled = running || !platform;
  el.addSubmit.disabled = running || !platform;
  el.source.textContent = platform
    ? describeSource(state?.source, state?.doneCount ?? 0)
    : 'plateforme non prise en charge';

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
/* « Revérifier » : confirmation en deux temps                        */
/* ------------------------------------------------------------------ */

/* Le clic vide le registre des comptes déjà traités de la plateforme : tous les
 * profils correspondants seront rouverts un par un au prochain lancement. Rien
 * ne part tout seul, mais l'action est coûteuse à défaire — d'où le second clic. */
const RECHECK_ARM_MS = 5000;

let recheckArmed = false;
let recheckTimer = null;
/* Message affiché avant l'armement (Supabase non configuré, erreur…) : il est
   restauré à l'annulation plutôt que perdu. */
let warningBackup = null;

function refreshRecheckButton() {
  const count = state?.doneCount ?? 0;

  el.recheck.dataset.armed = String(recheckArmed);
  el.recheck.textContent = recheckArmed
    ? 'Confirmer ?'
    : count
      ? `Revérifier (${count})`
      : 'Revérifier';
}

function disarmRecheck() {
  clearTimeout(recheckTimer);
  recheckTimer = null;

  if (!recheckArmed) return;
  recheckArmed = false;
  refreshRecheckButton();

  if (warningBackup) {
    el.warning.textContent = warningBackup;
    el.warning.hidden = false;
  } else {
    el.warning.hidden = true;
  }
  warningBackup = null;
}

function armRecheck() {
  warningBackup = el.warning.hidden ? null : el.warning.textContent;
  recheckArmed = true;
  refreshRecheckButton();

  const count = state?.doneCount ?? 0;
  const plural = count > 1 ? 's' : '';

  showWarning(
    `Revérifier oublie ${count} compte${plural} déjà traité${plural} sur ` +
      `${PLATFORMS[platform].label} : ils seront rouverts un par un au prochain ` +
      `blocage. Clique à nouveau sur « Confirmer ? » pour valider ` +
      `(annulation automatique dans ${RECHECK_ARM_MS / 1000} s).`,
  );

  clearTimeout(recheckTimer);
  recheckTimer = setTimeout(disarmRecheck, RECHECK_ARM_MS);
}

/* ------------------------------------------------------------------ */

async function load() {
  try {
    state = await chrome.runtime.sendMessage({ type: 'GET', platform });
  } catch {
    state = null;
  }
  render();
}

async function init() {
  platform = await detectPlatform();

  if (!platform) {
    render();
    showWarning(
      "Ouvre un onglet instagram.com ou facebook.com (connecté à ton compte), puis rouvre ce popup.",
    );
    return;
  }

  el.platform.textContent = PLATFORMS[platform].label;
  el.platform.hidden = false;

  await load();
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
    const handle = handleFromProfileUrl(tab?.url);
    if (!handle) return;

    el.addInput.value = handle;
    el.addInput.select();
  } catch {
    /* activeTab non accordée : on laisse le champ vide */
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !platform) return;

  const change = changes[runKey(platform)];
  if (!change) return;

  state = change.newValue;
  render();
});

el.start.addEventListener('click', async () => {
  el.warning.hidden = true;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || platformFromUrl(tab.url) !== platform) {
    showWarning(
      `Ouvre d'abord un onglet ${PLATFORMS[platform].label} (connecté à ton compte), puis relance.`,
    );
    return;
  }

  el.start.disabled = true;

  try {
    await chrome.runtime.sendMessage({ type: 'START', tabId: tab.id, platform });
  } catch (error) {
    showWarning(`Impossible de démarrer : ${error.message}`);
    el.start.disabled = false;
  }
});

el.reset.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'RESET', platform });
  el.warning.hidden = true;
});

el.recheck.addEventListener('click', async () => {
  if (!recheckArmed) {
    armRecheck();
    return;
  }

  disarmRecheck();
  el.recheck.disabled = true;

  try {
    const next = await chrome.runtime.sendMessage({ type: 'CLEAR_DONE', platform });
    if (next?.error) throw new Error(next.error);
    if (next?.ok === false) {
      throw new Error(next.reason === 'running' ? 'un blocage est en cours' : 'opération refusée');
    }
    state = next;
  } catch (error) {
    showWarning(`Réinitialisation impossible : ${error.message}`);
  }

  el.recheck.disabled = false;
  render();
});

el.pause.addEventListener('click', async () => {
  el.pause.disabled = true;
  el.warning.hidden = true;

  try {
    const result = await chrome.runtime.sendMessage({ type: 'PAUSE', platform });
    if (!result?.ok) {
      if (result?.reason === 'idle') {
        /* Le service worker ne connaît plus d'exécution : elle a été tuée avec
           le navigateur et l'état affiché est périmé. On remet tout à plat
           plutôt que de laisser un « en cours » impossible à arrêter. */
        await chrome.runtime.sendMessage({ type: 'RESET', platform });
        await load();
        showWarning(
          "Le blocage précédent avait été interrompu (navigateur fermé) : progression remise à plat.",
        );
      } else {
        showWarning('Pause impossible.');
        el.pause.disabled = false;
      }
    }
  } catch (error) {
    showWarning(`Pause impossible : ${error.message}`);
    el.pause.disabled = false;
  }
});

el.refresh.addEventListener('click', async () => {
  el.refresh.disabled = true;
  el.refresh.textContent = '…';

  try {
    const next = await chrome.runtime.sendMessage({ type: 'REFRESH', platform });
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

  if (!platform || !el.addInput.value.trim()) return;

  el.addSubmit.disabled = true;

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ADD_ACCOUNT',
      username: el.addInput.value,
      platform,
    });

    if (!result?.ok) {
      showAddMessage(
        result?.error === 'invalid'
          ? `Ce n'est pas un pseudo ${PLATFORMS[platform].label} valide.`
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
      platform,
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
