/* Les jetons du lien magique transitent dans le fragment d'URL. supabase-js les
 * consomme au chargement ; on efface ensuite le fragment pour qu'il ne traîne
 * ni dans l'historique du navigateur ni dans un éventuel referer. */
export function stripAuthFragment(): void {
  if (!window.location.hash.includes('access_token')) return;

  window.history.replaceState(
    null,
    '',
    window.location.pathname + window.location.search,
  );
}
