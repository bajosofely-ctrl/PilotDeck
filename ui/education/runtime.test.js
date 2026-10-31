// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { createEducationRuntime, educationChildEnvironment } from './runtime.js';

const runtimes = [];
const parents = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.stop();
  for (const parent of parents.splice(0)) await new Promise(resolve => { parent.close(resolve); parent.closeAllConnections(); });
});

async function reservePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

describe('education process lifecycle', () => {
  it.each([
    ['study-coach', 'PILOTDECK_STUDY_COACH_PORT', '/api/coach/chat', { mode: 'math', grade: 4, messages: [{ role: 'user', content: '12 + 5 = ?' }] }],
    ['ai-classroom', 'PILOTDECK_AI_CLASSROOM_PORT', '/api/classroom/complete', { prompt: '解释分数。' }],
  ])('starts a managed %s child and authenticates to its parent bridge', async (moduleId, variable, route, body) => {
    const calls = [];
    const parent = createHttpServer(async (req, res) => {
      let text = '';
      for await (const chunk of req) text += chunk;
      calls.push({ path: req.url, authorization: req.headers.authorization, body: text ? JSON.parse(text) : null });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(req.url.endsWith('/models')
        ? { items: [{ id: 'learning-only', name: '学习模型', protocol: 'openai', inputPriceMicros: 1, outputPriceMicros: 2 }], defaultModelId: 'learning-only' }
        : { answer: '父服务回复' }));
    });
    parents.push(parent);
    parent.listen(0, '127.0.0.1');
    await once(parent, 'listening');
    const reservation = await reservePort();
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const runtime = createEducationRuntime({
      moduleId,
      env: { ...process.env, [variable]: String(port), PILOTDECK_MANAGED_URL: 'https://cloud.invalid',
        PILOTDECK_MANAGED_TOKEN: 'cloud-secret', PILOTDECK_MANAGED_USER_ID: 'private-user',
        PILOTDECK_MANAGED_LOCAL_KEY: 'local-runtime-key' },
    });
    runtimes.push(runtime);
    expect((await runtime.start({ parentPort: parent.address().port })).status).toBe('ready');
    const origin = `http://127.0.0.1:${port}`;
    const config = await (await fetch(`${origin}/api/managed/config`)).json();
    expect(config.managed).toBe(true);
    expect(config.defaultModelId).toBe('learning-only');
    expect(JSON.stringify(config)).not.toMatch(/secret|private-user|local-runtime-key/);
    expect(await (await fetch(origin + route, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, modelId: config.defaultModelId }),
    })).json()).toEqual({ answer: '父服务回复' });
    expect(calls.map(call => call.path)).toEqual(['/api/managed/learning/models', '/api/managed/learning/complete']);
    expect(calls.every(call => call.authorization === 'Bearer local-runtime-key')).toBe(true);
    expect(calls[1].body.messages[0].role).toBe('system');
    expect(calls[1].body.modelId).toBe('learning-only');
  }, 15000);

  it('does not start managed learning in BYOK mode when its bridge credentials are missing', async () => {
    const runtime = createEducationRuntime({ moduleId: 'study-coach', env: { PILOTDECK_MANAGED_URL: 'https://cloud.invalid' } });
    runtimes.push(runtime);
    expect((await runtime.start({ parentPort: 3001 })).status).toBe('error');
  });
  it('starts the AI classroom independently without exposing host configuration', async () => {
    const reservation = await reservePort();
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const runtime = createEducationRuntime({
      moduleId: 'ai-classroom',
      env: { ...process.env, PILOTDECK_AI_CLASSROOM_PORT: String(port) },
    });
    runtimes.push(runtime);
    await runtime.start({ parentPort: 3001 });
    const origin = `http://127.0.0.1:${port}`;
    expect(runtime.getStatus('127.0.0.1').url).toBe(`${origin}/`);
    expect(await (await fetch(origin)).text()).toContain('AI 使用小课堂');
    expect((await fetch(`${origin}/api/config`)).status).toBe(404);
    expect((await fetch(`${origin}/api/classroom/complete`, { method: 'POST' })).status).toBe(403);
  }, 15000);

  it('starts the independent training-lab module', async () => {
    const moduleId = 'training-lab';
    const variable = 'PILOTDECK_TRAINING_LAB_PORT';
    const title = 'AI 训练实验室';
    const reservation = await reservePort();
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const runtime = createEducationRuntime({
      moduleId, env: { ...process.env, [variable]: String(port), PILOTDECK_MANAGED_URL: 'https://cloud.invalid' },
    });
    runtimes.push(runtime);
    await runtime.start({ parentPort: 3001 });
    const origin = `http://127.0.0.1:${port}`;
    expect(runtime.getStatus('127.0.0.1').url).toBe(`${origin}/`);
    expect(await (await fetch(origin)).text()).toContain(title);
    expect((await fetch(`${origin}/api/config`)).status).toBe(404);
    expect((await fetch(`${origin}/api/managed/config`)).status).toBe(404);
    expect((await fetch(`${origin}/api/coach/chat`, { method: 'POST' })).status).toBe(404);
  }, 15000);

  it('starts the coach independently and serves its skills without a host model', async () => {
    const reservation = await reservePort();
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const runtime = createEducationRuntime({
      moduleId: 'study-coach',
      env: { ...process.env, PILOTDECK_STUDY_COACH_PORT: String(port) },
    });
    runtimes.push(runtime);
    await runtime.start({ parentPort: 3001 });
    const origin = `http://127.0.0.1:${port}`;
    expect(runtime.getStatus('127.0.0.1').url).toBe(`${origin}/`);
    expect(await (await fetch(origin)).text()).toContain('AI 学习教练');
    expect(await (await fetch(`${origin}/skills/math-tutor.md`)).text()).toContain('数学 Tutor');
    expect((await fetch(`${origin}/api/config`)).status).toBe(404);
    expect((await fetch(`${origin}/data/topics.json`)).status).toBe(404);
  }, 15000);

  it('starts without model configuration and closes its listener on stop', async () => {
    const reservation = await reservePort();
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const runtime = createEducationRuntime({
      env: { ...process.env, PILOTDECK_EDUCATION_PORT: String(port) },
    });
    runtimes.push(runtime);
    await runtime.start({ parentPort: 3001 });
    expect(runtime.getStatus('127.0.0.1')).toEqual({
      status: 'ready', url: `http://127.0.0.1:${port}/`,
    });
    expect((await fetch(`http://127.0.0.1:${port}/_health`)).status).toBe(200);
    await runtime.stop();
    await expect(fetch(`http://127.0.0.1:${port}/_health`)).rejects.toThrow();
  }, 15000);

  it('reports port conflicts without changing the saved-data origin', async () => {
    const reservation = await reservePort();
    const port = reservation.address().port;
    const runtime = createEducationRuntime({
      env: { ...process.env, PILOTDECK_EDUCATION_PORT: String(port) },
    });
    runtimes.push(runtime);
    try {
      await runtime.start({ parentPort: 3001 });
      expect(runtime.getStatus().status).toBe('error');
      expect(runtime.getStatus().message).toContain(String(port));
    } finally {
      await new Promise(resolve => reservation.close(resolve));
    }
    await runtime.start({ parentPort: 3001 });
    expect(runtime.getStatus().url).toBe(`http://localhost:${port}/`);
  }, 15000);

  it('rejects invalid or shared ports before starting', async () => {
    for (const value of ['0', '65536', '3010oops', '3001']) {
      const runtime = createEducationRuntime({ env: { PILOTDECK_EDUCATION_PORT: value } });
      runtimes.push(runtime);
      await runtime.start({ parentPort: 3001 });
      expect(runtime.getStatus().status).toBe('error');
    }
  });

  it('does not inherit host credentials, configuration or Node preload hooks', () => {
    const env = educationChildEnvironment({
      PATH: '/tools', SystemRoot: 'C:\\Windows', TEMP: '/tmp',
      OPENAI_API_KEY: 'secret', PILOTDECK_CONFIG_PATH: '/private/config.yaml',
      NODE_OPTIONS: '--import /private/inject.js', HTTPS_PROXY: 'http://secret-proxy',
    });
    expect(env.PATH).toBe('/tools');
    expect(env.SystemRoot).toBe('C:\\Windows');
    expect(env.TEMP).toBe('/tmp');
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
    expect(env).not.toHaveProperty('PILOTDECK_CONFIG_PATH');
    expect(env).not.toHaveProperty('NODE_OPTIONS');
    expect(env).not.toHaveProperty('HTTPS_PROXY');
  });
});
