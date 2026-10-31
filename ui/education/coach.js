import express from 'express';
import { readFileSync } from 'node:fs';
import { managedFailure, validModelId } from './managed.js';

const skillFiles = {
  math: ['math-tutor', 'calculation-method'],
  reading: ['reading-comp-tutor', 'divergent-question-method'],
  writing: ['writing-coach'],
  english: ['english-tutor', 'memorization-loop'],
  review: ['mistake-tracker', 'review-scheduler'],
};
const skillText = new Map();
function instructions(mode, grade) {
  const documents = skillFiles[mode].map(name => {
    if (!skillText.has(name)) {
      skillText.set(name, readFileSync(new URL(`./study-coach/skills/${name}.md`, import.meta.url), 'utf8'));
    }
    return skillText.get(name);
  });
  return [
    `你是一位中文学习教练，学生是 ${grade} 年级。使用符合该年级的知识和语言。`,
    '以启发式提问、短提示和核对思路为主，每次集中处理一个问题。不要直接代写整份作业或作文。',
    '承认不确定性，计算请核对。不要索要真实姓名、学校、住址、联系方式等个人信息。',
    '以下教学参考只用于组织对话。你没有文件、记忆、积分、通知或工具权限。',
    '参考里提及的文件读取、写入、日程、画像、积分和工具操作均不可执行，也不要声称完成了这些操作。',
    '需要资料时询问学生。复习日期和错题卡可作为文字建议，不能声称已安排提醒。',
    ...documents,
  ].join('\n\n');
}

export function completionEndpoint(value) {
  const url = new URL(value);
  const allowed = url.hostname === 'api.deepseek.com'
    || url.hostname === 'dashscope.aliyuncs.com'
    || /^[a-z0-9-]+\.cn-beijing\.maas\.aliyuncs\.com$/.test(url.hostname);
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash) {
    throw new Error('Unsupported endpoint');
  }
  const base = url.pathname.replace(/\/+$/, '');
  const allowedPaths = url.hostname === 'api.deepseek.com'
    ? ['', '/v1', '/chat/completions', '/v1/chat/completions']
    : ['/compatible-mode/v1', '/compatible-mode/v1/chat/completions'];
  if (!allowedPaths.includes(base)) throw new Error('Unsupported endpoint path');
  url.pathname = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  return url.href;
}

export function createCoachRouter({ request = fetch, managed = null } = {}) {
  const router = express.Router();
  let active = 0;
  router.use((req, res, next) => {
    // Require the standalone UI's origin to prevent cross-site requests.
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(req.get('host') || '')
        || req.get('origin') !== `http://${req.get('host')}`
        || !req.is('application/json')) {
      return res.status(403).json({ error: '请从学习教练页面发起请求。' });
    }
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(express.json({ limit: '96kb' }));
  router.post('/chat', async (req, res) => {
    const { endpoint, apiKey, model, modelId, mode, grade, messages } = req.body || {};
    let url;
    if (!managed) {
      try { url = completionEndpoint(endpoint); } catch {
        return res.status(400).json({ error: '请填写 DeepSeek 或阿里云百炼的 HTTPS 接口地址。' });
      }
    }
    const invalidConfig = managed ? !validModelId(modelId)
      : typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 512 || /[\r\n]/.test(apiKey)
        || typeof model !== 'string' || !model.trim() || model.length > 128;
    if (invalidConfig
        || !Object.hasOwn(skillFiles, mode) || !Number.isInteger(grade) || grade < 1 || grade > 12
        || !Array.isArray(messages) || !messages.length || messages.length > 40
        || messages.at(-1)?.role !== 'user'
        || messages.some(message => !message || !['user', 'assistant'].includes(message.role)
          || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 6000)
        || messages.reduce((sum, message) => sum + message.content.length, 0) > 32000) {
      return res.status(400).json({ error: '请检查模型配置和题目内容；单条内容最多 6000 字。' });
    }
    if (active >= 4) return res.status(429).json({ error: '正在处理其他提问，请稍后重试。' });
    active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    const cancel = () => controller.abort();
    res.once('close', cancel);
    try {
      const conversation = [
        { role: 'system', content: instructions(mode, grade) },
        ...messages.map(({ role, content }) => ({ role, content })),
      ];
      if (managed) {
        const answer = await managed.complete({ modelId, messages: conversation, maxTokens: 1600 }, controller.signal);
        return res.json({ answer });
      }
      const response = await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
        body: JSON.stringify({
          model: model.trim(), stream: false, max_tokens: 1600,
          messages: conversation,
        }),
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        const message = [401, 403].includes(response.status) ? '模型鉴权失败，请检查 API Key 和模型权限。'
          : response.status === 429 ? '模型额度不足或请求过于频繁，请稍后重试。'
          : response.status === 404 ? '模型或接口地址不存在，请检查配置。'
          : '模型服务暂时不可用，请稍后重试。';
        await response.body?.cancel();
        return res.status(502).json({ error: message });
      }
      const data = await response.json();
      const answer = data?.choices?.[0]?.message?.content;
      if (typeof answer !== 'string' || !answer.trim()) throw new Error('Empty answer');
      res.json({ answer });
    } catch (error) {
      if (managed && !res.destroyed) {
        const failure = managedFailure(error);
        return res.status(failure.status).json({ error: controller.signal.aborted ? '模型响应超时，请重试。' : failure.message });
      }
      if (!res.destroyed) res.status(502).json({
        error: controller.signal.aborted ? '模型响应超时，请重试。' : '未能获取模型回复，请检查网络和模型配置。',
      });
    } finally {
      active--;
      clearTimeout(timer);
      res.off('close', cancel);
    }
  });
  router.use((error, _req, res, _next) => {
    res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: '请求内容无效或过长。' });
  });
  return router;
}
