import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { createPlatformApp } from './app.js';
import { createAuthContext } from './auth.js';

const password = 'Test-only-password-123!';
const encryptionKey = 'test-only-encryption-key-32-bytes-long';

async function fixture(t, options = {}) {
  const codes = [];
  const platform = await createPlatformApp({
    dbPath: ':memory:', encryptionKey,
    bootstrapAdmin: { email: 'admin@example.test', password },
    sendCode: async (message) => { codes.push(message); },
    ...options,
  });
  const server = platform.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    platform.close();
  });
  const request = async (path, { method = 'GET', body, token } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/platform${path}`, {
      method, headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const login = async (email = 'admin@example.test', deviceId = 'device-1', suppliedPassword = password) =>
    request('/auth/login', { method: 'POST', body: { email, password: suppliedPassword, deviceId, deviceName: 'Test PC' } });
  const admin = await login();
  assert.equal(admin.status, 200);
  const createUser = async (email = 'customer@example.test', extra = {}) => {
    const result = await request('/admin/users', {
      method: 'POST', token: admin.body.token, body: { email, password, ...extra },
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body.user;
  };
  return { ...platform, codes, request, login, createUser, adminToken: admin.body.token };
}

test('registration cannot escalate roles; codes are single-use and credentials never leak', async (t) => {
  const f = await fixture(t);
  const email = 'register@example.test';
  assert.equal((await f.request('/auth/code', { method: 'POST', body: { email, purpose: 'register' } })).status, 200);
  const code = f.codes.at(-1).code;
  const body = { email, password, code, deviceId: 'first' };
  assert.equal((await f.request('/auth/register', { method: 'POST', body: { ...body, role: 'admin' } })).status, 400);
  const registered = await f.request('/auth/register', { method: 'POST', body });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.role, 'user');
  assert.equal(registered.body.user.deviceLimit, 3);
  assert.equal(registered.body.user.concurrencyLimit, 3);
  assert.ok(registered.body.user.apps.includes('learning'));
  assert.equal((await f.request('/admin/users', { token: registered.body.token })).status, 403);
  assert.equal((await f.request('/auth/register', { method: 'POST', body })).status, 400);
  const row = f.db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  assert.notEqual(row.password_hash, password);
  const session = f.db.prepare('SELECT * FROM sessions WHERE user_id = ?').get(row.id);
  assert.notEqual(session.token_hash, registered.body.token);
  assert.ok(!JSON.stringify(registered.body).includes('password_hash'));
  assert.ok(!JSON.stringify(await f.request('/devices', { token: registered.body.token })).includes(session.token_hash));
});

test('device capacity, ownership, revocation and disabled users are enforced server-side', async (t) => {
  const f = await fixture(t);
  const user = await f.createUser();
  const sessions = [];
  for (const id of ['one', 'two', 'three']) sessions.push((await f.login(user.email, id)).body.token);
  assert.equal((await f.login(user.email, 'four')).status, 409);
  const renewed = await f.login(user.email, 'one');
  assert.equal(renewed.status, 200);
  assert.equal((await f.request('/me', { token: sessions[0] })).status, 401);
  const devices = await f.request('/devices', { token: renewed.body.token });
  assert.equal(devices.body.devices.length, 3);
  const other = await f.createUser('other@example.test');
  const otherToken = (await f.login(other.email)).body.token;
  assert.equal((await f.request(`/devices/${devices.body.devices[0].id}`, { method: 'DELETE', token: otherToken })).status, 404);
  assert.equal((await f.request(`/admin/users/${user.id}/devices`, { method: 'DELETE', token: f.adminToken })).status, 200);
  assert.equal((await f.request('/me', { token: renewed.body.token })).status, 401);
  const active = await f.login(user.email);
  assert.equal((await f.request(`/admin/users/${user.id}`, { method: 'PATCH', token: f.adminToken, body: { status: 'disabled' } })).status, 200);
  assert.equal((await f.request('/me', { token: active.body.token })).status, 401);
  assert.equal((await f.login(user.email)).status, 401);
});

function legacyAdminSession(f, token, createdAt, expiresAt = Date.now() + 60000) {
  const admin = f.db.prepare("SELECT id FROM users WHERE role='admin'").get();
  f.db.prepare(`INSERT INTO sessions(id,user_id,token_hash,device_id,device_name,created_at,last_seen_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(), admin.id,
    createHash('sha256').update(token).digest('hex'), randomUUID(), 'Legacy browser',
    createdAt, createdAt, expiresAt);
}

test('administrator login replaces every old session even at capacity and leaves customer sessions usable', async t => {
  const f = await fixture(t);
  const customer = await f.createUser();
  const customerLogin = await f.login(customer.email);
  f.db.prepare("UPDATE users SET device_limit=3 WHERE role='admin'").run();
  legacyAdminSession(f, 'a'.repeat(43), Date.now() - 2000);
  legacyAdminSession(f, 'b'.repeat(43), Date.now() - 1000);
  const replacement = await f.login('admin@example.test', 'new-browser');
  assert.equal(replacement.status, 200);
  assert.equal(replacement.body.user.deviceLimit, 1);
  for (const token of [f.adminToken, 'a'.repeat(43), 'b'.repeat(43)]) {
    assert.equal((await f.request('/admin/users', { token })).status, 401);
  }
  const devices = await f.request('/devices', { token: replacement.body.token });
  assert.equal(devices.body.devices.length, 1);
  assert.equal(devices.body.devices[0].deviceId, 'new-browser');
  assert.equal((await f.request('/me', { token: customerLogin.body.token })).status, 200);
});

test('failed administrator authentication cannot evict the current session', async t => {
  const f = await fixture(t);
  assert.equal((await f.login('admin@example.test', 'other', 'incorrect-password')).status, 401);
  assert.equal((await f.request('/admin/users', { token: f.adminToken })).status, 200);
  assert.equal((await f.request('/devices', { token: f.adminToken })).body.devices.length, 1);
});

test('concurrent administrator logins leave exactly one usable session', async t => {
  const f = await fixture(t);
  const logins = await Promise.all(['browser-a', 'browser-b', 'browser-c'].map(id => f.login('admin@example.test', id)));
  for (const login of logins) assert.equal(login.status, 200);
  const statuses = await Promise.all(logins.map(login => f.request('/me', { token: login.body.token }).then(result => result.status)));
  assert.deepEqual(statuses.sort(), [200, 401, 401]);
  assert.equal((await f.request('/me', { token: f.adminToken })).status, 401);
});

test('auth initialization keeps only the most recent unexpired administrator session without revoking customers', async t => {
  const f = await fixture(t);
  const customer = await f.createUser();
  const customerLogin = await f.login(customer.email);
  const latestToken = 'c'.repeat(43);
  const now = Date.now();
  f.db.prepare("UPDATE users SET device_limit=3 WHERE role='admin'").run();
  f.db.prepare('UPDATE sessions SET created_at=? WHERE user_id=(SELECT id FROM users WHERE role=?)')
    .run(now - 20000, 'admin');
  legacyAdminSession(f, 'a'.repeat(43), now - 10000);
  legacyAdminSession(f, latestToken, now - 5000);
  legacyAdminSession(f, 'b'.repeat(43), now - 1000, now - 100);
  for (let run = 0; run < 2; run++) {
    createAuthContext(f.db, { codeKey: encryptionKey });
    assert.equal((await f.request('/me', { token: f.adminToken })).status, 401);
    assert.equal((await f.request('/me', { token: 'a'.repeat(43) })).status, 401);
    assert.equal((await f.request('/me', { token: latestToken })).status, 200);
    assert.equal((await f.request('/me', { token: customerLogin.body.token })).status, 200);
    assert.equal((await f.request('/devices', { token: latestToken })).body.devices.length, 1);
    assert.equal((await f.request('/me', { token: latestToken })).body.user.deviceLimit, 1);
  }
});

test('password reset and change revoke all sessions and expired codes fail', async (t) => {
  const f = await fixture(t);
  const user = await f.createUser();
  const loggedIn = await f.login(user.email);
  await f.request('/auth/code', { method: 'POST', body: { email: user.email, purpose: 'reset-password' } });
  const code = f.codes.at(-1).code;
  const replacement = 'Replacement-password-456!';
  assert.equal((await f.request('/auth/reset-password', {
    method: 'POST', body: { email: user.email, code, password: replacement },
  })).status, 200);
  assert.equal((await f.request('/me', { token: loggedIn.body.token })).status, 401);
  assert.equal((await f.login(user.email)).status, 401);
  const fresh = await f.login(user.email, 'one', replacement);
  assert.equal(fresh.status, 200);
  assert.equal((await f.request('/auth/change-password', {
    method: 'POST', token: fresh.body.token, body: { currentPassword: replacement, newPassword: password },
  })).status, 200);
  assert.equal((await f.request('/me', { token: fresh.body.token })).status, 401);
  await f.request('/auth/code', { method: 'POST', body: { email: 'expired@example.test', purpose: 'register' } });
  f.db.prepare('UPDATE email_codes SET expires_at = 0 WHERE email = ?').run('expired@example.test');
  assert.equal((await f.request('/auth/register', {
    method: 'POST', body: { email: 'expired@example.test', password, code: f.codes.at(-1).code, deviceId: 'one' },
  })).status, 400);
});

test('operator config encrypts keys and catalogs apply app permissions and capabilities', async (t) => {
  const f = await fixture(t);
  const user = await f.createUser();
  const token = (await f.login(user.email)).body.token;
  const model = {
    id: 'test-model', name: 'Test model', provider: 'openai', protocol: 'openai',
    baseUrl: 'https://api.example.test/v1', upstreamModel: 'test-upstream',
    apiKey: 'never-expose-this-provider-secret', enabled: true,
    inputPriceMicros: 1000000, outputPriceMicros: 2000000,
    maxInputTokens: 8192, maxOutputTokens: 1024, capabilities: ['text', 'image'],
  };
  const created = await f.request('/admin/models', { method: 'POST', token: f.adminToken, body: model });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.ok(!JSON.stringify(created.body).includes(model.apiKey));
  const row = f.db.prepare('SELECT * FROM channels WHERE id = ?').get(created.body.model.channelId);
  assert.ok(row.secret && !row.secret.includes(model.apiKey));
  assert.equal(f.db.prepare('SELECT secret FROM models WHERE id=?').get(model.id).secret, '');
  assert.equal((await f.request('/admin/apps', {
    method: 'PUT', token: f.adminToken,
    body: { apps: [{ id: 'chat', name: 'Chat', enabled: true, defaultModelId: model.id, modelIds: [model.id] }] },
  })).status, 200);
  const catalog = await f.request('/models?appId=chat&capability=image', { token });
  assert.equal(catalog.body.models.length, 1);
  assert.ok(!JSON.stringify(catalog.body).includes('api.example.test'));
  assert.ok(!JSON.stringify(catalog.body).includes(model.apiKey));
  assert.equal((await f.request('/admin/models', { token })).status, 403);
  await f.request(`/admin/users/${user.id}`, { method: 'PATCH', token: f.adminToken, body: { apps: ['learning'] } });
  assert.equal((await f.request('/models?appId=chat', { token })).status, 403);
  assert.equal((await f.request('/admin/models/test-model', {
    method: 'PATCH', token: f.adminToken, body: { inputPriceMicros: -1 },
  })).status, 400);
});

test('settings reject malformed bounds, preserve defaults, and cannot create administrators', async (t) => {
  const f = await fixture(t);
  for (const body of [{ deviceLimit: 0 }, { concurrencyLimit: 1.2 }, { giftAmountMicros: -1 }, { registrationEnabled: 'false' }, { defaultApps: ['missing'] }]) {
    assert.equal((await f.request('/admin/settings', { method: 'PUT', token: f.adminToken, body })).status, 400);
  }
  assert.equal((await f.request('/admin/users', {
    method: 'POST', token: f.adminToken, body: { email: 'intruder@example.test', password, role: 'admin' },
  })).status, 400);
  const changed = await f.request('/admin/settings', {
    method: 'PUT', token: f.adminToken, body: { registrationEnabled: false, deviceLimit: 2, defaultApps: ['chat'] },
  });
  assert.equal(changed.status, 200);
  assert.equal((await f.request('/auth/code', { method: 'POST', body: { email: 'new@example.test', purpose: 'register' } })).status, 403);
  const user = await f.createUser();
  assert.deepEqual(user.apps, ['chat']);
  assert.equal(user.deviceLimit, 2);
  assert.equal((await f.request(`/admin/users/${user.id}`, { method: 'PATCH', token: f.adminToken, body: { role: 'admin' } })).status, 400);
});

test('code delivery errors are sanitized and code sending is throttled', async (t) => {
  const f = await fixture(t, { sendCode: async () => { throw new Error('mail-secret-123'); } });
  const body = { email: 'mail@example.test', purpose: 'register' };
  const failed = await f.request('/auth/code', { method: 'POST', body });
  assert.equal(failed.status, 503);
  assert.ok(!JSON.stringify(failed.body).includes('mail-secret'));
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM email_codes WHERE email = ? AND used_at IS NULL').get(body.email).count, 0);
  assert.equal((await f.request('/auth/code', { method: 'POST', body })).status, 429);
});

const connectionResponses = {
  openai: {
    id: 'fixture-completion', object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 },
  },
  'openai-responses': {
    id: 'fixture-response', object: 'response', status: 'completed',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'OK' }] }],
    usage: { input_tokens: 9, output_tokens: 2, total_tokens: 11 },
  },
  anthropic: {
    id: 'fixture-message', type: 'message', role: 'assistant', stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'OK' }],
    usage: { input_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 2, output_tokens: 2 },
  },
  google: {
    candidates: [{ content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 2, thoughtsTokenCount: 1, totalTokenCount: 12 },
  },
};
const connectionModel = protocol => ({
  id: protocol, name: protocol, provider: protocol, protocol,
  baseUrl: 'https://provider.example.test', upstreamModel: 'upstream',
  apiKey: 'private-provider-secret', enabled: true, inputPriceMicros: 1000000,
  outputPriceMicros: 2000000, maxInputTokens: 4096, maxOutputTokens: 16, capabilities: ['text'],
});

test('operator connection tests use native requests, stored credentials, sanitized failures and no customer accounting', async t => {
  const requests = [];
  const f = await fixture(t, { fetchImpl: async (url, options) => {
    requests.push({ url, options });
    if (url.includes('failure')) throw new Error('private-provider-secret');
    const protocol = url.includes('chat/completions') ? 'openai' : url.includes('/responses') ? 'openai-responses'
      : url.includes('/messages') ? 'anthropic' : 'google';
    return Response.json(connectionResponses[protocol]);
  } });
  const user = await f.createUser();
  const token = (await f.login(user.email)).body.token;
  const before = await f.request('/wallet', { token });
  for (const protocol of ['openai', 'openai-responses', 'anthropic', 'google']) {
    const model = connectionModel(protocol);
    assert.equal((await f.request('/admin/models', { method: 'POST', token: f.adminToken, body: model })).status, 201);
    assert.equal((await f.request(`/admin/models/${protocol}/test`, { method: 'POST', token })).status, 403);
    const result = await f.request(`/admin/models/${protocol}/test`, { method: 'POST', token: f.adminToken });
    assert.deepEqual(result.body, { ok: true, upstreamStatus: 200 });
    const sent = requests.at(-1);
    assert.equal(sent.options.redirect, 'error');
    const payload = JSON.parse(sent.options.body);
    assert.equal(payload.max_completion_tokens ?? payload.max_tokens ?? payload.max_output_tokens ?? payload.generationConfig.maxOutputTokens, 16);
    if (protocol === 'openai') {
      assert.equal(payload.max_completion_tokens, 16);
      assert.equal(payload.max_tokens, undefined);
    }
    assert.ok(Object.values(sent.options.headers).some(value => value.includes(model.apiKey)));
  }
  assert.deepEqual((await f.request('/wallet', { token })).body, before.body);
  for (const table of ['billing_calls', 'billing_allocations', 'billing_ledger', 'billing_lots']) {
    assert.equal(f.db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, 0);
  }
  const { channel_id: channelId } = f.db.prepare("SELECT channel_id FROM models WHERE id='openai'").get();
  assert.equal((await f.request(`/admin/channels/${channelId}`, { method: 'PATCH', token: f.adminToken,
    body: { baseUrl: 'https://failure.example.test', apiKey: 'private-provider-secret' } })).status, 200);
  const failure = await f.request('/admin/models/openai/test', { method: 'POST', token: f.adminToken });
  assert.deepEqual(failure.body, { ok: false, upstreamStatus: null });
  assert.deepEqual((await f.request('/wallet', { token })).body, before.body);
  assert.equal((await f.request('/admin/models/missing/test', { method: 'POST', token: f.adminToken })).status, 404);
});

for (const protocol of Object.keys(connectionResponses)) {
  test(`${protocol} connection test rejects false success and invalid or over-bound usage`, async t => {
    let respond = () => Response.json({});
    const f = await fixture(t, { fetchImpl: async () => respond() });
    assert.equal((await f.request('/admin/models', {
      method: 'POST', token: f.adminToken, body: connectionModel(protocol),
    })).status, 201);
    const missingUsage = structuredClone(connectionResponses[protocol]);
    delete missingUsage.usage;
    delete missingUsage.usageMetadata;
    const overBound = structuredClone(connectionResponses[protocol]);
    const invalidUsage = structuredClone(connectionResponses[protocol]);
    if (protocol === 'google') {
      overBound.usageMetadata = { promptTokenCount: 9, candidatesTokenCount: 16, thoughtsTokenCount: 1, totalTokenCount: 26 };
      invalidUsage.usageMetadata.totalTokenCount = 10;
    } else if (protocol === 'anthropic') {
      overBound.usage.output_tokens = 17;
      invalidUsage.usage.cache_read_input_tokens = -1;
    } else {
      const outputKey = protocol === 'openai' ? 'completion_tokens' : 'output_tokens';
      overBound.usage[outputKey] = 17;
      overBound.usage.total_tokens = 26;
      invalidUsage.usage.total_tokens = 999;
    }
    const wrongEnvelope = protocol === 'google'
      ? { usageMetadata: connectionResponses[protocol].usageMetadata, choices: [] }
      : { usage: connectionResponses[protocol].usage };
    const cases = [
      () => new Response('<html>private-provider-secret</html>', { headers: { 'content-type': 'text/html' } }),
      () => Response.json({}),
      () => new Response('{"private-provider-secret":', { headers: { 'content-type': 'application/json' } }),
      () => Response.json({ ...connectionResponses[protocol], error: { message: 'private-provider-secret' } }),
      () => Response.json(missingUsage),
      () => Response.json(invalidUsage),
      () => Response.json(overBound),
      () => Response.json(wrongEnvelope),
      () => Response.json({ error: { message: 'private-provider-secret' } }, { status: 401 }),
    ];
    for (const makeResponse of cases) {
      respond = makeResponse;
      const expectedStatus = makeResponse().status;
      const result = await f.request(`/admin/models/${protocol}/test`, { method: 'POST', token: f.adminToken });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, { ok: false, upstreamStatus: expectedStatus });
    }
    assert.equal(f.db.prepare("SELECT count(*) AS count FROM audit_log WHERE action='model.test-success'").get().count, 0);
    assert.equal(f.db.prepare("SELECT count(*) AS count FROM audit_log WHERE action='model.test-failure'").get().count, cases.length);
    assert.equal(f.db.prepare('SELECT count(*) AS count FROM billing_calls').get().count, 0);
    assert.equal(f.db.prepare('SELECT count(*) AS count FROM billing_ledger').get().count, 0);
  });
}

test('connection tests stop and cancel oversized chunked responses without persisting body or charging customers', async t => {
  let cancelled = false, pulls = 0;
  const f = await fixture(t, { fetchImpl: async () => new Response(new ReadableStream({
    pull(controller) {
      pulls++;
      controller.enqueue(new TextEncoder().encode(' '.repeat(8192)));
      if (pulls === 256) controller.close();
    },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'application/json' } }) });
  await f.request('/admin/models', { method: 'POST', token: f.adminToken, body: connectionModel('openai') });
  const result = await f.request('/admin/models/openai/test', { method: 'POST', token: f.adminToken });
  assert.deepEqual(result.body, { ok: false, upstreamStatus: 200 });
  assert.equal(cancelled, true);
  assert.ok(pulls < 20, `Read ${pulls} chunks before rejecting`);
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM billing_ledger').get().count, 0);
});

test('connection request normalization preserves compatible OpenAI caps and Google model prefixes', async t => {
  let sent;
  const f = await fixture(t, { fetchImpl: async (url, options) => {
    sent = { url, body: JSON.parse(options.body) };
    return Response.json(url.includes('generateContent') ? connectionResponses.google : connectionResponses.openai);
  } });
  await f.request('/admin/models', { method: 'POST', token: f.adminToken,
    body: { ...connectionModel('openai'), provider: 'deepseek' } });
  assert.equal((await f.request('/admin/models/openai/test', { method: 'POST', token: f.adminToken })).body.ok, true);
  assert.equal(sent.body.max_tokens, 16);
  assert.equal(sent.body.max_completion_tokens, undefined);
  await f.request('/admin/models', { method: 'POST', token: f.adminToken,
    body: { ...connectionModel('google'), upstreamModel: 'models/gemini-fixture', baseUrl: 'https://provider.example.test/v1beta' } });
  assert.equal((await f.request('/admin/models/google/test', { method: 'POST', token: f.adminToken })).body.ok, true);
  assert.equal(sent.url, 'https://provider.example.test/v1beta/models/gemini-fixture:generateContent');
});

test('connection tests accept native token-limit reasoning responses with verifiable usage', async t => {
  let response;
  const f = await fixture(t, { fetchImpl: async () => Response.json(response) });
  const truncated = structuredClone(connectionResponses);
  truncated.openai.choices[0] = { message: { role: 'assistant', content: null }, finish_reason: 'length' };
  truncated['openai-responses'].status = 'incomplete';
  truncated['openai-responses'].incomplete_details = { reason: 'max_output_tokens' };
  truncated['openai-responses'].output = [{ type: 'reasoning', summary: [] }];
  truncated.anthropic.stop_reason = 'max_tokens';
  truncated.anthropic.content = [{ type: 'thinking', thinking: 'fixture reasoning', signature: 'fixture-signature' }];
  truncated.google.candidates = [{ finishReason: 'MAX_TOKENS' }];
  for (const protocol of Object.keys(connectionResponses)) {
    await f.request('/admin/models', { method: 'POST', token: f.adminToken, body: connectionModel(protocol) });
    response = truncated[protocol];
    const result = await f.request(`/admin/models/${protocol}/test`, { method: 'POST', token: f.adminToken });
    assert.deepEqual(result.body, { ok: true, upstreamStatus: 200 });
  }
});
