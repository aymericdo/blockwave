/* Blockwave — briques communes aux content scripts.
 *
 * Chargé juste avant le scénario de la plateforme (voir manifest.json). Script
 * classique, pas un module ES : l'API est exposée sur `window`, dans le monde
 * isolé de l'extension.
 *
 * Le but est de n'écrire qu'une fois ce qui est fragile : le clic « humain »,
 * l'attente d'un élément, la lecture simulée du profil. Le scénario lui-même
 * (quels boutons cliquer) reste propre à chaque réseau.
 */

(() => {
  const GUARD = '__blockwave_common__';
  if (window[GUARD]) return;

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
      await sleep(rand(120, 260));
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
      await sleep(rand(12, 34));
    }

    el.dispatchEvent(new Pointer('pointerover', base));
    el.dispatchEvent(new Pointer('pointerenter', base));
    el.dispatchEvent(new MouseEvent('mouseover', base));

    await sleep(rand(50, 130)); // temps de réaction avant l'appui

    el.dispatchEvent(new Pointer('pointerdown', { ...base, pointerId: 1, isPrimary: true, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));

    await sleep(rand(35, 80)); // maintien du bouton

    el.dispatchEvent(new Pointer('pointerup', { ...base, pointerId: 1, isPrimary: true, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));

    await sleep(rand(40, 90));
  }

  async function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await waitFor(() => window.scrollY < 4, 1500, 80);
    await sleep(rand(90, 220));
  }

  /** Fait semblant de parcourir le profil avant d'agir. */
  async function simulateReading(pace) {
    const passes = Math.random() < 0.6 ? 1 : 2;

    for (let i = 0; i < passes; i++) {
      window.scrollBy({ top: rand(180, 460), behavior: 'smooth' });
      await sleep(jitter(pace.readScroll));
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

  function findLabeledButton(re, scope = document) {
    for (const el of scope.querySelectorAll('[aria-label]')) {
      if (!re.test(norm(el.getAttribute('aria-label')))) continue;
      const button = el.closest('[role="button"], button, a') || el;
      if (isVisible(button)) return button;
    }
    return null;
  }

  /**
   * Cherche l'élément cliquable dont le texte colle à `re`. À défaut de
   * sélecteurs stables, c'est le texte visible qui sert d'ancre — d'où le
   * score : on préfère le libellé exact (« Bloquer ») au libellé long
   * (« Bloquer ce compte »), qui est souvent un conteneur parent.
   */
  function findClickable(
    re,
    { scope = document, exclude = null, maxLength = 40, exact = null } = {},
  ) {
    const nodes = scope.querySelectorAll(
      'button, [role="button"], [role="menuitem"], div[tabindex="0"], a[tabindex="0"]',
    );
    let best = null;
    let bestScore = Infinity;

    for (const el of nodes) {
      if (exclude && (el === exclude || exclude.contains(el))) continue;
      if (!isVisible(el)) continue;

      const text = norm(el.textContent);
      if (!text || text.length > maxLength || !re.test(text)) continue;

      const current = (exact && exact.test(text) ? 0 : 100) + text.length;
      if (current < bestScore) {
        best = el;
        bestScore = current;
      }
    }

    return best;
  }

  /**
   * Branche le scénario de blocage sur la messagerie de l'extension : un seul
   * listener par page, quel que soit le réseau.
   */
  function registerBlocker(block) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'BLOCKWAVE_BLOCK') {
        block()
          .then(sendResponse)
          .catch((error) =>
            sendResponse({ status: 'error', detail: String(error?.message || error) }),
          );
        return true; // réponse asynchrone
      }

      if (message?.type === 'BLOCKWAVE_PING') {
        sendResponse({ ok: true });
        return false;
      }

      return false;
    });
  }

  window[GUARD] = {
    sleep,
    rand,
    jitter,
    norm,
    isVisible,
    waitFor,
    humanClick,
    scrollToTop,
    simulateReading,
    pressEscape,
    findLabeledButton,
    findClickable,
    registerBlocker,
  };
})();
