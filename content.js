// Старые падения из истории не должны орать при каждом открытии страницы.
const ALERT_WINDOW_MS = 10 * 60 * 1000;
const FORGET_AFTER_MS = 24 * 60 * 60 * 1000;
const SCAN_DEBOUNCE_MS = 500;

const ROW_SELECTOR = 'tr[data-testid="pipeline-table-row"]';
const STAGE_SELECTOR = '[data-testid="pipeline-mini-graph-dropdown-toggle"]';

const presentOnPage = new Set();
let lastScanAt = null;

const normalizeText = (text) => text.replace(/\s+/g, ' ').trim();

function findElements(root, { selector, text }) {
  let found;
  try {
    found = [...root.querySelectorAll(selector)];
  } catch {
    return []; // Селектор с ошибкой просто ничего не находит.
  }
  return found.filter((el) =>
    el.getClientRects().length > 0 && (!text || normalizeText(el.textContent) === text));
}

function isFailed(stage) {
  return stage.querySelector('[data-testid^="status_failed"]') !== null;
}

function conditionHolds(condition, row) {
  if (condition.type === 'preset') {
    return [...row.querySelectorAll(STAGE_SELECTOR)].slice(1).some(isFailed);
  }
  return findElements(row, condition).length > 0;
}

function branchOf(row) {
  return row.querySelector('a[data-testid="commit-ref-name"]')?.textContent.trim() ?? '';
}

// Пустой шаблон подходит ко всему, звёздочка заменяет любую часть значения.
function wildcardMatches(pattern, value) {
  if (!pattern) return true;
  const source = pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${source}$`).test(value);
}

// У пайплайна, который ещё идёт, времени завершения нет: это свежее падение.
function failedRecently(row) {
  const finishedAt = row.querySelector('[data-testid="finished-at"] time')?.dateTime;
  return !finishedAt || Date.now() - Date.parse(finishedAt) < ALERT_WINDOW_MS;
}

const appliesToRows = (rule) => rule.condition.type === 'preset' || rule.condition.inRow;

function readRows(rules) {
  const rowRules = rules.filter((rule) => rule.enabled && appliesToRows(rule));
  const rows = [];
  for (const row of document.querySelectorAll(ROW_SELECTOR)) {
    const link = row.querySelector('a[data-testid="pipeline-url-link"]');
    // Стейджи могут дорисоваться позже строки: пустая строка ничего не значит.
    if (!link || !row.querySelector(STAGE_SELECTOR)) continue;

    const branch = branchOf(row);
    rows.push({
      id: link.getAttribute('href'),
      number: link.textContent.trim(),
      branch,
      recent: failedRecently(row),
      // Побеждает первое подходящее правило, порядок задаётся в настройках.
      rule: rowRules.find((rule) => wildcardMatches(rule.branch, branch) && conditionHolds(rule.condition, row)) ?? null,
    });
  }
  return rows;
}

function scanRows(rows, alerted) {
  const fired = [];
  let changed = false;
  for (const row of rows) {
    const suffix = `|${row.id}`;
    if (!row.rule) {
      // Пайплайн перезапустили: если упадёт снова, звук должен сработать ещё раз.
      for (const key of Object.keys(alerted)) {
        if (key.endsWith(suffix)) {
          delete alerted[key];
          changed = true;
        }
      }
      continue;
    }
    const key = row.rule.id + suffix;
    if (!alerted[key] && row.recent) {
      alerted[key] = Date.now();
      changed = true;
      fired.push({ rule: row.rule, label: row.number });
    }
  }
  return { fired, changed };
}

function pageRulesHere(rules) {
  return rules.filter((rule) =>
    rule.enabled && !appliesToRows(rule) && wildcardMatches(rule.page, location.pathname));
}

const elementVisible = (rule) => findElements(document, rule.condition).length > 0;

function scanPage(rules) {
  const fired = [];
  const here = pageRulesHere(rules);
  for (const id of presentOnPage) {
    if (!here.some((rule) => rule.id === id)) presentOnPage.delete(id);
  }
  for (const rule of here) {
    if (!elementVisible(rule)) {
      presentOnPage.delete(rule.id);
    } else if (!presentOnPage.has(rule.id)) {
      presentOnPage.add(rule.id);
      fired.push({ rule, label: rule.name });
    }
  }
  return fired;
}

function forgetOld(alerted) {
  let changed = false;
  for (const [key, alertedAt] of Object.entries(alerted)) {
    if (Date.now() - alertedAt > FORGET_AFTER_MS) {
      delete alerted[key];
      changed = true;
    }
  }
  return changed;
}

async function scan() {
  const { alerted = {}, rules = [] } = await chrome.storage.local.get(['alerted', 'rules']);
  const { fired: rowFired, changed } = scanRows(readRows(rules), alerted);
  const fired = [...rowFired, ...scanPage(rules)];

  // Чтобы вкладки не затирали записи друг друга, пишем только изменения.
  if (forgetOld(alerted) || changed) await chrome.storage.local.set({ alerted });
  lastScanAt = Date.now();
  if (fired.length === 0) return;

  // Несколько звуков разом слились бы в кашу: играет первое правило.
  const { rule } = fired[0];
  const pipelines = fired.filter((item) => item.rule.id === rule.id).map((item) => item.label);
  const result = await chrome.runtime.sendMessage({ type: 'fire', ruleId: rule.id });
  await chrome.storage.local.set({
    lastAlert: { ruleName: rule.name, pipelines, at: Date.now(), ...result },
  });
}

let pending = Promise.resolve();
let debounce;

function scheduleScan() {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    pending = pending.then(scan).catch(console.error);
  }, SCAN_DEBOUNCE_MS);
}

new MutationObserver(scheduleScan).observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['data-testid', 'title', 'datetime', 'style', 'class', 'hidden'],
});
scheduleScan();

chrome.storage.onChanged.addListener((changes) => {
  if (changes.rules) scheduleScan();
});

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message !== 'get-status') return;
  chrome.storage.local.get(['alerted', 'rules']).then(({ alerted = {}, rules = [] }) => {
    const rows = readRows(rules).map((row) => ({
      number: row.number,
      branch: row.branch,
      ruleName: row.rule?.name ?? null,
      recent: row.recent,
      fired: row.rule ? Boolean(alerted[`${row.rule.id}|${row.id}`]) : false,
    }));
    const elements = pageRulesHere(rules).map((rule) => ({ name: rule.name, visible: elementVisible(rule) }));
    reply({ rows, elements, isPipelinesPage: location.pathname.endsWith('/-/pipelines'), lastScanAt });
  });
  return true;
});
