import { createManagedSettings } from '/managed-settings.js';

const modes = [
  { id: 'math', name: '数学引导', skill: 'math-tutor', title: '从哪一步开始卡住了？', description: '读题、找条件、画图、列式，再一起核对。', examples: ['我想练一道适合我的应用题。', '我不理解分数加法，能一步一步引导我吗？'] },
  { id: 'reading', name: '阅读理解', skill: 'reading-comp-tutor', title: '带着问题，回到文章里', description: '找证据、说感受，用自己的话整理答案。', examples: ['阅读题问“你的感受”，我该怎么思考？', '我想练习概括一段话的主要内容。'] },
  { id: 'writing', name: '作文辅导', skill: 'writing-coach', title: '先聊一件你记得的小事', description: '从真实经历和具体细节开始，一次完善一小段。', examples: ['作文题目是“难忘的一天”，我不知道写什么。', '我想让人物描写更具体，先从哪里改？'] },
  { id: 'english', name: '英语学习', skill: 'english-tutor', title: '把英语放进一个小情境', description: '单词、语法、阅读与写作，从适合你的难度开始。', examples: ['请出一道适合我的英语练习，一次一题。', '我总是记不住单词，帮我做一次小练习。'] },
  { id: 'review', name: '错题复习', skill: 'mistake-tracker', title: '找到错因，再试一次', description: '整理题目、当时的答案和卡点，形成复习建议。', examples: ['我把 1/2 + 1/3 算成了 2/5，帮我分析错因。', '我想复习最近做错的题，应该先整理哪些信息？'] },
];
const providers = {
  qwen: { endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  deepseek: { endpoint: 'https://api.deepseek.com', model: '' },
};
const $ = id => document.getElementById(id);
const storageKey = 'pilotdeck.education.coach.v1';
let saved = {};
try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch {}
let mode = modes.find(item => item.id === saved.mode) || modes[0];
let grade = Number.isInteger(saved.grade) && saved.grade >= 1 && saved.grade <= 12 ? saved.grade : 4;
let sessions = saved.sessions && typeof saved.sessions === 'object' && !Array.isArray(saved.sessions) ? saved.sessions : {};
let credentials = null;
let pending = null;
function sessionKey() { return `${mode.id}-${grade}`; }
function messages() {
  const history = sessions[sessionKey()];
  return Array.isArray(history) ? history.filter(message =>
    message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string').slice(-40) : [];
}
function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify({ mode: mode.id, grade, sessions })); }
  catch { showError('浏览器未能保存学习记录，请导出本次对话。'); }
}
function showError(text) { $('error').textContent = text; $('error').hidden = !text; }
function cancel() { pending?.abort(); }
function render() {
  $('grade').value = String(grade);
  $('mode-title').textContent = mode.name;
  $('skill-download').href = `./skills/${mode.skill}.md`;
  for (const button of $('modes').children) button.setAttribute('aria-pressed', String(button.dataset.mode === mode.id));
  $('messages').replaceChildren();
  const history = messages();
  if (!history.length) {
    const empty = document.createElement('section');
    empty.className = 'empty';
    const title = document.createElement('h3'); title.textContent = mode.title;
    const subtitle = document.createElement('p'); subtitle.textContent = mode.description;
    const examples = document.createElement('div'); examples.className = 'examples';
    for (const text of mode.examples) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = text;
      button.onclick = () => { $('question').value = text; $('question').focus(); };
      examples.append(button);
    }
    empty.append(title, subtitle, examples); $('messages').append(empty);
  }
  for (const message of history) {
    const article = document.createElement('article'); article.className = `message ${message.role}`;
    const label = document.createElement('strong'); label.textContent = message.role === 'user' ? '我' : '学习教练';
    const text = document.createElement('p'); text.textContent = message.content;
    article.append(label, text); $('messages').append(article);
  }
  $('messages').scrollTop = $('messages').scrollHeight;
}
function setBusy(busy) {
  $('send').disabled = busy;
  $('cancel').hidden = !busy;
  $('question').disabled = busy;
  $('grade').disabled = busy;
  $('new').disabled = busy;
  $('settings-open').disabled = busy;
  for (const button of $('modes').children) button.disabled = busy;
  $('request-status').textContent = busy ? '教练正在思考…' : '回复由 AI 生成，请核对关键结论。';
}
for (const item of modes) {
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = item.name; button.dataset.mode = item.id;
  button.onclick = () => { mode = item; showError(''); $('question').value = ''; persist(); render(); };
  $('modes').append(button);
}
$('grade').onchange = () => { grade = Number($('grade').value); showError(''); $('question').value = ''; persist(); render(); };
$('new').onclick = () => { sessions[sessionKey()] = []; showError(''); $('question').value = ''; persist(); render(); };
$('cancel').onclick = cancel;
$('settings-open').onclick = () => $('settings').showModal();
$('settings-close').onclick = () => $('settings').close();
$('provider').onchange = () => {
  const provider = providers[$('provider').value];
  $('endpoint').value = provider.endpoint; $('model').value = provider.model; $('api-key').value = '';
};
$('provider').onchange();
$('settings-form').onsubmit = event => {
  event.preventDefault();
  if (!['local', 'managed'].includes(modelSettings.mode)) return;
  credentials = modelSettings.mode === 'managed' ? modelSettings.selection()
    : { endpoint: $('endpoint').value.trim(), model: $('model').value.trim(), apiKey: $('api-key').value.trim() };
  if (!credentials) return;
  $('connection').textContent = `${credentials.modelId || credentials.model} · 配置待验证`;
  if ($('api-key')) $('api-key').value = '';
  $('settings').close(); showError(''); $('question').focus();
};
$('composer').onsubmit = async event => {
  event.preventDefault();
  if (pending) return;
  if (!credentials) { showError('请先检查模型设置。'); $('settings').showModal(); return; }
  const question = $('question').value.trim();
  if (!question) return;
  const history = messages();
  if (history.length >= 38 || history.reduce((sum, item) => sum + item.content.length, question.length) > 30000) {
    showError('本次对话已较长，请导出记录后开始新对话。'); return;
  }
  const next = [...history, { role: 'user', content: question }];
  const key = sessionKey();
  sessions[key] = next; render(); showError(''); setBusy(true);
  const controller = new AbortController(); pending = controller;
  const timeout = setTimeout(() => controller.abort(), 65_000);
  try {
    const response = await fetch('/api/coach/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...credentials, mode: mode.id, grade, messages: next }),
      signal: controller.signal, credentials: 'omit',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '请求失败，请重试。');
    if (typeof data.answer !== 'string' || !data.answer.trim()) throw new Error('回复内容为空，请重试。');
    sessions[key] = [...next, { role: 'assistant', content: data.answer }];
    $('question').value = '';
    $('connection').textContent = `${credentials.modelId || credentials.model} · 已连接`;
    persist(); render();
  } catch (error) {
    sessions[key] = history;
    render(); showError(controller.signal.aborted ? '提问已停止或超时，内容已保留，可再次发送。' : error.message);
  } finally { clearTimeout(timeout); pending = null; setBusy(false); $('question').focus(); }
};
$('export').onclick = () => {
  const text = [`# ${mode.name} · ${grade} 年级`, ...messages().map(message =>
    `## ${message.role === 'user' ? '我' : '学习教练'}\n\n${message.content}`)].join('\n\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `学习记录-${mode.id}-${grade}.md`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener('pagehide', cancel);
render();
const modelSettings = createManagedSettings({
  onChange(value) { credentials = value; },
  onStatus(text) { $('connection').textContent = text; },
});
