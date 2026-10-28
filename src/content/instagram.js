/* Blockwave — content script (instagram.com)
 *
 * Exécute le blocage sur le profil courant :
 *   bouton « Options » → entrée « Bloquer » → confirmation « Bloquer »
 *
 * Les classes CSS d'Instagram sont obfusquées et changent souvent :
 * on cible donc des signaux stables (role, aria-label, texte visible).
 */

(() => {
  const GUARD = '__blockwave_instagram__';
  if (window[GUARD]) return;
  window[GUARD] = true;

  const {
    sleep,
    jitter,
    norm,
    isVisible,
    waitFor,
    humanClick,
    simulateReading,
    pressEscape,
    findLabeledButton,
    findClickable,
    registerBlocker,
  } = window.__blockwave_common__;

  const RE = {
    options: /^(options?|plus d['’]options|more options|param[èe]tres)$/i,
    block: /^(bloquer|block)(\s|$)/i,
    blockExact: /^(bloquer|block)$/i,
    unblock: /^(d[ée]bloquer|unblock)(\s|$)/i,
    /** Libellés du bouton principal du header — sert à savoir si la page est prête. */
    action:
      /^(d[ée]bloquer|unblock|suivre|suivi(?:e|\(e\))?|s['’]abonner|abonn[ée]|se d[ée]sabonner|following|follow)$/i,
  };

  /* Rythme « humain » (millisecondes). Tout est tiré au hasard entre les bornes.
     C'est ce qui casse la régularité mécanique d'un bot. */
  const PACE = {
    landing: [250, 700], // temps passé sur la page avant de réagir
    readScroll: [250, 600], // entre deux scrolls de lecture
    beforeMenu: [120, 350], // temps de réaction avant de viser le bouton « … »
    menuRead: [200, 500], // lecture du menu avant de cliquer « Bloquer »
    confirmRead: [200, 550], // hésitation devant la confirmation
  };

  /* ---------------------------------------------------------------- */
  /* Détection de l'état de la page                                    */
  /* ---------------------------------------------------------------- */

  function isSessionBroken() {
    const path = location.pathname;
    if (
      path.startsWith('/accounts/login') ||
      path.startsWith('/challenge') ||
      path.startsWith('/accounts/suspended')
    ) {
      return true;
    }
    return Boolean(document.querySelector('input[name="username"]'));
  }

  function isUnavailable() {
    const text = norm(document.body?.innerText).toLowerCase();
    return (
      text.includes("cette page n'est pas disponible") ||
      text.includes("page isn't available") ||
      text.includes("cette page n’est pas disponible")
    );
  }

  /* ---------------------------------------------------------------- */
  /* Recherche d'éléments cliquables                                   */
  /* ---------------------------------------------------------------- */

  /** Bouton d'action du header de profil (Suivre / Suivi / Débloquer…). */
  function findProfileAction(re) {
    const header = document.querySelector('header');
    return header ? findClickable(re, { scope: header }) : null;
  }

  /** Le bouton « … » du header de profil. */
  function findOptionsButton() {
    const header = document.querySelector('header');

    if (header) {
      const labeled = findLabeledButton(RE.options, header);
      if (labeled) return labeled;
    }

    const labeled = findLabeledButton(RE.options, document);
    if (labeled) return labeled;

    // Dernier recours : dernier bouton icône sans texte du header.
    if (header) {
      const candidates = [...header.querySelectorAll('[role="button"], button')].filter(
        (el) => isVisible(el) && el.querySelector('svg') && !norm(el.innerText),
      );
      if (candidates.length) return candidates[candidates.length - 1];
    }

    return null;
  }

  /* ---------------------------------------------------------------- */
  /* Scénario de blocage                                               */
  /* ---------------------------------------------------------------- */

  async function blockCurrentProfile() {
    await waitFor(() => document.readyState === 'complete', 8000, 100);

    if (isSessionBroken()) {
      return { status: 'login', detail: 'Session Instagram expirée ou vérification requise.' };
    }

    const match = location.pathname.match(/^\/([A-Za-z0-9._]+)\/?$/);
    if (!match) {
      return { status: 'error', detail: `Page inattendue (${location.pathname}).` };
    }

    if (isUnavailable()) {
      return { status: 'notfound', detail: 'Profil indisponible.' };
    }

    // 0. Détection précoce du blocage existant.
    //    Sur un compte déjà bloqué, le bouton d'action du header vaut
    //    « Débloquer » au lieu de « Suivre ». On le lit avant de quoi que ce
    //    soit : ça évite la lecture du profil et l'ouverture du menu, soit
    //    plusieurs secondes par compte déjà traité.
    const action = await waitFor(() => findProfileAction(RE.action), 5000, 120);
    if (action && RE.unblock.test(norm(action.textContent))) {
      return { status: 'already', detail: 'Compte déjà bloqué.' };
    }

    // La page est là : on laisse le temps de « la lire ».
    await sleep(jitter(PACE.landing));

    // On « lit » le profil avant de faire quoi que ce soit.
    await simulateReading(PACE);

    // 1. Ouvrir le menu « Options »
    const optionsButton = await waitFor(() => findOptionsButton(), 12000, 250);
    if (!optionsButton) {
      return { status: 'error', detail: 'Bouton « Options » introuvable.' };
    }
    await sleep(jitter(PACE.beforeMenu));
    await humanClick(optionsButton);

    // 2. Cliquer sur « Bloquer » dans le menu
    const menuItem = await waitFor(
      () => findClickable(RE.block, { exact: RE.blockExact }),
      7000,
      150,
    );
    if (!menuItem) {
      const unblock = await waitFor(() => findClickable(RE.unblock), 1800, 150);
      pressEscape();
      if (unblock) return { status: 'already', detail: 'Compte déjà bloqué.' };
      return { status: 'error', detail: 'Entrée « Bloquer » absente du menu.' };
    }
    await sleep(jitter(PACE.menuRead));
    await humanClick(menuItem);

    // 3. Attendre la fermeture du menu puis confirmer
    await waitFor(() => !menuItem.isConnected || !isVisible(menuItem), 4000, 100);

    const confirmButton = await waitFor(
      () => findClickable(RE.block, { exclude: menuItem, exact: RE.blockExact }),
      8000,
      150,
    );

    if (!confirmButton) {
      // Certaines versions d'Instagram bloquent sans boîte de confirmation.
      const done = await waitFor(() => findClickable(RE.unblock), 2500, 250);
      pressEscape();
      return done
        ? { status: 'blocked', detail: 'Bloqué (sans confirmation).' }
        : { status: 'error', detail: 'Boîte de confirmation introuvable.' };
    }

    await sleep(jitter(PACE.confirmRead));
    await humanClick(confirmButton);

    // 4. Vérifier : le bouton du profil devient « Débloquer »
    const verified = await waitFor(() => findClickable(RE.unblock), 10000, 250);
    return verified
      ? { status: 'blocked', detail: 'Bloqué et vérifié.' }
      : { status: 'blocked', detail: 'Bloqué (confirmation non vérifiée).' };
  }

  registerBlocker(blockCurrentProfile);
})();
