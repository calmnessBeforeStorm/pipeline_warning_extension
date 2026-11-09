const audio = document.querySelector('audio');

chrome.runtime.sendMessage({ type: 'get-sound' })
  .then(({ src }) => {
    audio.src = src;
    return audio.play();
  })
  .then(() => chrome.runtime.sendMessage({ type: 'audio-result', ok: true, durationMs: audio.duration * 1000 }))
  .catch((error) => chrome.runtime.sendMessage({ type: 'audio-result', ok: false, error: error.message }));
