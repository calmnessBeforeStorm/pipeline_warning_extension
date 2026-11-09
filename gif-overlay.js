// Функция передаётся во вкладки целиком, поэтому не может использовать ничего извне.
function renderGifOverlay(dataUrl, durationMs) {
  document.querySelector('[data-pipeline-warning-gif]')?.remove();
  const image = document.createElement('img');
  image.src = dataUrl;
  image.alt = '';
  image.dataset.pipelineWarningGif = '';
  image.style.cssText = 'position:fixed;z-index:2147483647;top:50%;left:50%;transform:translate(-50%,-50%);max-width:60vw;max-height:60vh;pointer-events:none';
  document.documentElement.append(image);
  setTimeout(() => image.remove(), durationMs);
}

// В свои страницы расширение не может внедрять код, они рисуют гифку сами.
if (typeof document !== 'undefined') {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'render-gif') renderGifOverlay(message.dataUrl, message.durationMs);
  });
}
