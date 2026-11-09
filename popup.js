const REFRESH_MS = 1000;

const lamp = document.getElementById('lamp');
const rowsList = document.getElementById('rows');
const last = document.getElementById('last');
const soundResult = document.getElementById('sound-result');
const testSound = document.getElementById('test-sound');
const pick = document.getElementById('pick');

const clock = (timestamp) => new Date(timestamp).toLocaleTimeString('ru-RU');

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function getPageStatus() {
  const tabId = await activeTabId();
  if (!tabId) return null;
  try {
    return await chrome.tabs.sendMessage(tabId, 'get-status');
  } catch {
    return null; // На вкладке нет нашего скрипта.
  }
}

function setLamp(state, title, details) {
  lamp.dataset.state = state;
  lamp.querySelector('strong').textContent = title;
  lamp.querySelector('span').textContent = details;
}

function pipelinesCount(count) {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return `${count} пайплайнов`;
  if (ones === 1) return `${count} пайплайн`;
  if (ones >= 2 && ones <= 4) return `${count} пайплайна`;
  return `${count} пайплайнов`;
}

function verdict(row) {
  if (row.fired) return 'Уже сработало';
  if (!row.recent) return 'Завершился давно, не сработает';
  return 'Вот-вот сработает';
}

function renderLamp(status) {
  if (!status) {
    setLamp(
      'idle',
      'Эта вкладка не отслеживается',
      'Откройте список пайплайнов или обновите уже открытую страницу.',
    );
    return;
  }
  if (status.rows.length === 0 && !status.isPipelinesPage) {
    const found = status.elements.filter((element) => element.visible).length;
    setLamp('watching', 'Следит за этой вкладкой', `Элементов на странице: ${found} из ${status.elements.length}`);
    return;
  }
  if (status.rows.length === 0) {
    setLamp(
      'no-rows',
      'Подключено, но пайплайнов не видно',
      'Если список на экране есть, значит GitLab поменял разметку страницы.',
    );
    return;
  }
  const ago = status.lastScanAt === null
    ? 'проверка ещё не прошла'
    : `проверено ${Math.round((Date.now() - status.lastScanAt) / 1000)} с назад`;
  setLamp('watching', 'Следит за этой вкладкой', `${pipelinesCount(status.rows.length)}, ${ago}`);
}

function listItem(title, details) {
  const item = document.createElement('li');
  item.textContent = title;
  const note = document.createElement('small');
  note.textContent = details;
  item.append(note);
  return item;
}

function renderRows(status) {
  const matched = (status?.rows ?? []).filter((row) => row.ruleName);
  rowsList.replaceChildren(
    ...(status?.elements ?? []).map((element) =>
      listItem(element.name, element.visible ? 'Элемент виден на странице' : 'Элемента сейчас нет')),
    ...matched.map((row) =>
      listItem(`${row.number}${row.branch ? ` (${row.branch})` : ''}: ${row.ruleName}`, verdict(row))),
  );
}

function renderLast(lastAlert) {
  delete last.dataset.failed;
  if (!lastAlert) {
    last.textContent = 'Срабатываний ещё не было.';
  } else if (!lastAlert.ok) {
    last.textContent = `В ${clock(lastAlert.at)} звук не запустился: ${lastAlert.error}`;
    last.dataset.failed = '';
  } else if (lastAlert.gifError) {
    last.textContent = `В ${clock(lastAlert.at)} гифка не показалась: ${lastAlert.gifError}`;
    last.dataset.failed = '';
  } else {
    last.textContent = `Последнее срабатывание в ${clock(lastAlert.at)}: ${lastAlert.ruleName}, ${lastAlert.pipelines.join(', ')}`;
  }
}

async function render() {
  const [status, { lastAlert }] = await Promise.all([
    getPageStatus(),
    chrome.storage.local.get('lastAlert'),
  ]);
  renderLamp(status);
  renderRows(status);
  renderLast(lastAlert);
  pick.disabled = !status;
}

testSound.addEventListener('click', async () => {
  testSound.disabled = true;
  soundResult.textContent = '';
  const result = await chrome.runtime.sendMessage('play-alert');
  soundResult.textContent = result?.ok ? 'Звук запустился.' : `Звук не запустился: ${result?.error ?? 'нет ответа от расширения'}`;
  testSound.disabled = false;
});

pick.addEventListener('click', async () => {
  await chrome.tabs.sendMessage(await activeTabId(), 'start-picker');
  window.close();
});

document.getElementById('open-options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('open-test').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('test.html') });
});

render();
setInterval(render, REFRESH_MS);
