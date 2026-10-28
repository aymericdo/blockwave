/**
 * Normalisation d'un pseudo, indépendamment de la plateforme.
 *
 * Source de vérité unique, partagée par l'extension et la console : si les
 * deux côtés ne normalisent pas pareil, la déduplication casse silencieusement
 * (on se retrouve avec « @Marine_Lepen » et « marine_lepen » en double).
 *
 * Accepte : "@marine_lepen", "marine_lepen/", "?hl=fr", une URL de profil…
 * Renvoie null si ce n'est pas un pseudo plausible.
 *
 * Ne connaît pas la notion de plateforme : c'est `platforms.js` qui sait sur
 * quels sites on se trouve et quels segments de chemin sont réservés
 * (`handleFromProfileUrl`).
 */

const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;

export function normalizeHandle(input) {
  if (input == null) return null;

  let value = String(input).trim();
  if (!value) return null;

  // URL de profil : on ne garde que le premier segment du chemin.
  const fromUrl = value.match(/^https?:\/\/[^/]+\/([A-Za-z0-9._]+)/i);
  if (fromUrl) value = fromUrl[1];

  value = value
    .split(/[?#]/)[0] // query string / ancre
    .replace(/^@/, '')
    .replace(/\/+$/, '');

  return HANDLE_RE.test(value) ? value.toLowerCase() : null;
}
