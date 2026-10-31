import { lessons } from './lessons.js';
import { createManagedSettings } from '/managed-settings.js';

// Adapted from apeit's section navigation, local progress and exercise flow.
const storageKey = 'pilotdeck-ai-classroom-v1';
const $ = id => document.getElementById(id);
const escape = text => text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]);
const lessonIds = new Set(lessons.map(lesson => lesson.id));
let saved = {};
try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch { /* Recover a damaged progress record. */ }
const completed = new Set(Array.isArray(saved.completed) ? saved.completed.filter(id => lessonIds.has(id)) : []);
const drafts = saved.drafts && typeof saved.drafts === 'object' && !Array.isArray(saved.drafts) ? saved.drafts : {};
let current = lessons.find(lesson => lesson.id === saved.current) || lessons[0];
let config = null;
let pending = null;
let settingsOpener = null;

function notice(text) { $('notice').textContent = text; }
function persist() {
  try { localStorage.setItem(storageKey, JSON.stringify({ current: current.id, completed: [...completed], drafts })); }
  catch { notice('浏览器未能保存进度，请导出练习后再关闭。'); }
}
function progress() {
  $('progress').textContent = `已学 ${completed.size} / ${lessons.length}`;
  $('complete').textContent = completed.has(current.id) ? '取消已学标记' : '标记已学';
  for (const link of document.querySelectorAll('.nav-link')) {
    const id = link.hash.slice(1);
    link.classList.toggle('completed', completed.has(id));
    link.classList.toggle('active', id === current.id);
    if (id === current.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}
function render() {
  pending?.abort();
  const fromHash = lessons.find(lesson => lesson.id === location.hash.slice(1));
  if (fromHash) current = fromHash;
  const index = lessons.indexOf(current);
  const lesson = current;
  document.title = `${lesson.title} · AI 使用小课堂`;
  $('content-area').innerHTML = `
    <p class="lesson-meta">第 ${index + 1} 课 / ${lessons.length} · ${escape(lesson.theme)}</p>
    <h1 tabindex="-1">${escape(lesson.title)}</h1>
    <p class="lesson-intro">${escape(lesson.intro)}</p>
    <ul class="principles">${lesson.points.map(point => `<li>${escape(point)}</li>`).join('')}</ul>
    <section class="lesson-section" aria-labelledby="compare-title">
      <h2 id="compare-title">比较两种提问</h2>
      <div class="prompt-pair">
        <article><h3>A · 原始提问</h3><pre>${escape(lesson.weak)}</pre></article>
        <article><h3>B · 改进提问</h3><pre>${escape(lesson.strong)}</pre></article>
      </div>
      <button id="compare" class="btn btn-outline">比较 AI 回复</button>
      <p class="request-note">使用当前模型发送两次请求。回答每次可能不同，请比较是否满足要求。</p>
      <div id="comparison" class="comparison-results" aria-live="polite"></div>
    </section>
    <section class="lesson-section" aria-labelledby="practice-title">
      <h2 id="practice-title">轮到你来试</h2>
      <p>${escape(lesson.task)}</p>
      <label for="prompt">我的提示词</label>
      <textarea id="prompt" rows="6" maxlength="8000" placeholder="${escape(lesson.starter)}"></textarea>
      <div class="practice-actions">
        <button class="btn btn-primary" id="run">发送练习</button>
        <button class="btn btn-outline icon-button" id="copy" aria-label="复制提示词" title="复制提示词"><img src="icons/copy.svg" alt="" width="18" height="18"></button>
        <button class="btn btn-outline icon-button" id="export" aria-label="导出练习" title="导出练习"><img src="icons/download.svg" alt="" width="18" height="18"></button>
        <button class="btn btn-outline" id="cancel" hidden>取消请求</button>
      </div>
      <p class="request-note">不要输入姓名、学校、联系方式等个人信息。提示词草稿保存在当前浏览器。</p>
      <div id="answer" class="answer" role="status" aria-live="polite"></div>
      <details><summary>思考提示</summary><p>${escape(lesson.hint)}</p></details>
      <details><summary>参考写法</summary><pre>${escape(lesson.sample)}</pre></details>
    </section>
    <section class="lesson-section"><h2>检查你的结果</h2>
      <ul>${lesson.check.map(item => `<li>${escape(item)}</li>`).join('')}</ul>
      <p>完成练习并检查后，可在下方标记已学。浏览课程不会自动计为完成。</p>
    </section>`;
  $('prompt').value = typeof drafts[lesson.id] === 'string' ? drafts[lesson.id] : '';
  $('prompt').addEventListener('input', () => { drafts[lesson.id] = $('prompt').value; persist(); });
  $('previous').disabled = index === 0;
  $('next').disabled = index === lessons.length - 1;
  $('run').onclick = () => run(false);
  $('compare').onclick = () => run(true);
  $('cancel').onclick = () => pending?.abort();
  $('copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('prompt').value); notice('提示词已复制。'); }
    catch { $('prompt').focus(); $('prompt').select(); notice('已选中提示词，可手动复制。'); }
  };
  $('export').onclick = () => {
    const text = `# ${lesson.title}\n\n## 我的提示词\n${$('prompt').value}\n\n## AI 回复\n${$('answer').textContent}\n\n## 提问对比\n${$('comparison').textContent}`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${lesson.id}-practice.md`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  progress();
  persist();
}
function openSettings() {
  settingsOpener = document.activeElement;
  if (config && modelSettings.mode === 'local') {
    $('provider').value = config.provider;
    $('model').value = config.model;
    $('api-key').value = config.apiKey;
  }
  $('settings-dialog').showModal();
  (modelSettings.mode === 'managed' ? $('managed-model') : $('managed-refresh')).focus();
}
async function complete(prompt, signal, credentials) {
  const response = await fetch('/api/classroom/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...credentials, prompt }), signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败，请重试。');
  if (typeof data.answer !== 'string' || !data.answer.trim()) throw new Error('模型没有返回文字，请重试。');
  return data.answer;
}
async function run(compare) {
  if (pending) return;
  const prompt = $('prompt').value.trim();
  if (!compare && !prompt) { notice('先写下你想尝试的提示词。'); $('prompt').focus(); return; }
  if (!config) { notice('请先检查模型设置。'); openSettings(); return; }
  const lesson = current;
  const target = $(compare ? 'comparison' : 'answer');
  const controller = new AbortController();
  pending = controller;
  const credentials = { ...config };
  const timer = setTimeout(() => controller.abort(), 125000);
  $('run').disabled = $('compare').disabled = true;
  $('cancel').hidden = false;
  target.textContent = '正在等待 AI 回复…';
  target.setAttribute('aria-busy', 'true');
  try {
    if (compare) {
      // Sequential requests preserve the successful first reply if the second fails.
      const answerA = await complete(lesson.weak, controller.signal, credentials);
      if (!target.isConnected) return;
      target.textContent = `A · 原始提问的回复\n${answerA}\n\n正在获取 B 的回复…`;
      const answerB = await complete(lesson.strong, controller.signal, credentials);
      if (target.isConnected) target.textContent = `A · 原始提问的回复\n${answerA}\n\nB · 改进提问的回复\n${answerB}`;
    } else {
      const answer = await complete(prompt, controller.signal, credentials);
      if (target.isConnected) target.textContent = answer;
    }
  } catch (error) {
    if (target.isConnected) {
      const message = controller.signal.aborted ? '请求已取消或超时，可以重试。' : error.message;
      if (compare && target.textContent.startsWith('A ·')) target.textContent += `\n${message}`;
      else target.textContent = message;
    }
  } finally {
    clearTimeout(timer);
    target.removeAttribute('aria-busy');
    if (pending === controller) {
      pending = null;
      $('run').disabled = $('compare').disabled = false;
      $('cancel').hidden = true;
    }
  }
}

$('lessons').innerHTML = lessons.map((lesson, index) =>
  `<li><a class="nav-link" href="#${lesson.id}">${index + 1}. ${escape(lesson.title)}</a></li>`).join('');
$('previous').onclick = () => { location.hash = lessons[lessons.indexOf(current) - 1].id; };
$('next').onclick = () => { location.hash = lessons[lessons.indexOf(current) + 1].id; };
$('complete').onclick = () => {
  if (completed.has(current.id)) completed.delete(current.id); else completed.add(current.id);
  progress(); persist();
};
$('settings').onclick = openSettings;
$('close-settings').onclick = () => $('settings-dialog').close();
$('settings-dialog').addEventListener('close', () => { if ($('api-key')) $('api-key').value = ''; settingsOpener?.focus(); });
$('provider').onchange = () => {
  $('model').value = { deepseek: 'deepseek-chat', bailian: 'qwen-plus', anthropic: '' }[$('provider').value];
  $('api-key').value = '';
};
$('settings-form').onsubmit = event => {
  event.preventDefault();
  if (modelSettings.mode === 'managed') {
    config = modelSettings.selection();
    if (!config) return;
    $('settings-dialog').close();
    notice('托管模型设置已应用。');
    return;
  }
  if (modelSettings.mode !== 'local') return;
  const apiKey = $('api-key').value.trim();
  const model = $('model').value.trim();
  if (!apiKey || !model) return;
  config = { provider: $('provider').value, model, apiKey };
  $('settings-dialog').close();
  notice('模型设置已应用，仅在当前页面有效。');
};
$('clear-key').onclick = () => {
  if (modelSettings.mode !== 'local') return;
  pending?.abort(); config = null; $('api-key').value = '';
  $('settings-dialog').close(); notice('模型配置已清除。');
};
window.addEventListener('hashchange', () => { render(); $('main').scrollIntoView({ block: 'start' }); });
window.addEventListener('pagehide', () => { pending?.abort(); config = null; });
render();
const modelSettings = createManagedSettings({
  onChange(value) { config = value; },
  onStatus: notice,
});
