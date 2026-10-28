/* Blockwave — content script (facebook.com)
 *
 * Même principe qu'Instagram, mais la mécanique diffère : Facebook n'affiche
 * pas de bouton « Débloquer » dans l'en-tête du profil. Tout passe par le menu
 * « … », qui contient « Bloquer » ou, si la personne est déjà bloquée,
 * « Débloquer ».
 *
 *   menu « … » → « Bloquer » → dialogue « Confirmer » → vérification
 *
 * Chaîne validée sur une Page (profil public) :
 *   « … » → « Bloquer » → « Confirmer » → « Fermer » (dialogue de succès).
 * Les ancres, par ordre de préférence :
 *      1. `aria-haspopup="menu"` hors navigation, départagé par la géométrie
 *      2. le conteneur `[role="menu"]` et ses `[role="menuitem"]`
 *      3. le texte visible « Bloquer », « Confirmer », « Annuler le blocage »
 *
 * Piège vérifié sur une Page : le bouton « … » de l'en-tête et l'onglet
 * « Plus ▾ » de la rangée d'onglets portent tous deux le libellé « Plus ».
 * C'est la géométrie qui les départage (même ligne que « Suivre », à sa
 * droite), jamais le libellé seul.
 *
 * En cas d'échec, le détail renvoyé au popup liste les entrées réellement
 * trouvées dans le menu, et la console trace les scores des candidats.
 */

(() => {
  const GUARD = '__blockwave_facebook__';
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
    findClickable,
    registerBlocker,
  } = window.__blockwave_common__;

  const RE = {
    /* Facebook écrit « Plus », « Plus d'options », « More options »… selon la
     * version et la langue : on ne peut pas exiger un libellé exact. */
    more: /^(plus|more)\b/i,
    block: /^(bloquer|block)(\s|$)/i,
    blockExact: /^(bloquer|block)$/i,
    /* « Annuler le blocage » est la formulation utilisée par Facebook une fois
     * la personne bloquée : c'est le signal de vérification le plus fiable. */
    unblock: /^(d[ée]bloquer|unblock|annuler le blocage)(\s|$)/i,
    /* La boîte de confirmation ne répète pas l'action : elle propose
     * « Annuler » et « Confirmer ». Ne jamais chercher « Bloquer » ici. */
    confirm: /^(confirmer|confirm|bloquer|block)$/i,
    /* Le dialogue de succès ne propose qu'un bouton de fermeture. */
    close: /^(fermer|close|ok)$/i,
    /* Bouton principal de la barre d'actions : sert d'ancre au repli
     * géométrique quand le « … » n'a pas d'aria-haspopup. */
    primaryAction:
      /^(s['’]inscrire|suivre|suivi(?:e)?|following|follow|aimer|like|message|ajouter|add friend)$/i,
  };

  /* Facebook est plus lent qu'Instagram : les vues sont rendues côté client et
     le menu met un moment à apparaître. */
  const PACE = {
    landing: [500, 1200],
    readScroll: [300, 700],
    beforeMenu: [180, 450],
    menuRead: [250, 600],
    confirmRead: [250, 650],
  };

  const MENU_MAX_LENGTH = 60;

  const log = (...args) => console.debug('[Blockwave:facebook]', ...args);

  /* ---------------------------------------------------------------- */
  /* Détection de l'état de la page                                    */
  /* ---------------------------------------------------------------- */

  function isSessionBroken() {
    if (/^\/(login|checkpoint|recover)/i.test(location.pathname)) return true;
    return Boolean(document.querySelector('input[name="email"], input#email'));
  }

  function isUnavailable() {
    const text = norm(document.body?.innerText).toLowerCase();
    return (
      text.includes("cette page n'est pas disponible") ||
      text.includes("cette page n’est pas disponible") ||
      text.includes("ce contenu n'est pas disponible") ||
      text.includes('this content isn') ||
      text.includes("this page isn't available") ||
      text.includes('contenu indisponible')
    );
  }

  /**
   * Le dialogue « Vous avez bloqué X » qui suit la confirmation. Il ne se
   * referme pas tout seul : sans ça, la modale reste ouverte et masque la page.
   */
  function blockedDialog() {
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      if (!isVisible(dialog)) continue;

      const text = norm(dialog.innerText).toLowerCase();
      if (text.includes('vous avez bloqué') || text.includes('you blocked')) {
        return dialog;
      }
    }
    return null;
  }

  async function dismissDialog(dialog) {
    const close = findClickable(RE.close, {
      scope: dialog,
      maxLength: 20,
      exact: RE.close,
    });

    if (close) await humanClick(actionable(close));
    else pressEscape();

    await sleep(200);
  }

  /**
   * Facebook confirme aussi le blocage par un bandeau (« Vous avez bloqué… ») ou
   * par une action « Annuler le blocage » à la place de « Suivre ». Ces deux
   * libellés n'apparaissent jamais sur un profil non bloqué.
   */
  function showsBlockedNotice() {
    const text = norm(document.body?.innerText).toLowerCase();
    return (
      text.includes('vous avez bloqué') ||
      text.includes('you blocked') ||
      text.includes('annuler le blocage')
    );
  }

  /* ---------------------------------------------------------------- */
  /* Éléments du profil                                                */
  /* ---------------------------------------------------------------- */

  /**
   * Le texte est presque toujours dans un `<span>` interne, alors que
   * l'écouteur React est posé sur l'ancêtre cliquable. Cliquer le span ne
   * déclenche rien : on remonte toujours au porteur réel.
   */
  function actionable(el) {
    if (!el) return null;
    return (
      el.closest('[role="menuitem"], button, [role="button"], div[tabindex], a[href]') ?? el
    );
  }

  const labelOf = (el) => norm(el.getAttribute('aria-label')) || '(sans libellé)';

  /* La barre de navigation contient à elle seule cinq boutons
   * `aria-haspopup="menu"` : compte, notifications, messenger, menu Facebook,
   * recherche. Les laisser dans les candidats revient à ouvrir le menu du
   * compte à la place de celui du profil. */
  const outsideChrome = (el) =>
    !el.closest('[role="banner"], [role="navigation"], [role="complementary"]');

  const sameRow = (a, b, tolerance = 40) => {
    const boxA = a.getBoundingClientRect();
    const boxB = b.getBoundingClientRect();
    return Math.abs(boxA.top + boxA.height / 2 - (boxB.top + boxB.height / 2)) < tolerance;
  };

  /** Bouton d'action principal du profil : `S'inscrire`, `Suivre`, `Message`… */
  function findActionAnchor() {
    return (
      [...document.querySelectorAll('button, [role="button"], a[role="button"], a[tabindex="0"]')]
        .filter((el) => isVisible(el) && outsideChrome(el))
        .find((el) => {
          const text = norm(el.textContent);
          return text.length <= 30 && RE.primaryAction.test(text);
        }) ?? null
    );
  }

  /**
   * Note un candidat « … ». Le libellé ne suffit pas : sur une Page, l'onglet
   * `Plus ▾` de la rangée d'onglets s'appelle « Plus » lui aussi. Ce qui
   * distingue le bon bouton, c'est sa forme et sa place :
   *   - il ne contient aucun texte (icône seule) ;
   *   - il est sur la même ligne que les actions du profil ;
   *   - il est à leur droite.
   */
  function scoreMoreButton(el, anchor) {
    let score = 0;

    if (!norm(el.textContent)) score += 100;

    if (anchor) {
      const a = anchor.getBoundingClientRect();
      const b = el.getBoundingClientRect();

      if (sameRow(el, anchor)) score += 80;
      if (b.left >= a.right - 8) score += 40;
    }

    if (RE.more.test(labelOf(el))) score += 20;

    // L'onglet « Plus » vit dans la rangée d'onglets : disqualifié d'office.
    if (el.closest('[role="tablist"]')) score -= 200;

    return score;
  }

  /**
   * Le bouton « … » de la barre d'actions du profil.
   *
   * Deux stratégies : le meilleur score parmi les `aria-haspopup="menu"` hors
   * navigation, sinon le bouton-icône de la même ligne que l'action principale
   * (certaines Pages n'exposent pas `aria-haspopup` sur ce bouton).
   */
  function findMoreButton() {
    const anchor = findActionAnchor();
    const candidates = [...document.querySelectorAll('[aria-haspopup="menu"]')].filter(
      (el) => isVisible(el) && outsideChrome(el),
    );

    if (candidates.length) {
      const ranked = candidates
        .map((el) => ({ el, score: scoreMoreButton(el, anchor) }))
        .sort((a, b) => b.score - a.score);

      log(
        'candidats « … » :',
        ranked.map(({ el, score }) => `${labelOf(el)} (${score})`).join(' · '),
      );

      if (ranked[0].score > 0) return ranked[0].el;
    }

    if (!anchor) {
      log('aucun bouton « … » ni bouton d’action hors navigation');
      return null;
    }

    const box = anchor.getBoundingClientRect();
    const near = [...document.querySelectorAll('[role="button"], button')]
      .filter(
        (el) =>
          isVisible(el) &&
          el !== anchor &&
          !anchor.contains(el) &&
          el.querySelector('svg') &&
          !norm(el.textContent) &&
          sameRow(el, anchor, 32) &&
          outsideChrome(el),
      )
      .sort(
        (a, b) =>
          Math.abs(b.getBoundingClientRect().left - box.right) -
          Math.abs(a.getBoundingClientRect().left - box.right),
      );

    log(
      'repli géométrique depuis',
      `« ${norm(anchor.textContent)} » :`,
      near.length ? near.map(labelOf).join(' · ') : 'aucun bouton-icône sur la ligne',
    );

    return near[0] ?? null;
  }

  /**
   * Le menu ouvert. Facebook rend parfois le menu dans un `[role="dialog"]`
   * sans `role="menu"` : on accepte ce repli, sinon on ne trouve rien.
   */
  function findMenu() {
    const menu = document.querySelector('[role="menu"]');
    if (menu && isVisible(menu)) return menu;

    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      if (isVisible(dialog) && dialog.querySelector('[role="menuitem"]')) return dialog;
    }

    return null;
  }

  /** Boîte de confirmation, en excluant le menu dont elle pourrait être le parent. */
  function findDialog(exclude = null) {
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      if (!isVisible(dialog)) continue;
      if (exclude && dialog.contains(exclude)) continue;
      return dialog;
    }
    return null;
  }

  /** Libellés visibles des entrées d'un menu — sert uniquement au diagnostic. */
  function menuLabels(scope) {
    if (!scope) return '';

    const nodes = scope.querySelectorAll('[role="menuitem"], [role="button"]');
    const labels = [...nodes]
      .map((el) => norm(el.innerText))
      .filter(Boolean);

    return [...new Set(labels)].slice(0, 10).join(' · ');
  }

  /** Referme un menu resté ouvert (Échap ne suffit pas toujours chez Facebook). */
  async function closeMenu(trigger) {
    pressEscape();
    await sleep(200);

    if (findMenu() && trigger?.isConnected) {
      await humanClick(trigger);
      await sleep(200);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Scénario de blocage                                               */
  /* ---------------------------------------------------------------- */

  async function blockCurrentProfile() {
    await waitFor(() => document.readyState === 'complete', 10000, 100);

    if (isSessionBroken()) {
      return { status: 'login', detail: 'Session Facebook expirée ou vérification requise.' };
    }

    const match = location.pathname.match(/^\/([A-Za-z0-9._]+)\/?$/);
    if (!match) {
      return { status: 'error', detail: `Page inattendue (${location.pathname}).` };
    }

    if (isUnavailable()) {
      return { status: 'notfound', detail: 'Profil indisponible.' };
    }

    await sleep(jitter(PACE.landing));
    await simulateReading(PACE);

    // 1. Ouvrir le menu « … »
    const moreButton = await waitFor(() => findMoreButton(), 15000, 250);
    if (!moreButton) {
      return { status: 'error', detail: 'Bouton « … » introuvable.' };
    }
    await sleep(jitter(PACE.beforeMenu));
    await humanClick(actionable(moreButton));

    // 2. Lire le menu : « Débloquer » = déjà bloqué, « Bloquer » = à faire
    const opened = await waitFor(() => findMenu(), 6000, 150);

    /* Certaines versions n'exposent pas `role="menu"` : le menu est alors un
     * simple popup. On cherche « Bloquer » dans la page entière — le libellé
     * n'existe nulle part ailleurs sur un profil. */
    const panel = opened ?? document;
    log(
      opened ? 'menu :' : 'pas de [role="menu"] — recherche globale :',
      opened ? menuLabels(opened) || '(aucun libellé lisible)' : '« Bloquer »',
    );

    const already = findClickable(RE.unblock, {
      scope: panel,
      maxLength: MENU_MAX_LENGTH,
      exact: RE.unblock,
    });
    if (already) {
      await closeMenu(moreButton);
      return { status: 'already', detail: 'Compte déjà bloqué.' };
    }

    const blockItem = await waitFor(
      () =>
        findClickable(RE.block, {
          scope: panel,
          maxLength: MENU_MAX_LENGTH,
          exact: RE.blockExact,
        }),
      5000,
      150,
    );

    if (!blockItem) {
      const seen = opened ? menuLabels(opened) : '';
      await closeMenu(moreButton);
      return {
        status: 'error',
        detail: seen
          ? `Entrée « Bloquer » absente du menu. Vu : ${seen}.`
          : 'Entrée « Bloquer » absente du menu.',
      };
    }

    await sleep(jitter(PACE.menuRead));
    await humanClick(actionable(blockItem));

    // 3. Confirmer dans la boîte de dialogue.
    //    Le menu doit d'abord disparaître : tant qu'il est là, son entrée
    //    « Bloquer » serait de nouveau candidate à la place du bouton du
    //    dialogue.
    if (opened) {
      const closed = await waitFor(
        () => !opened.isConnected || !isVisible(opened),
        4000,
        150,
      );
      if (!closed) {
        pressEscape();
        await sleep(300);
      }
    }

    const confirmButton = await waitFor(() => {
      const box = findDialog(blockItem);
      return findClickable(RE.confirm, {
        scope: box ?? document,
        exclude: blockItem,
        maxLength: MENU_MAX_LENGTH,
        exact: RE.confirm,
      });
    }, 9000, 150);

    if (!confirmButton) {
      const box = findDialog(blockItem);
      const seen = box ? norm(box.innerText).slice(0, 120) : '';
      log('dialogue :', seen || '(aucun)');
      return {
        status: 'error',
        detail: seen
          ? `Boîte de confirmation introuvable. Vu : « ${seen} »`
          : 'Boîte de confirmation introuvable.',
      };
    }

    await sleep(jitter(PACE.confirmRead));
    await humanClick(actionable(confirmButton));

    // 4. Vérifier. Facebook remplace la boîte de confirmation par un dialogue
    //    « Vous avez bloqué X » — c'est le signal le plus fiable. Il faut le
    //    refermer soi-même : il ne disparaît jamais tout seul.
    const notice = await waitFor(() => blockedDialog(), 9000, 150);
    if (notice) {
      await dismissDialog(notice);
      return { status: 'blocked', detail: 'Bloqué et vérifié.' };
    }

    // Autres versions : le profil devient indisponible, ou un bandeau
    // « Annuler le blocage » remplace les actions.
    const confirmed = await waitFor(
      () => isUnavailable() || showsBlockedNotice(),
      3000,
      200,
    );
    if (confirmed) return { status: 'blocked', detail: 'Bloqué et vérifié.' };

    const again = await waitFor(() => findMoreButton(), 3000, 250);
    if (again) {
      await humanClick(actionable(again));
      const panel2 = (await waitFor(() => findMenu(), 4000, 150)) ?? document;
      const nowUnblock = findClickable(RE.unblock, {
        scope: panel2,
        maxLength: MENU_MAX_LENGTH,
        exact: RE.unblock,
      });
      await closeMenu(again);

      if (nowUnblock) return { status: 'blocked', detail: 'Bloqué et vérifié.' };
    }

    return { status: 'blocked', detail: 'Bloqué (confirmation non vérifiée).' };
  }

  registerBlocker(blockCurrentProfile);
})();
