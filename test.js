const STAGE_NAMES = ['verify', 'security_checks', 'build', 'deploy_secrets', 'deploy', 'migrate', 'cleanup'];
const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_MS = 10 * 60 * 1000; // Независимая копия окна из content.js: это ожидание теста.
const SOUND_LENGTH_MS = 4500;

const STATUS_LOOK = {
  passed: { icon: 'success', variant: 'success', path: 'M6.8 11.2 3.6 8l1.1-1.1 2.1 2.1 4.5-4.5L12.4 5.6z' },
  failed: { icon: 'failed', variant: 'danger', path: 'M9.1 8l2.5 2.5-1.1 1.1L8 9.1l-2.5 2.5-1.1-1.1L6.9 8 4.4 5.5l1.1-1.1L8 6.9l2.5-2.5 1.1 1.1z' },
  skipped: { icon: 'skipped', variant: 'neutral', path: 'M4 7h8v2H4z' },
  running: { icon: 'running', variant: 'info', path: 'M8 3.5a4.5 4.5 0 1 1-4.5 4.5H5a3 3 0 1 0 3-3z' },
  created: { icon: 'created', variant: 'neutral', path: 'M6.5 6.5h3v3h-3z' },
};

const tbody = document.getElementById('pipelines');
const signal = document.getElementById('signal');

if (!globalThis.chrome?.storage) {
  signal.dataset.state = 'error';
  signal.textContent = 'Так страница не работает: откройте её кнопкой «Открыть тестовую страницу» в окне расширения.';
  throw new Error('test.html открыт не из расширения');
}

const pipelines = new Map();
let alerted = {};
let nextId = Math.floor(Date.now() / 1000) % 1000000;

const P = 'passed', F = 'failed', S = 'skipped', R = 'running', C = 'created';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hrefOf = (pipeline) => `/test/-/pipelines/${pipeline.number}`;

function icon(status) {
  const look = STATUS_LOOK[status];
  return `<span class="ci-icon ci-icon-variant-${look.variant}" data-testid="ci-icon"><svg data-testid="status_${look.icon}_borderless-icon" role="img" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7.5" fill-opacity=".16"/><path d="${look.path}"/></svg></span>`;
}

function stageHtml(name, status, index) {
  return `<div class="pipeline-mini-graph-stage-container"><div data-testid="pipeline-mini-graph-dropdown" aria-label="View Stage: ${name}"><button data-testid="pipeline-mini-graph-dropdown-toggle" class="stage-button" data-stage="${index}" title="${name}: ${status}" type="button">${icon(status)}</button></div></div>`;
}

function overallStatus(stages) {
  if (stages.includes(F)) return F;
  if (stages.includes(R) || stages.includes(C)) return R;
  return P;
}

function expectedResult(pipeline) {
  const [first, ...rest] = pipeline.stages;
  if (!rest.includes(F)) return first === F ? 'Без звука: упал только первый стейдж' : 'Без звука: красных стейджей нет';
  const old = pipeline.finishedAt && Date.now() - Date.parse(pipeline.finishedAt) >= RECENT_MS;
  return old ? 'Без звука: упал давно' : 'Звук';
}

function factHtml(pipeline) {
  return Object.keys(alerted).some((key) => key.endsWith(`|${hrefOf(pipeline)}`))
    ?'<span class="fact" data-played>Звук сыграл</span>'
    : '<span class="fact">Звука не было</span>';
}

function rowHtml(pipeline) {
  const overall = overallStatus(pipeline.stages);
  const finished = pipeline.finishedAt
    ? `<p data-testid="finished-at"><time datetime="${pipeline.finishedAt}">${new Date(pipeline.finishedAt).toLocaleString('ru-RU')}</time></p>`
    : '';
  const label = { failed: 'Failed', passed: 'Passed', running: 'Running' }[overall];
  return `<tr data-testid="pipeline-table-row" data-number="${pipeline.number}">
    <td><a class="row-status" href="${hrefOf(pipeline)}">${icon(overall)}<span data-testid="ci-icon-text">${label}</span></a>${finished}</td>
    <td><div class="commit-title">${pipeline.title}</div><a href="${hrefOf(pipeline)}" data-testid="pipeline-url-link">#${pipeline.number}</a></td>
    <td><div data-testid="pipeline-mini-graph" class="stages">${pipeline.stages.map((status, i) => stageHtml(STAGE_NAMES[i], status, i)).join('')}</div></td>
    <td class="expected">${expectedResult(pipeline)}</td>
    <td class="fact-cell">${factHtml(pipeline)}</td>
  </tr>`;
}

function addPipeline(fields) {
  const pipeline = { number: ++nextId, ...fields };
  pipelines.set(pipeline.number, pipeline);
  tbody.insertAdjacentHTML('afterbegin', rowHtml(pipeline));
  return pipeline;
}

function update(pipeline, fields) {
  Object.assign(pipeline, fields);
  tbody.querySelector(`[data-number="${pipeline.number}"]`).outerHTML = rowHtml(pipeline);
}

const failedDeploy = [F, S, P, P, F, S, P];
const runningDeploy = [P, S, P, P, R, C, C];

const scenarios = {
  deploy: () => addPipeline({ title: 'Упал deploy', stages: failedDeploy, finishedAt: new Date().toISOString() }),
  first: () => addPipeline({ title: 'Упал только первый стейдж', stages: [F, S, P, P, P, P, P], finishedAt: new Date().toISOString() }),
  old: () => addPipeline({ title: 'Старое падение deploy', stages: failedDeploy, finishedAt: new Date(Date.now() - 6 * DAY_MS).toISOString() }),
  delayed: async () => {
    const pipeline = addPipeline({ title: 'Упадёт через 5 секунд', stages: runningDeploy, finishedAt: null });
    await pause(5000);
    update(pipeline, { stages: [P, S, P, P, F, C, C] });
  },
  retry: async () => {
    const pipeline = addPipeline({ title: 'Упадёт, перезапустится, упадёт', stages: failedDeploy, finishedAt: new Date().toISOString() });
    await pause(SOUND_LENGTH_MS);
    update(pipeline, { stages: runningDeploy, finishedAt: null });
    await pause(1500);
    update(pipeline, { stages: failedDeploy, finishedAt: new Date().toISOString() });
  },
};

document.getElementById('scenarios').addEventListener('click', (event) => {
  const button = event.target.closest('[data-scenario]');
  if (button) scenarios[button.dataset.scenario]();
});

tbody.addEventListener('click', (event) => {
  if (event.target.closest('a')) event.preventDefault();
  const stage = event.target.closest('[data-stage]');
  if (!stage) return;
  const pipeline = pipelines.get(Number(stage.closest('tr').dataset.number));
  const stages = [...pipeline.stages];
  stages[stage.dataset.stage] = stages[stage.dataset.stage] === F ? P : F;
  update(pipeline, { stages });
});

function showLastAlert(lastAlert, flash) {
  if (!lastAlert) return;
  const time = new Date(lastAlert.at).toLocaleTimeString('ru-RU');
  signal.dataset.state = lastAlert.ok ? 'fired' : 'error';
  signal.textContent = lastAlert.ok
    ? `Звук сработал в ${time}: ${lastAlert.pipelines.join(', ')}`
    : `В ${time} звук не запустился: ${lastAlert.error}`;
  if (flash) {
    signal.classList.remove('flash');
    void signal.offsetWidth; // Перезапускает анимацию при новом срабатывании.
    signal.classList.add('flash');
  }
}

function refreshFacts() {
  for (const pipeline of pipelines.values()) {
    tbody.querySelector(`[data-number="${pipeline.number}"] .fact-cell`).innerHTML = factHtml(pipeline);
  }
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.alerted) {
    alerted = changes.alerted.newValue ?? {};
    refreshFacts();
  }
  if (changes.lastAlert) showLastAlert(changes.lastAlert.newValue, true);
});

chrome.storage.local.get(['alerted', 'lastAlert']).then((stored) => {
  alerted = stored.alerted ?? {};
  refreshFacts();
  showLastAlert(stored.lastAlert, false);
});

addPipeline({
  title: 'feat(finance): bank products in the payment order queue row',
  stages: failedDeploy,
  finishedAt: new Date(Date.now() - 6 * DAY_MS).toISOString(),
});
addPipeline({
  title: 'Merge origin/development: bank products in payment orders, CI tags',
  stages: [F, S, P, P, P, P, P],
  finishedAt: new Date(Date.now() - 6 * DAY_MS).toISOString(),
});
