/* Blockwave — content script (instagram.com)
 *
 * Exécute le blocage sur le profil courant :
 *   bouton « Options » → entrée « Bloquer » → confirmation « Bloquer »
 *
 * Les classes CSS d'Instagram sont obfusquées et changent souvent :
 * on cible donc des signaux stables (role, aria-label, texte visible).
 */

(() => {
  const GUARD = '__blockwave_ready__';
  if (window[GUARD]) return;
  window[GUARD] = true;

  const RE = {
    options: /^(options?|plus d['’]options|more options|param[èe]tres)$/i,
    block: /^(bloquer|block)(\s|$)/i,
    blockExact: /^(bloquer|block)$/i,
    unblock: /^(d[ée]bloquer|unblock)(\s|$)/i,
  };

  /* Rythme « humain » (millisecondes). Tout est tiré au hasard entre les bornes.
     C'est ce qui casse la régularité mécanique d'un bot. */
  const PACE = {
    landing: [600, 1400], // temps passé sur la page avant de réagir
    readScroll: [450, 1000], // entre deux scrolls de lecture
    beforeMenu: [250, 650], // temps de réaction avant de viser le bouton « … »
    menuRead: [350, 850], // lecture du menu avant de cliquer « Bloquer »
    confirmRead: [400, 950], // hésitation devant la confirmation
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const rand = (min, max) => min + Math.random() * (max - min);
  const jitter = ([min, max]) => rand(min, max);

  const norm = (text) => (text || '').replace(/\s+/g, ' ').trim();

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    return (
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      Number(style.opacity) > 0.05
    );
  }

  async function waitFor(fn, timeout = 6000, interval = 150) {
    const deadline = Date.now() + timeout;
    for (;;) {
      let value = null;
      try {
        value = fn();
      } catch {
        value = null;
      }
      if (value) return value;
      if (Date.now() >= deadline) return null;
      await sleep(interval);
    }
  }

  /**
   * Clic « humain » : survol avec coordonnées réalistes, temps de pause avant
   * l'appui, maintien du bouton, puis relâchement. React écoute le click délégué.
   */
  async function humanClick(el) {
    const rect = el.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await sleep(rand(200, 400));
    }

    const box = el.getBoundingClientRect();
    const x = box.left + box.width * rand(0.35, 0.65);
    const y = box.top + box.height * rand(0.35, 0.65);

    const base = { bubbles: true, cancelable: true, view: window, button: 0, clientX: x, clientY: y };
    const Pointer = window.PointerEvent || MouseEvent;

    // Approche de la souris : quelques mousemove avant d'arriver sur la cible.
    for (let i = 1; i <= 3; i++) {
      el.dispatchEvent(
        new MouseEvent('mousemove', {
          ...base,
          clientX: x - (x - window.innerWidth / 2) * (1 - i / 3) * 0.2,
          clientY: y - (y - window.innerHeight / 2) * (1 - i / 3) * 0.2,
        }),
      );
      await sleep(rand(25, 70));
    }

    el.dispatchEvent(new Pointer('pointerover', base));
    el.dispatchEvent(new Pointer('pointerenter', base));
    el.dispatchEvent(new MouseEvent('mouseover', base));

    await sleep(rand(90, 220)); // temps de réaction avant l'appui

    el.dispatchEvent(new Pointer('pointerdown', { ...base, pointerId: 1, isPrimary: true, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));

    await sleep(rand(50, 110)); // maintien du bouton

    el.dispatchEvent(new Pointer('pointerup', { ...base, pointerId: 1, isPrimary: true, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));

    await sleep(rand(60, 150));
  }

  async function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await waitFor(() => window.scrollY < 4, 2000, 100);
    await sleep(rand(150, 380));
  }

  /** Fait semblant de parcourir le profil avant d'agir. */
  async function simulateReading() {
    const passes = Math.random() < 0.6 ? 1 : 2;

    for (let i = 0; i < passes; i++) {
      window.scrollBy({ top: rand(180, 460), behavior: 'smooth' });
      await sleep(jitter(PACE.readScroll));
    }

    await scrollToTop();
  }

  function pressEscape() {
    const target = document.activeElement || document.body;
    target?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
      }),
    );
  }

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

  function findLabeledButton(re, scope = document) {
    for (const el of scope.querySelectorAll('[aria-label]')) {
      if (!re.test(norm(el.getAttribute('aria-label')))) continue;
      const button = el.closest('[role="button"], button, a') || el;
      if (isVisible(button)) return button;
    }
    return null;
  }

  function score(el) {
    const text = norm(el.textContent);
    return (RE.blockExact.test(text) ? 0 : 100) + text.length;
  }

  function findClickable(re, { scope = document, exclude = null } = {}) {
    const nodes = scope.querySelectorAll(
      'button, [role="button"], div[tabindex="0"], a[tabindex="0"]',
    );
    let best = null;
    let bestScore = Infinity;

    for (const el of nodes) {
      if (exclude && (el === exclude || exclude.contains(el))) continue;
      if (!isVisible(el)) continue;

      const text = norm(el.textContent);
      if (!text || text.length > 40 || !re.test(text)) continue;

      const currentScore = score(el);
      if (currentScore < bestScore) {
        best = el;
        bestScore = currentScore;
      }
    }

    return best;
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
    await sleep(jitter(PACE.landing));

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

    // On « lit » le profil avant de faire quoi que ce soit.
    await simulateReading();

    // 1. Ouvrir le menu « Options »
    const optionsButton = await waitFor(() => findOptionsButton(), 12000, 250);
    if (!optionsButton) {
      return { status: 'error', detail: 'Bouton « Options » introuvable.' };
    }
    await sleep(jitter(PACE.beforeMenu));
    await humanClick(optionsButton);

    // 2. Cliquer sur « Bloquer » dans le menu
    const menuItem = await waitFor(() => findClickable(RE.block), 7000, 150);
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
      () => findClickable(RE.block, { exclude: menuItem }),
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

  /* ---------------------------------------------------------------- */

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'BLOCKWAVE_BLOCK') {
      blockCurrentProfile()
        .then(sendResponse)
        .catch((error) => sendResponse({ status: 'error', detail: String(error?.message || error) }));
      return true; // réponse asynchrone
    }

    if (message?.type === 'BLOCKWAVE_PING') {
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });
})();
