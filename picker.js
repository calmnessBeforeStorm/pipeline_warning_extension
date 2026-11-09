// Режим выбора элемента. Использует ROW_SELECTOR, findElements и другие функции из content.js.
{
  const SWALLOWED_EVENTS = ['pointerdown', 'mousedown', 'mouseup', 'click'];
  const WALK_UP_LIMIT = 6;
  const TEXT_LIMIT = 60;
  let stopPicker = null;

  // Значения с цифрами меняются от загрузки к загрузке: это id, даты и счётчики.
  const stable = (value) => Boolean(value?.trim()) && !/\d/.test(value);
  const attr = (name, value) => `[${name}="${value.replace(/["\\]/g, '\\$&')}"]`;

  function walkUp(start, row, accept) {
    let node = start;
    for (let i = 0; node && node !== row && node !== document.body && i < WALK_UP_LIMIT; i++) {
      if (accept(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  // Клик чаще всего попадает во внутренности значка, а смысл несёт кнопка с title
  // вроде "deploy: failed", поэтому сначала ищем title выше по дереву.
  function chooseElement(target, row) {
    const start = target.closest('svg') ?? target;
    return walkUp(start, row, (node) => stable(node.getAttribute('title')))
      ?? walkUp(start, row, (node) => node.hasAttribute('data-testid') || stable(node.getAttribute('aria-label')))
      ?? start;
  }

  function buildSelector(element) {
    const testId = element.getAttribute('data-testid');
    const title = element.getAttribute('title');
    const ariaLabel = element.getAttribute('aria-label');
    let selector = element.localName;
    if (testId) selector += attr('data-testid', testId);
    if (stable(title)) selector += attr('title', title);
    if (!testId && !stable(title) && stable(ariaLabel)) selector += attr('aria-label', ariaLabel);
    return selector;
  }

  function buildText(element) {
    if (stable(element.getAttribute('title'))) return '';
    const text = normalizeText(element.textContent);
    return text.length <= TEXT_LIMIT && stable(text) ? text : '';
  }

  function describe(target) {
    const row = target.closest(ROW_SELECTOR);
    const element = chooseElement(target, row);
    const condition = { type: 'selector', selector: buildSelector(element), text: buildText(element), inRow: Boolean(row) };
    const matchCount = row
      ? [...document.querySelectorAll(ROW_SELECTOR)].filter((r) => findElements(r, condition).length > 0).length
      : findElements(document, condition).length;
    return {
      type: 'element-picked',
      condition,
      name: element.getAttribute('title') || condition.text || condition.selector,
      branch: row ? branchOf(row) : '',
      page: row ? '' : location.pathname,
      matchCount,
    };
  }

  function createUi() {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;outline:2px solid #c62f2a;background:rgba(198,47,42,.15);display:none';
    const banner = document.createElement('div');
    banner.textContent = 'Кликните элемент, за которым надо следить. Esc отменяет выбор.';
    banner.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;top:0;left:0;right:0;padding:10px;background:#c62f2a;color:#fff;font:600 15px system-ui,sans-serif;text-align:center';
    document.documentElement.append(box, banner);
    return { box, banner };
  }

  function startPicker() {
    if (stopPicker) return;
    const { box, banner } = createUi();

    const onMove = (event) => {
      const rect = chooseElement(event.target, event.target.closest(ROW_SELECTOR)).getBoundingClientRect();
      Object.assign(box.style, {
        display: 'block',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    };
    const swallow = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      // Клик мимо элементов дал бы правило, которое срабатывает всегда.
      if (event.type !== 'click' || event.target === document.documentElement || event.target === document.body) return;
      chrome.runtime.sendMessage(describe(event.target));
      stopPicker();
    };
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      stopPicker();
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('keydown', onKey, true);
    for (const type of SWALLOWED_EVENTS) window.addEventListener(type, swallow, true);

    stopPicker = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('keydown', onKey, true);
      for (const type of SWALLOWED_EVENTS) window.removeEventListener(type, swallow, true);
      box.remove();
      banner.remove();
      stopPicker = null;
    };
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message === 'start-picker') startPicker();
  });
}
