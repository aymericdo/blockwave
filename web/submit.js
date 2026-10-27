/* Blockwave — formulaire public de soumission */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CONFIG } from '../config.js';
import { normalizeHandle } from '../handles.js';

const el = {
  form: document.getElementById('form'),
  handle: document.getElementById('handle'),
  reason: document.getElementById('reason'),
  website: document.getElementById('website'),
  submit: document.getElementById('submit'),
  error: document.getElementById('error'),
  success: document.getElementById('success'),
  warning: document.getElementById('warning'),
  approved: document.getElementById('approved'),
  count: document.getElementById('count'),
};

const configured = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
const supabase = configured
  ? createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey)
  : null;

/* ------------------------------------------------------------------ */

function showError(message) {
  el.error.textContent = message;
  el.error.hidden = false;
  el.success.hidden = true;
}

function showSuccess(message) {
  el.success.textContent = message;
  el.success.hidden = false;
  el.error.hidden = true;
}

if (!configured) {
  el.warning.textContent =
    "Configuration manquante : renseigne supabaseUrl et supabaseAnonKey dans config.js.";
  el.warning.hidden = false;
  el.submit.disabled = true;
}

/* ------------------------------------------------------------------ */

async function loadApproved() {
  if (!supabase) return;

  // La RLS ne renvoie de toute façon que les lignes approuvées.
  const { data, error } = await supabase
    .from('accounts')
    .select('username')
    .eq('status', 'approved')
    .order('username', { ascending: true })
    .limit(500);

  if (error) {
    el.count.textContent = '—';
    return;
  }

  el.count.textContent = `${data.length} compte${data.length > 1 ? 's' : ''}`;
  el.approved.replaceChildren(
    ...data.map((row) => {
      const li = document.createElement('li');
      li.textContent = `@${row.username}`;
      return li;
    }),
  );
}

el.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  el.error.hidden = true;
  el.success.hidden = true;

  // Piège à bots : un humain ne remplit jamais ce champ.
  if (el.website.value) {
    showSuccess('Merci, proposition enregistrée.');
    el.form.reset();
    return;
  }

  const handle = normalizeHandle(el.handle.value);
  if (!handle) {
    showError("Ce n'est pas un pseudo Instagram valide (lettres, chiffres, . et _).");
    return;
  }

  const reason = el.reason.value.trim();

  el.submit.disabled = true;
  el.submit.textContent = 'Envoi…';

  const { error } = await supabase.from('accounts').insert({
    username: handle,
    status: 'pending',
    reason: reason || null,
  });

  el.submit.disabled = false;
  el.submit.textContent = 'Proposer';

  if (error) {
    if (error.code === '23505') {
      showError(`@${handle} est déjà dans la liste (proposé ou déjà bloqué).`);
    } else if (error.code === '23514') {
      showError('Cette proposition ne passe pas la validation (format ou longueur).');
    } else if (error.code === 'P0001') {
      showError(error.message); // garde-fou anti-spam du trigger
    } else {
      showError(error.message);
    }
    return;
  }

  el.form.reset();
  showSuccess(`Merci ! @${handle} est en attente de validation.`);
});

loadApproved();
