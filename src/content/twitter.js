/* Blockwave — content script (x.com / twitter.com)
 *
 * Même principe qu'Instagram, avec la mécanique de X : pas de bouton
 * « Débloquer » dans l'en-tête, tout passe par le menu « … » du profil.
 *
 *   « … » (userActions) → « Bloquer @pseudo » → feuille de confirmation → toast
 *
 * Ancres, par ordre de préférence :
 *      1. `[data-testid="userActions"]` pour le bouton « … »
 *      2. `[data-testid="block"]` / `[data-testid="unblock"]` dans le menu
 *      3. `[data-testid="confirmationSheetConfirm"]` pour la confirmation
 *      4. le texte visible (« Bloquer @x », « Débloquer @x », « Bloquer »)
 *
 * X expose des `data-testid` stables depuis des années, contrairement à ses
 * classes CSS ; le texte visible sert de repli, en français comme en anglais.
 *
 * Le script ne dépend pas du domaine : x.com et twitter.com servent la même
 * application, et twitter.com redirige de toute façon vers x.com.
 */

(() => {
  const GUARD = '__blockwave_twitter__';
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
    block: /^(bloquer|block)(\s|$)/i,
    blockExact: /^(bloquer|block)$/i,
    /* Le menu écrit « Débloquer @pseudo » ; le bouton du header, « Bloqué ». */
    unblock: /^(d[ée]bloquer|unblock)(\s|$)/i,
    confirm: /^(bloquer|block)$/i,
    blockedState: /^(bloqu[ée]|blocked)$/i,
    unblockState: /^(d[ée]bloquer|unblock)$/i,
    /* Toast de succès : « Vous avez bloqué @x » / « You blocked @x ». */
    blockedNotice: /(vous avez bloqu[ée]|you blocked)/i,
  };

  /* X est réactif mais plus lent qu'Instagram au premier rendu. */
  const PACE = {
    landing: [400, 1000],
    readScroll: [250, 650],
    beforeMenu: [150, 400],
    menuRead: [220, 550],
    confirmRead: [250, 600],
  };

  const MENU_MAX_LENGTH = 60;

  const log = (...args) => console.debug('[Blockwave:twitter]', ...args);

  /* ---------------------------------------------------------------- */
  /* Accès aux éléments                                                */
  /* ---------------------------------------------------------------- */

  const byTestId = (id, scope = document) => scope.querySelector(`[data-testid="${id}"]`);

  /** La colonne centrale : tout ce qui nous intéresse y vit, hors navigation. */
  const column = () => byTestId('primaryColumn') ?? document;

  /**
   * Le texte est presque toujours dans un `<span>` interne, alors que
   * l'écouteur React est posé sur l'ancêtre cliquable.
   */
  function actionable(el) {
    if (!el) return null;
    return (
      el.closest('[role="menuitem"], button, [role="button"], div[tabindex], a[href]') ?? el
    );
  }

  function visibleDialog() {
    return [...document.querySelectorAll('[role="dialog"]')].find((el) => isVisible(el)) ?? null;
  }

  /* ---------------------------------------------------------------- */
  /* Détection de l'état de la page                                    */
  /* ---------------------------------------------------------------- */

  function isSessionBroken() {
    if (/^\/(i\/flow\/(login|signup)|login|logout|signup|account\/access)/i.test(location.pathname)) {
      return true;
    }
    return Boolean(
      document.querySelector(
        '[data-testid="loginButton"], input[autocomplete="username"], [data-testid="loginForm"]',
      ),
    );
  }

  function isUnavailable() {
    const text = norm(document.body?.innerText).toLowerCase();
    return (
      text.includes("ce compte n'existe pas") ||
      text.includes('ce compte n’existe pas') ||
      text.includes("this account doesn't exist") ||
      text.includes('this account doesn’t exist') ||
      text.includes("cette page n'existe pas") ||
      text.includes('cette page n’existe pas') ||
      text.includes('this page doesn’t exist') ||
      text.includes('ce compte est suspendu') ||
      text.includes('this account is suspended') ||
      text.includes('account suspended')
    );
  }

  /* ---------------------------------------------------------------- */
  /* Éléments du profil                                                */
  /* ---------------------------------------------------------------- */

  /** Bouton d'action du header de profil : « Suivre », « Abonné », « Bloqué »… */
  function profileAction() {
    const scope = column();
    const more = byTestId('userActions', scope);

    const candidates = [...scope.querySelectorAll('button, [role="button"]')].filter((el) => {
      if (!isVisible(el)) return false;
      if (more && (el === more || more.contains(el))) return false;

      const text = norm(el.innerText);
      return text.length > 0 && text.length <= 24;
    });

    return candidates[0] ?? null;
  }

  /** Le bouton « … » du header de profil. */
  function findMoreButton() {
    const direct = byTestId('userActions');
    if (direct && isVisible(direct)) return direct;

    const scope = byTestId('primaryColumn');
    if (!scope) return null;

    return (
      [...scope.querySelectorAll('button, [role="button"]')].find((el) => {
        if (!isVisible(el)) return false;
        return /\b(plus|more|options)\b/i.test(norm(el.getAttribute('aria-label')));
      }) ?? null
    );
  }

  /** Feuille de confirmation « Bloquer @x ? ». */
  function confirmationSheet() {
    return byTestId('confirmationSheetDialog') ?? visibleDialog();
  }

  function blockedToast() {
    const toast = byTestId('toast');
    if (!toast || !isVisible(toast)) return null;
    return RE.blockedNotice.test(norm(toast.innerText)) ? toast : null;
  }

  /**
   * Profil bloqué : X remplace le contenu par « @pseudo est bloqué » et un
   * bouton « Voir les posts ». C'est la preuve la plus fiable du blocage —
   * plus que le libellé du bouton d'action, qui dépend de la version de l'UI.
   *
   * Le titre seul ne suffit pas : on exige aussi la phrase d'explication
   * (« ne débloquera pas »), qui n'apparaît que dans cet écran.
   */
  function blockedBanner() {
    const scope = column();
    const text = norm(scope.innerText).toLowerCase();

    const titled =
      /@[a-z0-9_]+ est bloqu[ée]/.test(text) || /@[a-z0-9_]+ is blocked/.test(text);
    if (!titled) return null;

    const explained =
      text.includes('ne débloquera pas') ||
      text.includes("won't unblock") ||
      text.includes('will not unblock') ||
      text.includes('voir les posts') ||
      text.includes('view posts');

    return explained ? text : null;
  }

  /** Le texte du bouton d'action du header s'il indique déjà un blocage. */
  function blockedAction() {
    const text = norm(profileAction()?.innerText);
    return RE.blockedState.test(text) || RE.unblockState.test(text) ? text : null;
  }

  /** Referme un menu resté ouvert (Échap ne suffit pas toujours chez X). */
  async function closeMenu(trigger) {
    pressEscape();
    await sleep(200);

    if (byTestId('block') || byTestId('unblock')) {
      if (trigger?.isConnected) {
        await humanClick(trigger);
        await sleep(200);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Scénario de blocage                                               */
  /* ---------------------------------------------------------------- */

  async function blockCurrentProfile() {
    await waitFor(() => document.readyState === 'complete', 10000, 100);

    if (isSessionBroken()) {
      return { status: 'login', detail: 'Session X expirée ou vérification requise.' };
    }

    if (!/^\/[A-Za-z0-9_]+\/?/.test(location.pathname)) {
      return { status: 'error', detail: `Page inattendue (${location.pathname}).` };
    }

    if (isUnavailable()) {
      return { status: 'notfound', detail: 'Profil indisponible.' };
    }

    // 0. Détection précoce. Deux signaux, du plus fiable au plus fragile :
    //    la bannière « @pseudo est bloqué », puis le bouton du header qui vaut
    //    « Bloqué » / « Débloquer ». On les lit avant d'ouvrir quoi que ce soit,
    //    ce qui ramène ces cas à 1–2 secondes.
    //
    //    L'attente porte sur « la bannière ou le bouton existe », pas sur « le
    //    compte est bloqué » : sinon un profil normal ferait tourner la boucle
    //    jusqu'au délai complet, soit 6 s perdues par compte.
    await waitFor(() => blockedBanner() || profileAction(), 6000, 150);

    if (blockedBanner() || blockedAction()) {
      return { status: 'already', detail: 'Compte déjà bloqué.' };
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

    // 2. Lire le menu : « Débloquer » = déjà bloqué, « Bloquer @x » = à faire
    const menu = await waitFor(() => document.querySelector('[role="menu"]'), 6000, 150);
    const panel = menu ?? document;
    log(menu ? 'menu ouvert' : 'pas de [role="menu"] — recherche globale');

    const unblockItem =
      byTestId('unblock', panel) ??
      findClickable(RE.unblock, { scope: panel, maxLength: MENU_MAX_LENGTH });

    if (unblockItem) {
      await closeMenu(moreButton);
      return { status: 'already', detail: 'Compte déjà bloqué.' };
    }

    const blockItem =
      byTestId('block', panel) ??
      (await waitFor(
        () => findClickable(RE.block, { scope: panel, maxLength: MENU_MAX_LENGTH }),
        5000,
        150,
      ));

    if (!blockItem) {
      await closeMenu(moreButton);
      return { status: 'error', detail: 'Entrée « Bloquer » absente du menu.' };
    }

    await sleep(jitter(PACE.menuRead));
    await humanClick(actionable(blockItem));

    // 3. Confirmer dans la feuille. Elle nomme le compte : on ne cherche que le
    //    verbe, jamais « Bloquer @x ».
    const sheet = await waitFor(() => confirmationSheet(), 9000, 150);
    const confirmButton =
      (sheet && byTestId('confirmationSheetConfirm', sheet)) ??
      (sheet &&
        findClickable(RE.confirm, {
          scope: sheet,
          maxLength: 20,
          exact: RE.confirm,
        }));

    if (!confirmButton) {
      return {
        status: 'error',
        detail: sheet
          ? 'Bouton de confirmation introuvable.'
          : 'Feuille de confirmation introuvable.',
      };
    }

    await sleep(jitter(PACE.confirmRead));
    await humanClick(actionable(confirmButton));

    // 4. Vérifier. Trois signaux, du plus précoce au plus tardif : le toast
    //    « Vous avez bloqué @x », la bannière « @x est bloqué » qui remplace le
    //    contenu, puis le bouton du header passé à « Bloqué ».
    const verified = await waitFor(
      () => blockedToast() || blockedBanner() || blockedAction(),
      10000,
      150,
    );

    return verified
      ? { status: 'blocked', detail: 'Bloqué et vérifié.' }
      : { status: 'blocked', detail: 'Bloqué (confirmation non vérifiée).' };
  }

  registerBlocker(blockCurrentProfile);
})();
