/**
 * Normalisation d'un pseudo Instagram.
 *
 * Source de vérité unique, partagée par l'extension et les pages web : si les
 * deux côtés ne normalisent pas pareil, la déduplication casse silencieusement
 * (on se retrouve avec « @Marine_Lepen » et « marine_lepen » en double).
 *
 * Accepte : "@marine_lepen", "marine_lepen/", "?hl=fr", une URL complète…
 * Renvoie null si ce n'est pas un pseudo plausible.
 */

const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;

/**
 * Segments de chemin qui ressemblent à un pseudo mais n'en sont pas.
 * Sans cette liste, `/explore` ou `/reels` passeraient pour des comptes.
 */
const RESERVED_PATHS = new Set([
  'explore', 'reels', 'reel', 'direct', 'accounts', 'p', 'stories', 'about',
  'developer', 'legal', 'api', 'privacy', 'terms', 'session', 'challenge',
  'emails', 'web', 'graphql', 'settings', 'your_activity', 'download',
  'directory', 'invites', 'lite', 'tv', 'audio', 'ar',
]);

/**
 * Extrait le pseudo d'une URL de profil Instagram.
 * Renvoie null pour une page qui n'est pas un profil (fil, explore, reels…).
 */
export function handleFromUrl(url) {
  if (!url) return null;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!/(^|\.)instagram\.com$/i.test(parsed.hostname)) return null;

  const match = parsed.pathname.match(/^\/([A-Za-z0-9._]+)\/?$/);
  if (!match) return null;

  const handle = match[1].toLowerCase();
  return RESERVED_PATHS.has(handle) ? null : handle;
}

export function normalizeHandle(input) {
  if (input == null) return null;

  let value = String(input).trim();
  if (!value) return null;

  // URL de profil : on ne garde que le segment qui suit /instagram.com/
  const fromUrl = value.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (fromUrl) value = fromUrl[1];

  value = value
    .split(/[?#]/)[0] // query string / ancre
    .replace(/^@/, '')
    .replace(/\/+$/, '');

  return HANDLE_RE.test(value) ? value.toLowerCase() : null;
}
