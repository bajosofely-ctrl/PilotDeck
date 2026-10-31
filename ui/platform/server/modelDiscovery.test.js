import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { discoverModels } from './modelDiscovery.js';
import { createPlatformApp } from './app.js';

for (const [protocol, baseUrl, endpoint, header] of [
  ['openai', 'https://dashscope.aliyuncs.com/compatible-mode/v1', '/compatible-mode/v1/models', 'Authorization'],
  ['openai-responses', 'https://provider.test', '/v1/models', 'Authorization'],
  ['anthropic', 'https://provider.test', '/v1/models', 'x-api-key'],
  ['google', 'https://provider.test/v1beta', '/v1beta/models', 'x-goog-api-key'],
]) {
  test(`discovers ${protocol} with native authentication and bounded public fields`, async () => {
    const result = await discoverModels({ protocol, baseUrl, apiKey: 'fixture-secret' }, async (url, options) => {
      assert.equal(new URL(url).pathname, endpoint);
      assert.equal(options.method, 'GET');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers[header], header === 'Authorization' ? 'Bearer fixture-secret' : 'fixture-secret');
      assert.equal(new URL(url).searchParams.has('key'), false);
      return Response.json(protocol === 'google'
        ? { models: [{ name: 'models/gemini-fixture', displayName: 'Gemini fixture', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/embedding-fixture', supportedGenerationMethods: ['embedContent'] }] }
        : { data: [{ id: 'model-fixture', display_name: 'Fixture', secret: 'should-not-return' }, { id: 'model-fixture' }, { id: '' }] });
    });
    assert.equal(result.models.length, 1);
    assert.equal(result.truncated, false);
    assert.deepEqual(Object.keys(result.models[0]).sort(), ['id', 'name']);
    assert.ok(!JSON.stringify(result).includes('should-not-return'));
  });
}

test('pagination stays on the configured endpoint and stops on a repeated cursor', async () => {
  let count = 0;
  const result = await discoverModels({ protocol: 'google', baseUrl: 'https://provider.test', apiKey: 'secret' }, async url => {
    assert.equal(new URL(url).pathname, '/v1beta/models');
    if (count++) assert.equal(new URL(url).searchParams.get('pageToken'), 'https://untrusted.test/?key=secret');
    return Response.json({ models: [{ name: 'models/model-a' }], nextPageToken: 'https://untrusted.test/?key=secret' });
  });
  assert.equal(count, 2);
  assert.equal(result.models.length, 1);
  assert.equal(result.truncated, true);
});

test('Anthropic pagination uses after_id and keeps the version header', async () => {
  let page = 0;
  const result = await discoverModels({ protocol: 'anthropic', baseUrl: 'https://provider.test/v1', apiKey: 'secret' }, async (url, options) => {
    assert.equal(options.headers['anthropic-version'], '2023-06-01');
    if (page++) {
      assert.equal(new URL(url).searchParams.get('after_id'), 'claude-a');
      return Response.json({ data: [{ id: 'claude-b' }], has_more: false });
    }
    return Response.json({ data: [{ id: 'claude-a' }], has_more: true, last_id: 'claude-a' });
  });
  assert.deepEqual(result.models.map(model => model.id), ['claude-a', 'claude-b']);
});

test('large paginated catalogs stop after five requests and report a partial list', async () => {
  let pages = 0;
  const result = await discoverModels({ protocol: 'google', baseUrl: 'https://provider.test', apiKey: 'secret' }, async () => {
    pages++;
    return Response.json({ models: [{ name: `models/page-${pages}` }], nextPageToken: String(pages) });
  });
  assert.equal(pages, 5);
  assert.equal(result.models.length, 5);
  assert.equal(result.truncated, true);
});

test('errors never expose provider bodies, keys or redirects', async () => {
  for (const response of [
    Response.json({ error: 'fixture-secret' }, { status: 401 }),
    Response.json({ error: 'fixture-secret' }, { status: 404 }),
    new Response('fixture-secret', { headers: { 'Content-Type': 'text/html' } }),
    Response.json({ error: 'fixture-secret' }),
    Response.json({ data: [] }, { status: 302, headers: { Location: 'https://untrusted.test' } }),
    new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }),
  ]) {
    await assert.rejects(discoverModels({ protocol: 'openai', baseUrl: 'https://provider.test', apiKey: 'fixture-secret' },
      async () => response), error => error.public && error.status === 502 && !error.message.includes('fixture-secret'));
  }
});

test('timeouts abort an incomplete response stream', async () => {
  let cancelled = false;
  await assert.rejects(discoverModels({ protocol: 'openai', baseUrl: 'https://provider.test', apiKey: 'secret' },
    async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
      headers: { 'Content-Type': 'application/json' },
    }), { timeoutMs: 20 }), error => error.code === 'MODEL_DISCOVERY_TIMEOUT');
  assert.equal(cancelled, true);
});

test('discovery requires admin and never forwards a stored secret to a changed endpoint', async t => {
  const outbound = [];
  const password = 'Fixture-only-password-123';
  const platform = await createPlatformApp({
    dbPath: ':memory:', encryptionKey: 'model-discovery-fixture-private-key',
    bootstrapAdmin: { email: 'admin@example.test', password },
    fetchImpl: async (url, options) => { outbound.push({ url, options }); return Response.json({ data: [{ id: 'remote-model' }] }); },
  });
  const server = platform.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); platform.close(); });
  const api = async (route, body, token) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/platform${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };
  const admin = (await api('/auth/login', { email: 'admin@example.test', password, deviceId: 'admin' })).data.token;
  await api('/admin/users', { email: 'user@example.test', password }, admin);
  const customer = (await api('/auth/login', { email: 'user@example.test', password, deviceId: 'user' })).data.token;
  const model = { id: 'saved', name: 'Saved', provider: 'Fixture', protocol: 'openai', baseUrl: 'https://provider.test/v1',
    upstreamModel: 'remote-model', apiKey: 'stored-secret', enabled: false, inputPriceMicros: 1, outputPriceMicros: 1,
    maxInputTokens: 1000, maxOutputTokens: 100, capabilities: ['text'] };
  assert.equal((await api('/admin/models', model, admin)).status, 201);
  const request = { modelId: 'saved', provider: 'Fixture', protocol: 'openai', baseUrl: model.baseUrl };
  assert.equal((await api('/admin/models/discover', request)).status, 401);
  assert.equal((await api('/admin/models/discover', request, customer)).status, 403);
  assert.equal((await api('/admin/models/discover', { ...request, baseUrl: 'https://untrusted.test' }, admin)).status, 400);
  assert.equal((await api('/admin/models/discover', { ...request, protocol: 'google' }, admin)).status, 400);
  assert.equal((await api('/admin/models/discover', { ...request, modelId: undefined }, admin)).status, 400);
  assert.equal((await api('/admin/models/discover', { ...request, apiKey: 'invalid\r\nkey' }, admin)).status, 400);
  assert.equal((await api('/admin/models/discover', { ...request, baseUrl: 'file:///etc/passwd' }, admin)).status, 400);
  assert.equal(outbound.length, 0);
  const result = await api('/admin/models/discover', request, admin);
  assert.equal(result.status, 200);
  assert.equal(outbound[0].options.headers.Authorization, 'Bearer stored-secret');
  assert.ok(!JSON.stringify(result).includes('stored-secret'));
  assert.equal((await api('/admin/models/discover', {
    ...request, baseUrl: 'https://new-provider.test/v1', apiKey: 'new-explicit-key',
  }, admin)).status, 200);
  assert.equal(outbound[1].options.headers.Authorization, 'Bearer new-explicit-key');
  assert.equal(platform.db.prepare('SELECT COUNT(*) AS n FROM models').get().n, 1);
  assert.equal(platform.db.prepare('SELECT COUNT(*) AS n FROM billing_ledger').get().n, 0);
});
