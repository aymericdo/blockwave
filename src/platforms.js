/* Blockwave — plateformes prises en charge.
 *
 * Source unique côté extension : le popup déduit la plateforme de l'onglet
 * actif, le service worker en déduit l'URL de profil à ouvrir et la page
 * d'accueil où revenir.
 *
 * Ajouter un réseau plus tard (Twitter/X, TikTok…) = une entrée ici, un
 * content script dédié, et une ligne dans manifest.json.
 *
 * Les content scripts ne peuvent pas importer de module ES : leurs constantes
 * vivent dans src/content/. Garder les deux alignés.
 */

export const PLATFORMS = {
  instagram: {
    label: 'Instagram',
    host: /^https?:\/\/([a-z0-9-]+\.)?instagram\.com\//i,
    homeUrl: 'https://www.instagram.com/',
    profileUrl: (username) => `https://www.instagram.com/${username}/`,
    /* Segments de chemin qui ressemblent à un pseudo mais n'en sont pas :
     * sans cette liste, /explore ou /reels passeraient pour des comptes. */
    reserved: new Set([
      'explore', 'reels', 'reel', 'direct', 'accounts', 'p', 'stories', 'about',
      'developer', 'legal', 'api', 'privacy', 'terms', 'session', 'challenge',
      'emails', 'web', 'graphql', 'settings', 'your_activity', 'download',
      'directory', 'invites', 'lite', 'tv', 'audio', 'ar',
    ]),
    /* Sous-pages d'un profil : Instagram garde l'onglet ou la boîte de dialogue
     * ouverte dans l'URL (`/pseudo/reels/`, `/pseudo/followers/mutualOnly/`).
     * C'est souvent depuis ces vues qu'on ouvre le popup. */
    profileSubPaths: new Set([
      'followers', 'following', 'mutualonly', 'reels', 'tagged', 'saved',
    ]),
  },

  facebook: {
    label: 'Facebook',
    host: /^https?:\/\/([a-z0-9-]+\.)?facebook\.com\//i,
    homeUrl: 'https://www.facebook.com/',
    /* Les pages sans pseudo n'existent que par identifiant numérique. Elles ne
     * s'ouvrent de façon fiable que par `profile.php?id=` : `/61583955686477`
     * dépend d'une redirection qui n'est pas garantie. */
    profileUrl: (username) =>
      /^\d+$/.test(username)
        ? `https://www.facebook.com/profile.php?id=${username}`
        : `https://www.facebook.com/${username}/`,
    reserved: new Set([
      'profile.php', 'people', 'pages', 'groups', 'watch', 'marketplace',
      'gaming', 'events', 'reels', 'stories', 'friends', 'messages', 'login',
      'login.php', 'checkpoint', 'recover', 'help', 'settings', 'bookmarks',
      'saved', 'memories', 'fundraisers', 'ads', 'business', 'jobs', 'dating',
      'photo', 'photo.php', 'story.php', 'share', 'sharer', 'share.php',
      'plugins', 'dialog', 'policies', 'legal', 'privacy', 'terms', 'careers',
      'home.php', 'search', 'hashtag', 'notes', 'live', 'video', 'notifications',
    ]),
    /* Onglets d'une page : `/pseudo/photos`, `/pseudo/posts/123456`… Le profil
     * reste le premier segment. Volontairement limité aux onglets connus : hors
     * de cette liste, mieux vaut ne rien pré-remplir que pré-remplir à tort. */
    profileSubPaths: new Set([
      'about', 'photos', 'videos', 'reels', 'followers', 'following', 'likes',
      'reviews', 'posts', 'friends', 'mentions',
    ]),
  },
};

export const PLATFORM_IDS = Object.keys(PLATFORMS);

export function isPlatform(value) {
  return PLATFORM_IDS.includes(value);
}

/** Plateforme d'une URL, ou null si le site n'est pas pris en charge. */
export function platformFromUrl(url) {
  if (!url) return null;
  return PLATFORM_IDS.find((id) => PLATFORMS[id].host.test(url)) ?? null;
}

/* Un pseudo tel que la base l'accepte (`accounts_username_format`). */
const HANDLE_SEGMENT_RE = /^[A-Za-z0-9._]{1,30}$/;

/**
 * Segment qui suit le pseudo dans l'URL. On n'accepte que ce qu'on sait
 * reconnaître : un onglet du profil, ou l'identifiant numérique d'un contenu
 * (`/pseudo/posts/123456`). Tout le reste laisse le champ vide — mieux vaut ne
 * rien pré-remplir que pré-remplir un pseudo qui n'en est pas un.
 */
function isProfileSubPath(profile, segment, isLast) {
  if (profile.profileSubPaths.has(segment.toLowerCase())) return true;
  return isLast && /^[0-9]{5,25}$/.test(segment);
}

/**
 * Pseudo du profil correspondant à cette URL, ou null si la page n'est pas un
 * profil (fil d'actualité, marketplace, page de connexion…).
 */
export function handleFromProfileUrl(url) {
  const platform = platformFromUrl(url);
  if (!platform) return null;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const profile = PLATFORMS[platform];
  const [first, ...rest] = parsed.pathname.split('/').filter(Boolean);

  if (first && HANDLE_SEGMENT_RE.test(first) && !profile.reserved.has(first.toLowerCase())) {
    /* `/pseudo/` est le cas nominal ; les sous-pages d'un profil gardent le même
     * premier segment (`/pseudo/followers/mutualOnly/`), et c'est justement
     * depuis ces vues qu'on ouvre le popup. */
    const isProfileView = rest.every((segment, index) =>
      isProfileSubPath(profile, segment, index === rest.length - 1),
    );

    if (isProfileView) return first.toLowerCase();
  }

  return platform === 'facebook' ? facebookNumericHandle(parsed) : null;
}

/**
 * Facebook expose aussi des profils sans pseudo lisible :
 *   - `facebook.com/profile.php?id=100087171534178`
 *   - `facebook.com/people/Nom-Prenom/100087171534178/`
 *
 * L'identifiant numérique est un pseudo valide pour la base
 * (`accounts_username_format` autorise les chiffres) et c'est sous cette forme
 * que ces comptes figurent dans la liste partagée : on le retient comme handle,
 * sinon le pré-remplissage du popup les ignore silencieusement.
 */
function facebookNumericHandle(parsed) {
  const id = parsed.searchParams.get('id') ?? '';
  if (/^[1-9][0-9]{4,29}$/.test(id)) return id;

  const people = parsed.pathname.match(/^\/people\/[^/]+\/([1-9][0-9]{4,29})\/?$/);
  return people ? people[1] : null;
}
