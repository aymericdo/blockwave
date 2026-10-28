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
  },

  facebook: {
    label: 'Facebook',
    host: /^https?:\/\/([a-z0-9-]+\.)?facebook\.com\//i,
    homeUrl: 'https://www.facebook.com/',
    profileUrl: (username) => `https://www.facebook.com/${username}/`,
    reserved: new Set([
      'profile.php', 'people', 'pages', 'groups', 'watch', 'marketplace',
      'gaming', 'events', 'reels', 'stories', 'friends', 'messages', 'login',
      'login.php', 'checkpoint', 'recover', 'help', 'settings', 'bookmarks',
      'saved', 'memories', 'fundraisers', 'ads', 'business', 'jobs', 'dating',
      'photo', 'photo.php', 'story.php', 'share', 'sharer', 'share.php',
      'plugins', 'dialog', 'policies', 'legal', 'privacy', 'terms', 'careers',
      'home.php', 'search', 'hashtag', 'notes', 'live', 'video', 'notifications',
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

  const match = parsed.pathname.match(/^\/([A-Za-z0-9._]+)\/?$/);
  if (!match) return null;

  const handle = match[1].toLowerCase();
  return PLATFORMS[platform].reserved.has(handle) ? null : handle;
}
