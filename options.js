const list = document.getElementById('rules');
const template = document.getElementById('rule-template');

const fileKey = (fileId) => `file:${fileId}`;
const getRules = async () => (await chrome.storage.local.get('rules')).rules ?? [];
const saveRules = (rules) => chrome.storage.local.set({ rules });

async function patchRule(id, patch) {
  const rules = await getRules();
  Object.assign(rules.find((rule) => rule.id === id), patch);
  await saveRules(rules);
}

async function patchCondition(id, patch) {
  const rules = await getRules();
  const rule = rules.find((item) => item.id === id);
  rule.condition = { ...rule.condition, ...patch };
  await saveRules(rules);
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function setRuleFile(rule, field, file) {
  if (rule[field]) await chrome.storage.local.remove(fileKey(rule[field].fileId));
  if (!file) {
    await patchRule(rule.id, { [field]: null });
    return;
  }
  const fileId = crypto.randomUUID();
  await chrome.storage.local.set({ [fileKey(fileId)]: await readAsDataUrl(file) });
  await patchRule(rule.id, { [field]: { name: file.name, fileId } });
}

function selectorError(selector) {
  try {
    document.createDocumentFragment().querySelector(selector);
    return '';
  } catch {
    return 'В селекторе ошибка, правило работает с предыдущим значением.';
  }
}

function textInput(className, value, label) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = className;
  input.value = value;
  input.setAttribute('aria-label', label);
  return input;
}

function note(text, className = 'note') {
  const paragraph = document.createElement('p');
  paragraph.className = className;
  paragraph.textContent = text;
  return paragraph;
}

function renderCondition(container, rule) {
  const { condition } = rule;
  if (condition.type === 'preset') {
    container.append(note('Красный любой стейдж, кроме первого'));
    return;
  }

  const selector = textInput('selector', condition.selector, 'CSS-селектор элемента');
  const text = textInput('element-text', condition.text, 'Текст элемента');
  text.placeholder = 'любой текст';
  const error = note('', 'error');
  const place = condition.inRow ? 'Ищется внутри строки пайплайна' : 'Ищется на всей странице';
  const found = rule.matchCount === undefined ? '' : `, при выборе нашлось: ${rule.matchCount}`;

  selector.addEventListener('change', () => {
    const message = selectorError(selector.value);
    error.textContent = message;
    selector.setAttribute('aria-invalid', String(Boolean(message)));
    if (!message) patchCondition(rule.id, { selector: selector.value });
  });
  text.addEventListener('change', () => patchCondition(rule.id, { text: text.value.trim() }));

  container.append(selector, error, text, note(`${place}${found}.`));
}

function renderBranch(node, rule) {
  const branch = node.querySelector('.branch');
  const branchNote = node.querySelector('.branch-note');
  const inPageOnly = rule.condition.type === 'selector' && !rule.condition.inRow;
  branch.value = rule.branch;
  branch.disabled = inPageOnly;
  branchNote.textContent = inPageOnly
    ? 'Элемент находится вне строки пайплайна, поэтому ветка не учитывается.'
    : 'Точное название, например development. Звёздочка заменяет часть названия: release/*.';
  branch.addEventListener('change', () => patchRule(rule.id, { branch: branch.value.trim() }));

  const page = node.querySelector('.page');
  node.querySelector('.page-field').hidden = !inPageOnly;
  page.value = rule.page ?? '';
  page.addEventListener('change', () => patchRule(rule.id, { page: page.value.trim() }));
}

async function moveRule(id, offset) {
  const rules = await getRules();
  const index = rules.findIndex((rule) => rule.id === id);
  const target = index + offset;
  if (target < 0 || target >= rules.length) return;
  [rules[index], rules[target]] = [rules[target], rules[index]];
  await saveRules(rules);
}

async function deleteRule(rule) {
  const files = [rule.sound, rule.gif].filter(Boolean).map((file) => fileKey(file.fileId));
  await chrome.storage.local.remove(files);
  await saveRules((await getRules()).filter((item) => item.id !== rule.id));
}

function resultText(result) {
  if (!result?.ok) return `Звук не запустился: ${result?.error ?? 'нет ответа от расширения'}`;
  if (result.gifError) return `Звук запустился, гифка не показалась: ${result.gifError}`;
  return 'Сработало.';
}

async function renderRule(rule) {
  const node = template.content.firstElementChild.cloneNode(true);
  const $ = (selector) => node.querySelector(selector);
  node.dataset.id = rule.id;
  node.dataset.enabled = String(rule.enabled);

  $('.enabled').checked = rule.enabled;
  $('.enabled').addEventListener('change', (event) => patchRule(rule.id, { enabled: event.target.checked }));
  $('.name').value = rule.name;
  $('.name').addEventListener('change', (event) => patchRule(rule.id, { name: event.target.value }));

  $('.up').addEventListener('click', () => moveRule(rule.id, -1));
  $('.down').addEventListener('click', () => moveRule(rule.id, 1));
  $('.delete').addEventListener('click', () => deleteRule(rule));
  $('.fire').addEventListener('click', async () => {
    $('.result').textContent = '';
    $('.result').textContent = resultText(await chrome.runtime.sendMessage({ type: 'fire', ruleId: rule.id }));
  });

  renderCondition($('.condition'), rule);
  renderBranch(node, rule);

  $('.sound-name').textContent = rule.sound?.name ?? 'Встроенный звук';
  $('.sound-clear').hidden = !rule.sound;
  $('.sound-clear').addEventListener('click', () => setRuleFile(rule, 'sound', null));
  $('.sound-file').addEventListener('change', (event) => setRuleFile(rule, 'sound', event.target.files[0]));

  $('.gif-name').textContent = rule.gif?.name ?? 'Без гифки';
  $('.gif-clear').hidden = !rule.gif;
  $('.gif-clear').addEventListener('click', () => setRuleFile(rule, 'gif', null));
  $('.gif-file').addEventListener('change', (event) => setRuleFile(rule, 'gif', event.target.files[0]));
  if (rule.gif) {
    const key = fileKey(rule.gif.fileId);
    $('.gif-preview').src = (await chrome.storage.local.get(key))[key];
  }
  return node;
}

let renderedKey = '';

// Перерисовываем только при смене состава или файлов, иначе сбивался бы ввод в полях.
function structureKey(rules) {
  return JSON.stringify(rules.map((rule) => [rule.id, rule.enabled, rule.sound?.fileId, rule.gif?.fileId]));
}

async function render() {
  const rules = await getRules();
  renderedKey = structureKey(rules);
  list.replaceChildren(...await Promise.all(rules.map(renderRule)));
}

document.getElementById('add').addEventListener('click', async () => {
  await saveRules([{
    id: crypto.randomUUID(),
    name: 'Упал стейдж в ветке',
    enabled: true,
    branch: '',
    condition: { type: 'preset', name: 'failed-after-first' },
    sound: null,
    gif: null,
  }, ...await getRules()]);
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.rules && structureKey(changes.rules.newValue ?? []) !== renderedKey) render();
});

render();
