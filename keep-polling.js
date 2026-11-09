// GitLab перестаёт опрашивать статусы пайплайнов, пока вкладка скрыта.
// Без этого таблица в фоновой вкладке замирает и падение не заметить.
Object.defineProperty(document, 'hidden', { get: () => false });
Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
window.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
