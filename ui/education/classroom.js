import express from 'express';
import { managedFailure, validModelId } from './managed.js';

const endpoints = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  deepseek: 'https://api.deepseek.com/chat/completions',
  bailian: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
};

export function createClassroomRouter({ request = fetch, managed = null } = {}) {
  const router = express.Router();
  let active = 0;
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(req.get('host') || '')
        || req.get('origin') !== `http://${req.get('host')}` || !req.is('application/json')) {
      return res.status(403).json({ error: '请从 AI 使用小课堂发起练习。' });
    }
    next();
  });
  router.use(express.json({ limit: '40kb' }));
  router.post('/complete', async (req, res) => {
    const { provider, apiKey, model, modelId, prompt } = req.body || {};
    const invalidConfig = managed ? !validModelId(modelId) : !Object.hasOwn(endpoints, provider)
        || typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 512 || /[\r\n]/.test(apiKey)
        || typeof model !== 'string' || !model.trim() || model.length > 128;
    if (invalidConfig || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) {
      return res.status(400).json({ error: '请检查模型设置与提示词，提示词最多 8000 字。' });
    }
    if (active >= 4) return res.status(429).json({ error: '正在处理其他练习，请稍后重试。' });
    active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    const cancel = () => controller.abort();
    res.once('close', cancel);
    try {
      if (managed) {
        const answer = await managed.complete({
          modelId, maxTokens: 1600,
          messages: [
            { role: 'system', content: '你是中文 AI 使用课堂的练习助手。根据学生的提示词给出清晰、适龄的回复，帮助学生比较提问方式。承认不确定性，不索要姓名、学校、联系方式等个人信息；不要声称执行了工具、文件或外部操作。' },
            { role: 'user', content: prompt },
          ],
        }, controller.signal);
        return res.json({ answer });
      }
      const response = await request(endpoints[provider], {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(provider === 'anthropic'
            ? { 'x-api-key': apiKey.trim(), 'anthropic-version': '2023-06-01' }
            : { Authorization: `Bearer ${apiKey.trim()}` }),
        },
        body: JSON.stringify({
          model: model.trim(), max_tokens: 1600,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        const error = [401, 403].includes(response.status) ? '模型鉴权失败，请检查 API Key 与权限。'
          : response.status === 429 ? '额度不足或请求过于频繁，请稍后重试。'
          : response.status === 404 ? '模型不存在或已停用，请检查模型名称。' : '模型服务暂不可用，请重试。';
        return res.status(502).json({ error });
      }
      const data = await response.json();
      const answer = provider === 'anthropic'
        ? data?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n')
        : data?.choices?.[0]?.message?.content;
      if (typeof answer !== 'string' || !answer.trim()) throw new Error('Empty answer');
      res.json({ answer });
    } catch (error) {
      if (managed && !res.destroyed) {
        const failure = managedFailure(error);
        return res.status(failure.status).json({ error: controller.signal.aborted ? '模型响应超时，请重试。' : failure.message });
      }
      if (!res.destroyed) res.status(502).json({ error: controller.signal.aborted
        ? '模型响应超时，请稍后重试。' : '未能获取回复，请检查网络和模型设置。' });
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
