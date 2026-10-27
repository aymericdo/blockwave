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
