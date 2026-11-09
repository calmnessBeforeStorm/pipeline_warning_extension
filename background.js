importScripts('gif-overlay.js');

const AUDIO_START_TIMEOUT_MS = 5000;
const DEFAULT_GIF_MS = 5000;
const BUILTIN_SOUND = 'blyyaaaaaaaaaaaat.mp3';

const DEFAULT_RULE = {
  id: 'default',
  name: 'Упал любой стейдж, кроме первого',
  enabled: true,
  branch: '',
  condition: { type: 'preset', name: 'failed-after-first' },
  sound: null,
  gif: null,
};

chrome.runtime.onInstalled.addListener(async () => {
  const { rules } = await chrome.storage.local.get('rules');
  if (!rules) await chrome.storage.local.set({ rules: [DEFAULT_RULE] });
});

// Offscreen-документ заберёт этот адрес сам, когда загрузится.
let currentSound = BUILTIN_SOUND;

function waitForAudioResult() {
  return new Promise((resolve, reject) => {
    const finish = (settle, value) => {
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(onMessage);
      settle(value);
    };
    const onMessage = (message) => {
      if (message?.type !== 'audio-result') return;
      if (message.ok) finish(resolve, message.durationMs);
      else finish(reject, new Error(message.error));
    };
    const timer = setTimeout(
      () => finish(reject, new Error('файл не начал играть за 5 секунд')),
      AUDIO_START_TIMEOUT_MS,
    );
    chrome.runtime.onMessage.addListener(onMessage);
  });
}

// Звук играет в offscreen-документе: обычная вкладка без клика пользователя
// не может запустить аудио из-за политики автозапуска Chrome.
async function playSound(src) {
  currentSound = src;
  const audioResult = waitForAudioResult();
  audioResult.catch(() => {}); // Если упадёт createDocument, ошибку вернёт он.
  if (await chrome.offscreen.hasDocument()) {
    await chrome.offscreen.closeDocument();
  }
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Звуковое оповещение о падении пайплайна',
  });
  return audioResult;
}

async function drawGif(tabId, dataUrl, durationMs) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url?.startsWith(chrome.runtime.getURL(''))) {
    await chrome.tabs.sendMessage(tabId, { type: 'render-gif', dataUrl, durationMs });
  } else {
    await chrome.scripting.executeScript({ target: { tabId }, func: renderGifOverlay, args: [dataUrl, durationMs] });
  }
}

// На служебных страницах Chrome рисовать нельзя: тогда показываем на вкладке GitLab.
async function showGif(dataUrl, durationMs, fallbackTabId) {
  const focusedWindow = await chrome.windows.getLastFocused();
  const [activeTab] = await chrome.tabs.query({ active: true, windowId: focusedWindow.id });
  let lastError = new Error('нет подходящей вкладки');
  for (const tabId of new Set([activeTab?.id, fallbackTabId].filter(Boolean))) {
    try {
      await drawGif(tabId, dataUrl, durationMs);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function readFile(fileId) {
  if (!fileId) return null;
  const key = `file:${fileId}`;
  return (await chrome.storage.local.get(key))[key] ?? null;
}

async function fireRule(ruleId, senderTabId) {
  const { rules = [] } = await chrome.storage.local.get('rules');
  const rule = rules.find((item) => item.id === ruleId);
  if (!rule) return { ok: false, error: 'правило удалено' };

  const [sound, gif] = await Promise.all([readFile(rule.sound?.fileId), readFile(rule.gif?.fileId)]);
  const result = { ok: true };
  let gifMs = DEFAULT_GIF_MS;
  try {
    const durationMs = await playSound(sound ?? BUILTIN_SOUND);
    if (Number.isFinite(durationMs)) gifMs = durationMs;
  } catch (error) {
    result.ok = false;
    result.error = error.message;
  }
  if (gif) {
    try {
      await showGif(gif, gifMs, senderTabId);
    } catch (error) {
      result.gifError = error.message;
    }
  }
  return result;
}

async function addPickedRule({ condition, name, branch, page, matchCount }) {
  const { rules = [] } = await chrome.storage.local.get('rules');
  const rule = { id: crypto.randomUUID(), name, enabled: true, branch, page, condition, matchCount, sound: null, gif: null };
  // Новое правило точнее старых, а побеждает первое подходящее.
  await chrome.storage.local.set({ rules: [rule, ...rules] });
  await chrome.runtime.openOptionsPage();
  return { ok: true };
}

let pending = Promise.resolve();

function enqueue(job, reply) {
  pending = pending
    .then(job)
    .then((result) => reply(result))
    .catch((error) => reply({ ok: false, error: error.message }));
  return true;
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message === 'play-alert') {
    return enqueue(async () => {
      await playSound(BUILTIN_SOUND);
      return { ok: true };
    }, reply);
  }
  if (message?.type === 'get-sound') {
    reply({ src: currentSound });
  } else if (message?.type === 'fire') {
    return enqueue(() => fireRule(message.ruleId, sender.tab?.id), reply);
  } else if (message?.type === 'element-picked') {
    return enqueue(() => addPickedRule(message), reply);
  }
});
