// @vitest-environment node
import express from 'express';
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { createClassroomRouter } from './classroom.js';

const cleanups = [];
afterEach(async () => { for (const stop of cleanups.splice(0)) await stop(); });
async function setup(request) {
  const app = express();
  app.use('/api/classroom', createClassroomRouter({ request }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanups.push(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const body = { provider: 'deepseek', apiKey: 'test-only', model: 'deepseek-chat', prompt: '用一个例子解释分数。' };
  const post = (data = body, extraHeaders = {}) => fetch(`${origin}/api/classroom/complete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...extraHeaders },
    body: JSON.stringify(data),
  });
  return { post, body };
}
it('uses only independent credentials and sends the student prompt unchanged', async () => {
  const request = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: '示例回复' } }] }));
  const { post } = await setup(request);
  const response = await post();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ answer: '示例回复' });
  const [url, options] = request.mock.calls[0];
  expect(url).toBe('https://api.deepseek.com/chat/completions');
  expect(options.redirect).toBe('error');
  expect(options.headers.Authorization).toBe('Bearer test-only');
  expect(JSON.parse(options.body).messages).toEqual([{ role: 'user', content: '用一个例子解释分数。' }]);
});
it('supports Anthropic messages and extracts text blocks', async () => {
  const request = vi.fn().mockResolvedValue(Response.json({ content: [{ type: 'text', text: '回答' }] }));
  const { post, body } = await setup(request);
  expect(await (await post({ ...body, provider: 'anthropic', model: 'teacher-selected-model' })).json()).toEqual({ answer: '回答' });
  expect(request.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
  expect(request.mock.calls[0][1].headers['x-api-key']).toBe('test-only');
});
it('rejects cross-origin requests and arbitrary destinations before network access', async () => {
  const request = vi.fn();
  const { post, body } = await setup(request);
  expect((await post(body, { Origin: 'https://other.example' })).status).toBe(403);
  for (const changes of [{ provider: 'http://127.0.0.1' }, { prompt: '' }, { prompt: 'x'.repeat(8001) }, { apiKey: '' }, { model: '' }]) {
    expect((await post({ ...body, ...changes })).status).toBe(400);
  }
  expect(request).not.toHaveBeenCalled();
});
it('reports upstream errors without reflecting credentials or response bodies', async () => {
  const request = vi.fn().mockResolvedValue(new Response('private upstream details', { status: 401 }));
  const { post } = await setup(request);
  const response = await post();
  expect(response.status).toBe(502);
  expect(await response.text()).toContain('鉴权失败');
});
