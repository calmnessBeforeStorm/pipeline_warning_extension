const SETTINGS_FORMAT = 'pipeline-warning-settings';
const REPORT_FORMAT = 'pipeline-warning-report';
const FORMAT_VERSION = 1;
const GITLAB_TABS = 'https://code.nkz.icdc.io/*';
const REVOKE_DELAY_MS = 10000;

const importFile = document.getElementById('import-file');
const importStatus = document.getElementById('import-status');
const importConfirm = document.getElementById('import-confirm');
const importCancel = document.getElementById('import-cancel');
const reportStatus = document.getElementById('report-status');
const logBody = document.getElementById('log');
const logEmpty = document.getElementById('log-empty');
const logTable = document.getElementById('log-table');

const fileKey = (fileId) => `file:${fileId}`;
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function fileIdsOf(rules) {
  return [...new Set(rules.flatMap((rule) => [rule.sound?.fileId, rule.gif?.fileId]).filter(Boolean))];
}

function downloadJson(prefix, data) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${prefix}-${stamp}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

function setStatus(element, state, text) {
  element.dataset.state = state;
  element.textContent = text;
}

// Проверяем файл ещё здесь: на другом браузере исправлять его будет уже не из чего.
async function exportSettings() {
  const { rules: storedRules = [] } = await chrome.storage.local.get('rules');
  const stored = await chrome.storage.local.get(fileIdsOf(storedRules).map(fileKey));
  const keepIfStored = (attachment) => (attachment && stored[fileKey(attachment.fileId)] ? attachment : null);
  const rules = storedRules.map((rule) => ({ ...rule, sound: keepIfStored(rule.sound), gif: keepIfStored(rule.gif) }));
  const files = Object.fromEntries(fileIdsOf(rules).map((id) => [id, stored[fileKey(id)]]));
  const settings = {
    format: SETTINGS_FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    rules,
    files,
  };
  const problem = settingsProblem(settings);
  if (problem) throw new Error(problem);
  downloadJson(SETTINGS_FORMAT, settings);
}

function conditionProblem(condition) {
  if (!isObject(condition)) return 'нет условия';
  if (condition.type === 'preset') return '';
  if (condition.type !== 'selector') return 'неизвестный тип условия';
  const complete = typeof condition.selector === 'string'
    && typeof condition.text === 'string'
    && typeof condition.inRow === 'boolean';
  return complete ? '' : 'неполное условие';
}

// Только data-адреса: файл настроек не должен заставлять браузер ходить по чужим ссылкам.
function attachmentProblem(attachment, files) {
  if (attachment === null || attachment === undefined) return '';
  if (!isObject(attachment) || typeof attachment.name !== 'string' || typeof attachment.fileId !== 'string') {
    return 'неверное описание файла';
  }
  const body = files[attachment.fileId];
  return typeof body === 'string' && body.startsWith('data:') ? '' : `нет содержимого файла «${attachment.name}»`;
}

function ruleProblem(rule, files) {
  if (!isObject(rule)) return 'это не правило';
  const fieldsValid = typeof rule.id === 'string' && rule.id !== ''
    && typeof rule.name === 'string'
    && typeof rule.enabled === 'boolean'
    && typeof rule.branch === 'string'
    && (rule.page === undefined || typeof rule.page === 'string');
  if (!fieldsValid) return 'неверные поля правила';
  return conditionProblem(rule.condition)
    || attachmentProblem(rule.sound, files)
    || attachmentProblem(rule.gif, files);
}

// Ошибка в правиле сломала бы проверку страницы на всех вкладках, поэтому проверяем всё заранее.
function settingsProblem(data) {
  if (!isObject(data) || data.format !== SETTINGS_FORMAT) return 'Это не файл настроек Pipeline Warning.';
  if (data.version !== FORMAT_VERSION) return `Версия файла ${data.version} не поддерживается.`;
  if (!Array.isArray(data.rules) || !isObject(data.files)) return 'В файле нет правил или вложений.';
  if (new Set(data.rules.map((rule) => rule?.id)).size !== data.rules.length) return 'В файле повторяются правила.';
  for (const [index, rule] of data.rules.entries()) {
    const problem = ruleProblem(rule, data.files);
    if (problem) return `Правило ${index + 1}: ${problem}.`;
  }
  return '';
}

function parseSettings(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Файл повреждён: это не JSON.');
  }
  const problem = settingsProblem(data);
  if (problem) throw new Error(problem);
  return data;
}

// Сначала запись, потом уборка: иначе повторная загрузка удалила бы файлы с теми же id.
async function applySettings({ rules, files }) {
  const entries = Object.fromEntries(fileIdsOf(rules).map((id) => [fileKey(id), files[id]]));
  await chrome.storage.local.set({ rules, ...entries });
  const stored = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(stored).filter((key) => key.startsWith('file:') && !(key in entries)));
}

let pendingImport = null;

function setPendingImport(data) {
  pendingImport = data;
  importConfirm.hidden = data === null;
  importCancel.hidden = data === null;
}

async function previewImport(file) {
  setPendingImport(null);
  try {
    const data = parseSettings(await file.text());
    const { rules: current = [] } = await chrome.storage.local.get('rules');
    setPendingImport(data);
    setStatus(
      importStatus,
      'pending',
      `В файле правил: ${data.rules.length}, файлов: ${fileIdsOf(data.rules).length}. Текущие правила (${current.length}) будут заменены.`,
    );
  } catch (error) {
    setStatus(importStatus, 'error', error.message);
  }
}

async function confirmImport() {
  const data = pendingImport;
  setPendingImport(null);
  try {
    await applySettings(data);
    setStatus(importStatus, 'done', `Настройки загружены, правил: ${data.rules.length}.`);
  } catch (error) {
    setStatus(importStatus, 'error', `Не удалось сохранить настройки: ${error.message}`);
  }
}

async function builtinSoundState() {
  const { src } = await chrome.runtime.sendMessage({ type: 'get-builtin-sound' });
  const available = await fetch(src).then((response) => response.ok, () => false);
  return { src, available };
}

// Вкладка, открытая до обновления расширения, не ответит: status будет null.
async function gitlabTabs() {
  const tabs = await chrome.tabs.query({ url: GITLAB_TABS });
  return Promise.all(tabs.map(async (tab) => ({
    url: tab.url,
    status: await chrome.tabs.sendMessage(tab.id, 'get-status').catch(() => null),
  })));
}

async function downloadReport() {
  const [stored, builtinSound, tabs] = await Promise.all([
    chrome.storage.local.get(['rules', 'alerted', 'lastAlert', 'alertLog']),
    builtinSoundState(),
    gitlabTabs(),
  ]);
  const manifest = chrome.runtime.getManifest();
  downloadJson(REPORT_FORMAT, {
    format: REPORT_FORMAT,
    version: FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    extension: { id: chrome.runtime.id, version: manifest.version },
    browser: navigator.userAgent,
    builtinSound,
    rules: stored.rules ?? [],
    lastAlert: stored.lastAlert ?? null,
    alertLog: stored.alertLog ?? [],
    alerted: stored.alerted ?? {},
    tabs,
  });
  setStatus(reportStatus, 'done', 'Отчёт скачан.');
}

function cell(text, className) {
  const element = document.createElement('td');
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

const itemText = ({ label, branch }) => (branch ? `${label} (${branch})` : label);

function resultCell({ ok, error, gifError }) {
  if (!ok) return cell(`Звук не запустился: ${error ?? 'неизвестная ошибка'}`, 'failed');
  if (gifError) return cell(`Гифка не показалась: ${gifError}`, 'failed');
  return cell('Сработало');
}

function logRow(entry) {
  const row = document.createElement('tr');
  row.append(
    cell(new Date(entry.at).toLocaleString('ru-RU')),
    cell(entry.ruleName),
    cell(entry.items.map(itemText).join(', ')),
    cell(entry.url ? new URL(entry.url).pathname : '—'),
    resultCell(entry),
  );
  return row;
}

function renderLog(entries) {
  logBody.replaceChildren(...entries.map(logRow));
  logEmpty.hidden = entries.length > 0;
  logTable.hidden = entries.length === 0;
}

document.getElementById('export-settings').addEventListener('click', () => {
  exportSettings().catch((error) => setStatus(importStatus, 'error', `Не удалось скачать настройки: ${error.message}`));
});

importFile.addEventListener('change', async () => {
  const [file] = importFile.files;
  if (!file) return;
  await previewImport(file);
  importFile.value = ''; // Иначе повторный выбор того же файла не сработает.
});

importConfirm.addEventListener('click', confirmImport);

importCancel.addEventListener('click', () => {
  setPendingImport(null);
  setStatus(importStatus, 'idle', '');
});

document.getElementById('download-report').addEventListener('click', () => {
  downloadReport().catch((error) => setStatus(reportStatus, 'error', `Не удалось собрать отчёт: ${error.message}`));
});

document.getElementById('clear-log').addEventListener('click', () => {
  chrome.storage.local.remove('alertLog');
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.alertLog) renderLog(changes.alertLog.newValue ?? []);
});

chrome.storage.local.get('alertLog').then(({ alertLog = [] }) => renderLog(alertLog));
