/* Blockwave — console de modération
 *
 * Auth : lien magique Supabase (aucun mot de passe stocké nulle part).
 * Autorisation : la fonction SQL is_admin() + les politiques RLS. Cette page
 * n'est qu'une interface : même en la modifiant, on ne peut pas écrire sans
 * être dans la table `admins`.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CONFIG } from '../config.js';

const el = {
  warning: document.getElementById('warning'),
  login: document.getElementById('login'),
  loginForm: document.getElementById('login-form'),
  loginEmail: document.getElementById('email'),
  loginSubmit: document.getElementById('login-submit'),
  loginMessage: document.getElementById('login-message'),
  dashboard: document.getElementById('dashboard'),
  who: document.getElementById('who'),
  signout: document.getElementById('signout'),
  queue: document.getElementById('queue'),
  empty: document.getElementById('empty'),
  counts: {
    pending: document.getElementById('count-pending'),
    approved: document.getElementById('count-approved'),
    rejected: document.getElementById('count-rejected'),
  },
};

const TABS = ['pending', 'approved', 'rejected'];
const STATUS_LABEL = { pending: 'en attente', approved: 'approuvé', rejected: 'rejeté' };

const configured = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
const supabase = configured
  ? createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey)
  : null;

let session = null;
let currentTab = 'pending';
let rows = [];

/* ------------------------------------------------------------------ */

function warn(message) {
  el.warning.textContent = message;
  el.warning.hidden = false;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ------------------------------------------------------------------ */
/* Connexion                                                          */
/* ------------------------------------------------------------------ */

async function signIn(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname },
  });

  if (error) {
    warn(error.message);
    return;
  }

  el.loginMessage.textContent =
    'Lien envoyé. Ouvre-le depuis ce navigateur pour te connecter.';
  el.loginMessage.hidden = false;
}

el.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  el.warning.hidden = true;

  const email = el.loginEmail.value.trim();
  if (!email) return;

  el.loginSubmit.disabled = true;
  el.loginSubmit.textContent = 'Envoi…';

  await signIn(email);

  el.loginSubmit.disabled = false;
  el.loginSubmit.textContent = 'Recevoir le lien';
});

el.signout.addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.reload();
});

/* ------------------------------------------------------------------ */
/* Chargement                                                         */
/* ------------------------------------------------------------------ */

async function loadRows() {
  const { data, error } = await supabase
    .from('accounts')
    .select('id, username, status, reason, created_at, reviewed_at')
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error) {
    warn(error.message);
    return;
  }

  rows = data;
  render();
}

function render() {
  for (const tab of TABS) {
    el.counts[tab].textContent = String(
      rows.filter((row) => row.status === tab).length,
    );
  }

  const visible = rows.filter((row) => row.status === currentTab);
  el.empty.hidden = visible.length > 0;

  el.queue.replaceChildren(
    ...visible.map((row) => {
      const li = document.createElement('li');
      li.className = 'row';

      const main = document.createElement('div');
      main.className = 'row-main';

      const name = document.createElement('div');
      name.className = 'row-name';
      const link = document.createElement('a');
      link.href = `https://www.instagram.com/${encodeURIComponent(row.username)}/`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `@${row.username}`;
      name.append(link);

      const meta = document.createElement('p');
      meta.className = 'row-meta';
      meta.textContent = [
        `Proposé le ${formatDate(row.created_at)}`,
        row.reason ? `« ${row.reason} »` : null,
        row.reviewed_at ? `· ${STATUS_LABEL[row.status]} le ${formatDate(row.reviewed_at)}` : null,
      ]
        .filter(Boolean)
        .join(' ');

      main.append(name, meta);

      const actions = document.createElement('div');
      actions.className = 'row-actions';

      if (row.status !== 'approved') {
        actions.append(
          actionButton('Approuver', 'ok', () => setStatus(row.id, 'approved')),
        );
      }
      if (row.status !== 'rejected') {
        actions.append(
          actionButton('Rejeter', 'no', () => setStatus(row.id, 'rejected')),
        );
      }

      li.append(main, actions);
      return li;
    }),
  );
}

function actionButton(label, className, onClick) {
  const button = document.createElement('button');
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', async () => {
    button.disabled = true;
    await onClick();
  });
  return button;
}

/* ------------------------------------------------------------------ */
/* Actions                                                            */
/* ------------------------------------------------------------------ */

async function setStatus(id, status) {
  el.warning.hidden = true;

  const { error } = await supabase
    .from('accounts')
    .update({
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: session.user.id,
    })
    .eq('id', id);

  if (error) warn(error.message);

  await loadRows();
}

/* ------------------------------------------------------------------ */
/* Ouverture de la console                                            */
/* ------------------------------------------------------------------ */

async function openDashboard() {
  const { data: isAdmin, error } = await supabase.rpc('is_admin');

  if (error) {
    warn(error.message);
    return;
  }

  if (!isAdmin) {
    warn(
      `Le compte « ${session.user.email} » est authentifié mais n'est pas administrateur. ` +
        "Ajoute-le à la table admins (voir supabase/schema.sql, section 6).",
    );
    return;
  }

  el.login.hidden = true;
  el.dashboard.hidden = false;
  el.who.textContent = session.user.email;

  await loadRows();
}

function bindTabs() {
  for (const button of document.querySelectorAll('.tab')) {
    button.addEventListener('click', () => {
      currentTab = button.dataset.tab;
      for (const other of document.querySelectorAll('.tab')) {
        other.setAttribute('aria-selected', String(other === button));
      }
      render();
    });
  }
}

async function init() {
  if (!configured) {
    warn('Configuration manquante : renseigne supabaseUrl et supabaseAnonKey dans config.js.');
    return;
  }

  bindTabs(); // avant l'auth, pour que les onglets répondent au retour du lien

  const { data } = await supabase.auth.getSession();
  session = data.session;

  if (session) {
    await openDashboard();
  } else {
    el.login.hidden = false;
  }

  supabase.auth.onAuthStateChange((_event, next) => {
    if (next && !session) {
      session = next;
      openDashboard();
    }
  });
}

init();
