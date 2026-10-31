import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { installManagedClient } from './managedClient.js';
import { managedModelConfig, platformUrl, bootstrapManagedClient } from './managedBootstrap.js';
import { apiApplication, createManagedAppGuard } from './managedAccess.js';
import { createGoogleClient } from '../../dist/src/model/providers/google/client.js';
import { loadPilotConfig } from '../../dist/src/pilot/config/loadPilotConfig.js';
import { listModelCatalog } from '../../dist/src/gateway/dialog/modelCatalog.js';
import { effectiveInputContextTokens } from '../../dist/src/context/budget/effectiveContext.js';

async function serve(t, app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
const model = { id: 'text.test', name: 'Test', protocol: 'openai', maxInputTokens: 4096, maxOutputTokens: 100 };
const env = {
  PILOTDECK_MANAGED_URL: 'http://127.0.0.1:3100', PILOTDECK_MANAGED_TOKEN: 'account-session-secret',
  PILOTDECK_MANAGED_USER_ID: 'alice', PILOTDECK_MANAGED_LOCAL_KEY: 'local-only-key',
};

test('service URL rejects insecure remote servers and credential URLs', () => {
  assert.equal(platformUrl('https://operator.example/'), 'https://operator.example');
  assert.throws(() => platformUrl('http://operator.example'));
  assert.throws(() => platformUrl('https://a:b@operator.example'));
});

test('generated model configuration contains local credentials and no cloud session', () => {
  const config = managedModelConfig([model], { port: 3001, localKey: env.PILOTDECK_MANAGED_LOCAL_KEY });
  assert.match(config.providers['managed_text.test'].url, /127\.0\.0\.1:3001\/api\/managed\/relay\/chat\/text.test$/);
  assert.equal(config.providers['managed_text.test'].retry.requestMaxRetries, 0);
  assert.equal(JSON.stringify(config).includes(env.PILOTDECK_MANAGED_TOKEN), false);
  assert.throws(() => managedModelConfig([{ ...model, id: '../escape' }], { port: 3001, localKey: 'a' }));
});

test('managed input allowance is preserved after reserving output tokens', () => {
  const config = managedModelConfig([model], { port: 3001, localKey: env.PILOTDECK_MANAGED_LOCAL_KEY });
  const caps = config.providers['managed_text.test'].models[model.id].capabilities;
  assert.equal(effectiveInputContextTokens(caps.maxContextTokens, caps.maxOutputTokens), model.maxInputTokens);
});

test('bootstrap verifies identity and creates isolated config without cloud token', async t => {
  const app = express();
  app.get('/api/platform/me', (_req, res) => res.json({ user: { id: 'alice' } }));
  app.get('/api/platform/models', (_req, res) => res.json({ items: [model], defaultModelId: model.id }));
  const url = await serve(t, app);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pilot-managed-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = { ...env, PILOT_HOME: directory, PILOTDECK_MANAGED_URL: url, SERVER_PORT: '3001' };
  await bootstrapManagedClient(settings);
  const content = await readFile(path.join(directory, 'pilotdeck.yaml'), 'utf8');
  assert.equal(parse(content).agent.model, 'managed_text.test/text.test');
  assert.equal(content.includes(env.PILOTDECK_MANAGED_TOKEN), false);
  await assert.rejects(bootstrapManagedClient({ ...settings, PILOTDECK_MANAGED_USER_ID: 'bob', PILOTDECK_MANAGED_OFFLINE: '1' }), /mismatch/);
  await assert.rejects(bootstrapManagedClient({ ...settings, PILOTDECK_CONFIG_PATH: path.join(directory, '..', 'foreign.yaml') }), /account profile/);
});

test('no chat permission still boots local configuration without publishing a usable chat model', async t => {
  const cloud = express();
  cloud.get('/api/platform/me', (_req, res) => res.json({ user: { id: 'alice', status: 'active', apps: ['learning', 'automation'] } }));
  cloud.get('/api/platform/models', (_req, res) => res.status(403).json({ error: 'Chat disabled' }));
  const url = await serve(t, cloud);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pilot-managed-no-chat-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settings = { ...env, PILOT_HOME: directory, PILOTDECK_MANAGED_URL: url,
    PILOTDECK_CONFIG_PATH: path.join(directory, 'pilotdeck.yaml'), SERVER_PORT: '3001' };
  assert.equal((await bootstrapManagedClient(settings)).count, 0);
  const config = loadPilotConfig({ env: settings, projectRoot: directory }).config;
  assert.equal(config.agent.model.provider, 'managed__disabled');
  assert.equal(listModelCatalog({}, settings).items.length, 0);
  assert.equal(config.model.providers.managed__disabled.retry.requestMaxRetries, 0);
  const local = express(); local.use(express.json());
  let forwarded = false;
  installManagedClient(local, { env, request: async () => { forwarded = true; return Response.json({}); } });
  const localUrl = await serve(t, local);
  const denied = await fetch(`${localUrl}/api/managed/unavailable/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.PILOTDECK_MANAGED_LOCAL_KEY}` },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'MODEL_UNAVAILABLE');
  assert.equal(forwarded, false);
});

test('relay rejects unauthorized callers, forwards only allowed routes and hides account token', async t => {
  const calls = [];
  const app = express(); app.use(express.json());
  installManagedClient(app, { env, request: async (_env, endpoint, options) => {
    calls.push({ endpoint, options });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }] }), { headers: { 'Content-Type': 'application/json' } });
  } });
  const url = await serve(t, app);
  const target = `${url}/api/managed/relay/chat/text.test/v1/chat/completions`;
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [] }) };
  assert.equal((await fetch(target, options)).status, 401);
  const authenticated = { ...options, headers: { ...options.headers, Authorization: `Bearer ${env.PILOTDECK_MANAGED_LOCAL_KEY}` } };
  const response = await fetch(target, authenticated);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).choices[0].message.content, 'hello');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, '/relay/chat/text.test/v1/chat/completions');
  assert.ok(calls[0].options.headers['Idempotency-Key']);
  assert.equal((await fetch(`${url}/api/managed/relay/chat/text.test/secrets`, authenticated)).status, 404);
});

test('managed browser routes reject cross-site changes and provider edits', async t => {
  let called = false;
  const app = express(); app.use(express.json());
  installManagedClient(app, { env, request: async () => { called = true; return Response.json({ ok: true }); } });
  app.put('/api/config', (_req, res) => res.json({ changed: true }));
  const url = await serve(t, app);
  assert.equal((await fetch(`${url}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(`${url}/api/managed/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' })).status, 403);
  assert.equal(called, false);
});

test('managed origin guard permits same-origin multipart uploads without relaxing account JSON endpoints', async t => {
  const app = express(); app.use(express.json());
  installManagedClient(app, { env, request: async () => Response.json({
    user: { id: 'alice', status: 'active', apps: ['files'] },
  }) });
  app.post('/api/uploads', (_req, res) => res.json({ accepted: true }));
  const url = await serve(t, app);
  const form = new FormData();
  form.append('file', new Blob(['attachment']), 'example.txt');
  assert.equal((await fetch(`${url}/api/uploads`, { method: 'POST', body: form, headers: { Origin: url } })).status, 200);
  assert.equal((await fetch(`${url}/api/uploads`, { method: 'POST', body: form, headers: { Origin: 'https://foreign.example' } })).status, 403);
  assert.equal((await fetch(`${url}/api/managed/redeem`, { method: 'POST', body: form, headers: { Origin: url } })).status, 415);
});

test('generated Google provider works with the existing SDK endpoint resolver', async t => {
  const calls = [];
  const app = express(); app.use(express.json());
  installManagedClient(app, { env, request: async (_env, endpoint) => {
    calls.push(endpoint);
    return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: 'SDK connected' }] } }] });
  } });
  const url = await serve(t, app);
  const config = managedModelConfig([{ ...model, protocol: 'google' }], {
    port: Number(new URL(url).port), localKey: env.PILOTDECK_MANAGED_LOCAL_KEY,
  });
  const client = createGoogleClient({ ...config.providers['managed_text.test'], id: 'managed_text.test' });
  const response = await client.models.generateContent({ model: model.id, contents: 'hello' });
  assert.equal(response.candidates[0].content.parts[0].text, 'SDK connected');
  assert.deepEqual(calls, ['/relay/chat/text.test/v1beta/models/text.test:generateContent']);
});

test('learning helper uses authorized catalog and server-selected relay, ignores injected endpoint', async t => {
  const calls = [];
  const app = express(); app.use(express.json());
  installManagedClient(app, { env, request: async (_env, endpoint, options) => {
    calls.push({ endpoint, options });
    return Response.json(endpoint.includes('/models') ? { items: [model], defaultModelId: model.id } : { choices: [{ message: { content: 'Tutor answer' } }] });
  } });
  const url = await serve(t, app);
  const response = await fetch(`${url}/api/managed/learning/complete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.PILOTDECK_MANAGED_LOCAL_KEY}` },
    body: JSON.stringify({ endpoint: 'https://evil.example', apiKey: 'override', messages: [{ role: 'user', content: 'help' }] }),
  });
  assert.equal((await response.json()).answer, 'Tutor answer');
  assert.equal(calls[1].endpoint, '/relay/learning/text.test/v1/chat/completions');
  assert.equal(calls[1].options.body.includes('evil'), false);
});

test('automation catalog requires local credentials and preserves cloud denial without chat fallback', async t => {
  const calls = [];
  let denied = false;
  const app = express();
  installManagedClient(app, { env, request: async (_env, endpoint) => {
    calls.push(endpoint);
    return denied ? Response.json({ code: 'APP_FORBIDDEN', error: 'Forbidden' }, { status: 403 })
      : Response.json({ models: [model], defaultModelId: model.id });
  } });
  const url = await serve(t, app);
  const endpoint = `${url}/api/managed/automation/models?appId=chat`;
  assert.equal((await fetch(endpoint)).status, 401);
  assert.deepEqual(calls, []);
  const options = { headers: { Authorization: `Bearer ${env.PILOTDECK_MANAGED_LOCAL_KEY}` } };
  const success = await fetch(endpoint, options);
  assert.equal((await success.json()).items[0].id, model.id);
  denied = true;
  const failure = await fetch(endpoint, options);
  assert.equal(failure.status, 403);
  assert.equal((await failure.json()).code, 'APP_FORBIDDEN');
  assert.deepEqual(calls, ['/models?appId=automation', '/models?appId=automation']);
});

test('local module authorization denies disabled applications and revoked sessions', async t => {
  assert.equal(apiApplication('/projects/p/files/content'), 'files');
  assert.equal(apiApplication('/always-on/cron-jobs'), 'automation');
  const app = express();
  const guard = createManagedAppGuard({ env, request: async () => Response.json({ user: {
    id: 'alice', status: 'active', apps: ['files'],
  } }) });
  app.get('/files', guard('files'), (_req, res) => res.json({ ok: true }));
  app.get('/learning', guard('learning'), (_req, res) => res.json({ ok: true }));
  app.get('/revoked', createManagedAppGuard({ env, request: async () => Response.json({ error: 'revoked' }, { status: 401 }) })('files'), (_req, res) => res.json({ ok: true }));
  const url = await serve(t, app);
  assert.equal((await fetch(`${url}/files`)).status, 200);
  assert.equal((await fetch(`${url}/learning`)).status, 403);
  assert.equal((await fetch(`${url}/revoked`)).status, 401);
});
