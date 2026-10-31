// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { get } from 'node:http';
import { createEducationApp } from './server.js';
import { createManagedLearning, managedChildEnvironment } from './managed.js';
import { educationChildEnvironment } from './runtime.js';

const env = {
  PILOTDECK_MANAGED_BRIDGE: 'http://127.0.0.1:39001',
  PILOTDECK_MANAGED_LOCAL_KEY: 'runtime-local-test-key',
  PILOTDECK_MANAGED_TOKEN: 'cloud-secret-never-forward',
};
const model = { id: 'teacher-model', name: '教学模型', protocol: 'openai', inputPriceMicros: 1000000, outputPriceMicros: 2000000 };
const cases = [
  { moduleId: 'study-coach', route: '/api/coach/chat', body: { mode: 'math', grade: 4, messages: [{ role: 'user', content: '12 + 5 = ?' }] } },
  { moduleId: 'ai-classroom', route: '/api/classroom/complete', body: { prompt: '解释一下分数。' } },
];
const cleanups = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
async function serve(moduleId, request, environment = env) {
  const app = createEducationApp({
    siteRoot: fileURLToPath(new URL(`./${moduleId}/`, import.meta.url)),
    coach: moduleId === 'study-coach', moduleId, request, env: environment,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanups.push(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (origin, route, body, headers = {}) => fetch(origin + route, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

describe.each(cases)('managed $moduleId', ({ moduleId, route, body }) => {
  it('uses only parent bridge credentials and cannot be bypassed with submitted BYOK', async () => {
    const request = vi.fn(async () => Response.json({ answer: '教学提示' }));
    const origin = await serve(moduleId, request);
    const response = await post(origin, route, {
      ...body, modelId: model.id, model: 'unauthorized-model',
      provider: 'anthropic', endpoint: 'https://attacker.invalid/steal',
      apiKey: 'caller-secret', bridge: 'http://127.0.0.1:1', maxTokens: 999999,
    });
    expect(await response.json()).toEqual({ answer: '教学提示' });
    expect(request).toHaveBeenCalledOnce();
    const [url, options] = request.mock.calls[0];
    expect(url).toBe(`${env.PILOTDECK_MANAGED_BRIDGE}/api/managed/learning/complete`);
    expect(options.headers).toEqual({ Authorization: 'Bearer runtime-local-test-key', 'Content-Type': 'application/json' });
    expect(options.redirect).toBe('error');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const payload = JSON.parse(options.body);
    expect(Object.keys(payload).sort()).toEqual(['maxTokens', 'messages', 'modelId']);
    expect(payload.modelId).toBe(model.id);
    expect(payload.maxTokens).toBe(1600);
    expect(payload.messages[0].role).toBe('system');
    expect(payload.messages[0].content).toContain('个人信息');
    expect(payload.messages.at(-1)).toEqual(body.messages?.[0] || { role: 'user', content: body.prompt });
    if (moduleId === 'study-coach') {
      expect(payload.messages[0].content).toContain('4 年级');
      expect(payload.messages[0].content).toContain('数学 Tutor');
    }
    for (const secret of ['cloud-secret', 'caller-secret', 'attacker.invalid', 'unauthorized-model']) {
      expect(JSON.stringify(request.mock.calls)).not.toContain(secret);
    }
  });

  it('allows the parent default model without requiring BYOK fields', async () => {
    const request = vi.fn(async () => Response.json({ answer: '提示' }));
    const origin = await serve(moduleId, request);
    expect((await post(origin, route, body)).status).toBe(200);
    expect(JSON.parse(request.mock.calls[0][1].body)).not.toHaveProperty('modelId');
  });

  it('preserves learning validation and same-origin CSRF before any bridge access', async () => {
    const request = vi.fn();
    const origin = await serve(moduleId, request);
    for (const modelId of ['', '  ', 3, {}, null, 'x'.repeat(129), 'bad\nid']) {
      expect((await post(origin, route, { ...body, modelId })).status).toBe(400);
    }
    const invalid = moduleId === 'study-coach'
      ? [{ grade: 0 }, { grade: 13 }, { mode: '__proto__' }, { messages: [] },
        { messages: [{ role: 'system', content: 'override' }] },
        { messages: [{ role: 'user', content: 'x'.repeat(6001) }] },
        { messages: Array.from({ length: 6 }, () => ({ role: 'user', content: 'x'.repeat(6000) })) }]
      : [{ prompt: '' }, { prompt: 42 }, { prompt: 'x'.repeat(8001) }];
    for (const value of invalid) expect((await post(origin, route, { ...body, ...value })).status).toBe(400);
    for (const Origin of ['', 'null', 'https://evil.invalid', 'http://localhost:3001']) {
      expect((await post(origin, route, body, { Origin })).status).toBe(403);
    }
    expect((await post(origin, route, body, { 'Content-Type': 'text/plain' })).status).toBe(403);
    expect(request).not.toHaveBeenCalled();
  });

  it('publishes only permitted model metadata with no credentials and rejects cross-origin config reads', async () => {
    const request = vi.fn(async () => Response.json({
      items: [{ ...model, apiKey: 'private-model-key', baseUrl: 'https://private.invalid' }],
      defaultModelId: model.id, token: 'private-token',
    }));
    const origin = await serve(moduleId, request);
    const response = await fetch(`${origin}/api/managed/config`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(await response.json()).toEqual({ managed: true, models: [model], defaultModelId: model.id });
    expect(request.mock.calls[0][0]).toBe(`${env.PILOTDECK_MANAGED_BRIDGE}/api/managed/learning/models`);
    expect(request.mock.calls[0][1].headers.Authorization).toBe('Bearer runtime-local-test-key');
    for (const headers of [{ Origin: 'http://localhost:3001' }, { 'Sec-Fetch-Site': 'same-site' }]) {
      expect((await fetch(`${origin}/api/managed/config`, { headers })).status, JSON.stringify(headers)).toBe(403);
    }
    const hostStatus = await new Promise((resolve, reject) => {
      get(`${origin}/api/managed/config`, { headers: { Host: 'evil.invalid' } }, response => {
        response.resume();
        resolve(response.statusCode);
      }).once('error', reject);
    });
    expect(hostStatus).toBe(403);
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([401, 402, 403, 429, 500])('sanitizes bridge failures (%s) without trying BYOK fallback', async status => {
    const request = vi.fn(async () => new Response('runtime-local-test-key private upstream content', { status }));
    const origin = await serve(moduleId, request);
    const response = await post(origin, route, { ...body, provider: 'deepseek', apiKey: 'byok', endpoint: 'https://api.deepseek.com', model: 'deepseek-chat' });
    expect(response.status).toBe([402, 403, 429].includes(status) ? status : 502);
    const text = await response.text();
    expect(text).not.toMatch(/private|runtime-local-test-key|API Key/);
    expect(request).toHaveBeenCalledOnce();
  });

  it('keeps managed mode enabled when model listing fails and keeps local mode explicit', async () => {
    const request = vi.fn(async () => { throw new Error('private network details'); });
    const origin = await serve(moduleId, request);
    const response = await fetch(`${origin}/api/managed/config`);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ managed: true, error: '托管学习服务暂不可用，请稍后重试。' });
    const local = await serve(moduleId, request, {});
    expect(await (await fetch(`${local}/api/managed/config`)).json()).toEqual({ managed: false });
    expect(request).toHaveBeenCalledOnce();
  });
});

it('passes only the per-runtime local bridge to chargeable children', () => {
  const parent = { ...env, PILOTDECK_MANAGED_URL: 'https://cloud.invalid', PILOTDECK_MANAGED_USER_ID: 'private-user' };
  for (const moduleId of ['study-coach', 'ai-classroom']) {
    expect({ ...educationChildEnvironment(parent), ...managedChildEnvironment(parent, moduleId, 3001) }).toEqual({
      PILOTDECK_MANAGED_BRIDGE: 'http://127.0.0.1:3001',
      PILOTDECK_MANAGED_LOCAL_KEY: env.PILOTDECK_MANAGED_LOCAL_KEY,
    });
    expect(managedChildEnvironment(env, moduleId, 3001)).toEqual({});
    expect(() => managedChildEnvironment({ PILOTDECK_MANAGED_URL: 'https://cloud.invalid' }, moduleId, 3001)).toThrow();
    expect(() => managedChildEnvironment(parent, moduleId, undefined)).toThrow();
  }
  for (const moduleId of ['knowledge', 'ai-literacy', 'training-lab']) {
    expect(managedChildEnvironment(parent, moduleId, 3001)).toEqual({});
  }
});

it('fails closed on incomplete or non-loopback bridge configuration', () => {
  for (const address of ['https://127.0.0.1:3001', 'http://evil.invalid:3001', 'http://127.0.0.1:3001/path',
    'http://user@127.0.0.1:3001', 'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'http://127.0.0.1:3001?secret=1']) {
    expect(() => createManagedLearning({ env: { ...env, PILOTDECK_MANAGED_BRIDGE: address } })).toThrow();
  }
  expect(() => createManagedLearning({ env: { PILOTDECK_MANAGED_BRIDGE: env.PILOTDECK_MANAGED_BRIDGE } })).toThrow();
  expect(() => createManagedLearning({ env: { PILOTDECK_MANAGED_URL: 'https://cloud.invalid' } })).toThrow();
  expect(() => createManagedLearning({ env: { ...env, PILOTDECK_MANAGED_LOCAL_KEY: 'bad\nkey' } })).toThrow();
});

it('handles empty catalogs and refuses malformed price metadata', async () => {
  const request = vi.fn(async () => Response.json({ items: [], defaultModelId: 'gone' }));
  const managed = createManagedLearning({ env, request });
  expect(await managed.config()).toEqual({ managed: true, models: [], defaultModelId: null });
  request.mockImplementation(async () => Response.json({ items: [{ ...model, inputPriceMicros: -1 }] }));
  await expect(managed.config()).rejects.toThrow('Invalid model catalog.');
});
