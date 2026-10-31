import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import Database from 'better-sqlite3';
import { initBilling, mountBilling, grantSignupGift } from './billing.js';

const NODE_MODEL = 'gpt-4o-mini-2024-07-18';
const body = (extra = {}) => ({ messages: [{ role: 'user', content: 'hello' }], max_tokens: 10, ...extra });
const usage = (input = 20, output = 5) => ({
  prompt_tokens: input, completion_tokens: output, total_tokens: input + output,
  prompt_tokens_details: { cached_tokens: Math.min(10, input) },
  completion_tokens_details: { reasoning_tokens: Math.min(2, output) },
});

async function listen(app) {
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function fixture(t, upstreamHandler) {
  const calls = [];
  const upstream = express();
  upstream.use(express.json());
  upstream.post('*', async (req, res) => {
    calls.push({ headers: req.headers, body: req.body, path: req.path, query: req.query });
    if (upstreamHandler) return upstreamHandler(req, res);
    res.json({ id: 'fixture', choices: [{ message: { role: 'assistant', content: 'result' } }], usage: usage() });
  });
  const up = await listen(upstream);
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT,password_hash TEXT,role TEXT,status TEXT,
      device_limit INTEGER,concurrency_limit INTEGER,apps TEXT,created_at INTEGER);
    CREATE TABLE channels (id TEXT PRIMARY KEY,name TEXT,provider TEXT,protocol TEXT,base_url TEXT,secret TEXT,enabled INTEGER);
    CREATE TABLE models (id TEXT PRIMARY KEY,name TEXT,channel_id TEXT REFERENCES channels(id),
      upstream_model TEXT,enabled INTEGER,input_price_micros INTEGER,
      output_price_micros INTEGER,max_input_tokens INTEGER,max_output_tokens INTEGER,capabilities TEXT);
    CREATE TABLE apps (id TEXT PRIMARY KEY,name TEXT,enabled INTEGER,default_model_id TEXT,model_ids TEXT);
    INSERT INTO users VALUES ('u','u@example.test','','user','active',3,1,'["chat"]',0),
      ('v','v@example.test','','user','active',3,1,'["chat"]',0),
      ('admin','admin@example.test','','admin','active',3,3,'["chat"]',0);
    INSERT INTO apps VALUES ('chat','Chat',1,'m','["m"]');
  `);
  db.prepare('INSERT INTO channels VALUES (?,?,?,?,?,?,?)').run(
    'c', 'Fixture channel', 'openai', 'openai', `${up.url}/v1`, 'sealed:key-secret', 1,
  );
  db.prepare('INSERT INTO models VALUES (?,?,?,?,?,?,?,?,?,?)').run(
    'm', 'Fixture', 'c', NODE_MODEL,
    1, 1_000_000, 2_000_000, 4096, 100, '["text"]',
  );
  initBilling(db);
  const app = express();
  app.use(express.json());
  const requireUser = (req, res, next) => {
    const id = req.get('authorization')?.replace('Bearer ', '');
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(id || '');
    if (!user || user.status !== 'active') return res.status(401).json({ error: 'Unauthorized' });
    req.platformUser = { id, email: user.email, role: user.role, status: user.status,
      deviceLimit: user.device_limit, concurrencyLimit: user.concurrency_limit, apps: JSON.parse(user.apps) };
    req.platformSession = { id: `session-${id}` };
    next();
  };
  mountBilling(app, {
    db, requireUser, requireAdmin: [requireUser, (req, res, next) => {
      if (req.platformUser.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
      next();
    }],
    getSettings: () => ({}), seal: text => `sealed:${text}`,
    unseal: text => text.slice(7), fetchImpl: fetch,
  });
  const service = await listen(app);
  t.after(async () => {
    service.server.closeAllConnections();
    up.server.closeAllConnections();
    await Promise.all([new Promise(resolve => service.server.close(resolve)), new Promise(resolve => up.server.close(resolve))]);
    db.close();
  });
  async function request(path, { user = 'u', method = 'GET', data, key } = {}) {
    const response = await fetch(`${service.url}/api/platform${path}`, {
      method, headers: { authorization: `Bearer ${user}`, 'content-type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch { /* SSE is intentionally returned verbatim. */ }
    return { status: response.status, json, text, headers: response.headers };
  }
  const credit = async (amountMicros = 1_000_000, user = 'u', requestId = crypto.randomUUID()) => {
    const result = await request(`/admin/users/${user}/adjustments`, {
      user: 'admin', method: 'POST', data: { amountMicros, reason: 'Fixture funding', requestId },
    });
    assert.equal(result.status, 200, result.text);
    return result;
  };
  const relay = (key = crypto.randomUUID(), data = body(), user = 'u') =>
    request('/relay/chat/m/chat/completions', { method: 'POST', data, key, user });
  return { db, request, credit, relay, calls, url: service.url };
}

test('signup gift is once per account, including disabled registration, and keeps its expiry', async t => {
  const f = await fixture(t);
  grantSignupGift(f.db, 'u', { giftEnabled: true, giftAmountMicros: 50, giftExpiryDays: 1 });
  grantSignupGift(f.db, 'u', { giftEnabled: true, giftAmountMicros: 500, giftExpiryDays: null });
  assert.equal((await f.request('/wallet')).json.giftMicros, 50);
  const lots = f.db.prepare("SELECT * FROM billing_lots WHERE user_id='u'").all();
  assert.equal(lots.length, 1);
  assert.ok(lots[0].expires_at > Date.now());
  grantSignupGift(f.db, 'v', { giftEnabled: false });
  grantSignupGift(f.db, 'v', { giftEnabled: true, giftAmountMicros: 50 });
  assert.equal((await f.request('/wallet', { user: 'v' })).json.availableMicros, 0);
});

test('concurrent code redemption credits once; expired and revoked codes cannot credit', async t => {
  const f = await fixture(t);
  const generated = await f.request('/admin/codes', { user: 'admin', method: 'POST',
    data: { count: 3, amountMicros: 100, expiresAt: Date.now() + 60_000, requestId: 'batch' } });
  assert.equal(generated.status, 201, generated.text);
  const [a, b, c] = generated.json.codes;
  const results = await Promise.all(['u', 'v'].map(user => f.request('/redeem', {
    user, method: 'POST', data: { code: a.code, amountMicros: 999999 },
  })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const u = (await f.request('/wallet')).json;
  const v = (await f.request('/wallet', { user: 'v' })).json;
  assert.equal(u.availableMicros + v.availableMicros, 100);
  assert.equal(u.giftMicros + v.giftMicros, 0);
  await f.request(`/admin/codes/${b.id}/revoke`, { user: 'admin', method: 'POST', data: {} });
  assert.equal((await f.request('/redeem', { method: 'POST', data: { code: b.code } })).status, 409);
  f.db.prepare('UPDATE billing_codes SET expires_at=? WHERE id=?').run(Date.now() - 1, c.id);
  assert.equal((await f.request('/redeem', { method: 'POST', data: { code: c.code } })).status, 409);
  assert.equal((await f.request('/admin/codes')).status, 403);
});

test('JSON relay uses server credentials/model and settles actual total usage once with a price snapshot', async t => {
  let f;
  f = await fixture(t, (req, res) => {
    f.db.prepare('UPDATE models SET input_price_micros=9000000,output_price_micros=9000000').run();
    res.json({ choices: [], usage: usage() });
  });
  await f.credit();
  const result = await f.relay('once');
  assert.equal(result.status, 200, result.text);
  assert.equal(f.calls[0].headers.authorization, 'Bearer key-secret');
  assert.equal(f.calls[0].body.model, NODE_MODEL);
  assert.equal(f.calls[0].body.max_completion_tokens, 10);
  assert.equal((await f.request('/wallet')).json.availableMicros, 999970);
  const again = await f.relay('once');
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'IDEMPOTENCY_REPLAY');
  assert.equal(again.json.call.status, 'completed');
  assert.equal(f.calls.length, 1);
  assert.equal((await f.relay('once', body({ temperature: 0 }))).json.code, 'IDEMPOTENCY_CONFLICT');
  const ledger = (await f.request('/ledger')).json.ledger;
  assert.equal(ledger.filter(row => row.kind === 'usage').length, 1);
  assert.ok(!JSON.stringify(ledger).includes('hello'));
  assert.ok(!JSON.stringify(ledger).includes('key-secret'));
});

test('ledger pages include safe call snapshots and never enrich another user linked call', async t => {
  const f = await fixture(t);
  await f.credit();
  await f.credit(1000, 'v');
  assert.equal((await f.relay('ledger-snapshot')).status, 200);
  const call = f.db.prepare("SELECT * FROM billing_calls WHERE user_id='u'").get();
  f.db.prepare('UPDATE models SET input_price_micros=9000000,output_price_micros=9000000').run();
  const expected = (await f.request(`/billing/calls/${call.id}`)).json.call;
  assert.equal(expected.inputTokens, 20);
  assert.equal(expected.outputTokens, 5);
  assert.equal(expected.inputPriceMicros, 1000000);
  assert.equal(expected.outputPriceMicros, 2000000);
  assert.equal(expected.appId, 'chat');
  assert.equal(expected.modelId, 'm');
  assert.equal(expected.status, 'completed');

  for (const endpoint of ['/ledger', '/admin/ledger?userId=u']) {
    const result = await f.request(endpoint, { user: endpoint.startsWith('/admin') ? 'admin' : 'u' });
    assert.equal(result.status, 200);
    const entry = result.json.ledger.find(row => row.kind === 'usage');
    assert.deepEqual(entry.call, expected);
    assert.equal(entry.amountMicros, -30);
    assert.equal(entry.callId, call.id);
    assert.equal(result.json.ledger.find(row => row.kind === 'adjustment').call, null);
    assert.ok(!result.text.includes('hello'));
    assert.ok(!result.text.includes('key-secret'));
    assert.ok(!result.text.includes('fingerprint'));
    assert.ok(!result.text.includes('request_key'));
  }
  // A stale or corrupted cross-user reference must not reveal its target.
  f.db.prepare("UPDATE billing_ledger SET call_id=? WHERE user_id='v'").run(call.id);
  for (const endpoint of ['/ledger', '/admin/ledger?userId=v']) {
    const result = await f.request(endpoint, { user: endpoint.startsWith('/admin') ? 'admin' : 'v' });
    assert.equal(result.json.ledger.length, 1);
    assert.equal(result.json.ledger[0].call, null);
  }
  const all = (await f.request('/admin/ledger', { user: 'admin' })).json.ledger;
  assert.deepEqual(all.find(row => row.kind === 'usage').call, expected);
  assert.equal(all.find(row => row.userId === 'v').call, null);
  assert.equal((await f.request('/ledger?limit=1')).json.ledger.length, 1);
  assert.equal((await f.request('/ledger?offset=100')).json.ledger.length, 0);
});

test('reservation rejects insufficient funds, parallel calls, and unauthorized app/model before forwarding', async t => {
  let finish;
  const entered = Promise.withResolvers();
  const f = await fixture(t, async (req, res) => {
    entered.resolve();
    await new Promise(resolve => { finish = resolve; });
    res.json({ choices: [], usage: usage() });
  });
  assert.equal((await f.relay()).status, 402);
  assert.equal(f.calls.length, 0);
  await f.credit(200000);
  f.db.prepare('UPDATE models SET max_input_tokens=128000').run();
  const first = f.relay('first');
  await entered.promise;
  assert.equal((await f.request('/wallet')).json.heldMicros, 128020);
  assert.equal((await f.relay('second')).status, 429);
  f.db.prepare("UPDATE users SET concurrency_limit=3 WHERE id='u'").run();
  assert.equal((await f.relay('third')).status, 402);
  f.db.prepare("UPDATE apps SET model_ids='[]'").run();
  assert.equal((await f.relay('fourth')).status, 403);
  finish();
  assert.equal((await first).status, 200);
  assert.equal(f.calls.length, 1);
});

test('streaming forwards native SSE across chunk boundaries and reads final usage without double counting cache/reasoning', async t => {
  const wire = `data: ${JSON.stringify({ choices: [{ delta: { content: '你好' } }], usage: null })}\r\n\r\n`
    + `data: ${JSON.stringify({ choices: [], usage: usage() })}\r\n\r\ndata: [DONE]\r\n\r\n`;
  const f = await fixture(t, (req, res) => {
    res.setHeader('content-type', 'text/event-stream');
    const bytes = Buffer.from(wire);
    for (let i = 0; i < bytes.length; i += 7) res.write(bytes.subarray(i, i + 7));
    res.end();
  });
  await f.credit();
  const result = await f.relay('stream', body({ stream: true }));
  assert.equal(result.status, 200);
  assert.equal(result.text, wire);
  assert.equal(f.calls[0].body.stream_options.include_usage, true);
  assert.equal((await f.request('/wallet')).json.availableMicros, 999970);
});

test('missing usage retains original gift holds, frees concurrency, and requires audited idempotent review', async t => {
  const f = await fixture(t, (req, res) => res.json({ choices: [] }));
  grantSignupGift(f.db, 'u', { giftEnabled: true, giftAmountMicros: 150000, giftExpiryDays: 1 });
  f.db.prepare('UPDATE models SET max_input_tokens=128000').run();
  await f.credit(500000);
  await f.relay('unknown');
  let wallet = (await f.request('/wallet')).json;
  assert.equal(wallet.heldMicros, 128020);
  assert.equal(wallet.availableMicros, 521980);
  const pending = (await f.request('/admin/billing/pending', { user: 'admin' })).json.calls;
  assert.equal(pending.length, 1);
  f.db.prepare("UPDATE billing_lots SET expires_at=? WHERE source='gift'").run(Date.now() - 1);
  assert.equal((await f.relay('next')).status, 200);
  const review = { action: 'release', reason: 'Provider verified zero usage', evidence: 'ticket-1', requestId: 'review-1' };
  assert.equal((await f.request(`/admin/billing/calls/${pending[0].id}/review`, {
    user: 'admin', method: 'POST', data: review,
  })).status, 200);
  assert.equal((await f.request(`/admin/billing/calls/${pending[0].id}/review`, {
    user: 'admin', method: 'POST', data: review,
  })).status, 200);
  wallet = (await f.request('/wallet')).json;
  assert.equal(wallet.availableMicros, 371980);
  assert.equal(wallet.giftMicros, 0);
  assert.equal(wallet.expiredMicros, 150000);
});

test('fractional micro charges accumulate exactly instead of rounding each call', async t => {
  const f = await fixture(t, (req, res) => res.json({ choices: [], usage: usage(1, 0) }));
  f.db.prepare('UPDATE models SET input_price_micros=1,output_price_micros=0').run();
  await f.credit(1);
  for (let i = 0; i < 3; i++) assert.equal((await f.relay(`tiny-${i}`)).status, 200);
  const wallet = (await f.request('/wallet')).json;
  assert.equal(wallet.availableUnits, '999997');
  const charges = (await f.request('/ledger')).json.ledger.filter(row => row.kind === 'usage');
  assert.deepEqual(charges.map(row => row.amountUnits), ['-1', '-1', '-1']);
});

test('unbounded content, unsupported protocols, endpoint escapes and client billing fields are rejected', async t => {
  const f = await fixture(t);
  await f.credit();
  for (const data of [
    body({ tools: [{ type: 'web_search' }] }), body({ n: 2 }), body({ model: 'attacker' }),
    body({ messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://invalid.test' } }] }] }),
    body({ max_tokens: 101 }), body({ messages: [{ role: 'user', content: 'x'.repeat(5000) }] }),
    body({ input_tokens: 0 }), body({ stream_options: { include_usage: false } }),
  ]) assert.equal((await f.relay(crypto.randomUUID(), data)).status, 400);
  assert.equal((await f.request('/relay/chat/m/responses', { method: 'POST', key: 'path', data: body() })).status, 400);
  f.db.prepare("UPDATE channels SET protocol='unknown'").run();
  assert.equal((await f.relay()).status, 422);
  assert.equal(f.calls.length, 0);
});

test('adjustments are idempotent, audited, cannot overdraw reserved balance, and are user-isolated', async t => {
  const f = await fixture(t, (req, res) => res.json({ choices: [] }));
  f.db.prepare('UPDATE models SET max_input_tokens=128000').run();
  await f.credit(200000, 'u', 'fund');
  await f.credit(200000, 'u', 'fund');
  await f.relay('pending');
  const result = await f.request('/admin/users/u/adjustments', { user: 'admin', method: 'POST',
    data: { amountMicros: -100000, reason: 'External refund', requestId: 'refund' } });
  assert.equal(result.status, 402);
  assert.equal((await f.request('/wallet')).json.availableMicros, 71980);
  assert.equal((await f.request('/ledger', { user: 'v' })).json.ledger.length, 0);
  const ledger = (await f.request('/admin/ledger', { user: 'admin' })).json.ledger;
  assert.equal(ledger[0].actorId, 'admin');
  assert.equal(ledger[0].beforeUnits, '0');
  assert.equal(ledger[0].afterUnits, '200000000000');
});

const schema = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] };
const toolHistory = [
  { role: 'user', content: 'Read a local file' },
  { role: 'assistant', content: null, reasoning_content: 'Need a tool', tool_calls: [
    { id: 'tool-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } },
  ] },
  { role: 'tool', tool_call_id: 'tool-1', content: 'file text' },
];
const nativeRequests = {
  openai: { messages: toolHistory, tools: [{ type: 'function', function: { name: 'read_file', parameters: schema } }],
    tool_choice: 'auto', max_tokens: 10, reasoning_effort: 'low' },
  'openai-responses': { input: [
    { role: 'user', content: [{ type: 'input_text', text: 'Read a file' }] },
    { type: 'function_call', call_id: 'tool-1', name: 'read_file', arguments: '{"path":"a.txt"}' },
    { type: 'function_call_output', call_id: 'tool-1', output: 'file text' },
  ], tools: [{ type: 'function', name: 'read_file', parameters: schema, strict: false }],
  max_output_tokens: 10, store: false, reasoning: { effort: 'low' } },
  anthropic: { messages: [
    { role: 'user', content: [{ type: 'text', text: 'Read a file', cache_control: { type: 'ephemeral', ttl: '5m' } }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-1', name: 'read_file', input: { path: 'a.txt' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: [{ type: 'text', text: 'file text' }] }] },
  ], tools: [{ name: 'read_file', input_schema: schema }], max_tokens: 10, thinking: { type: 'disabled' } },
  google: { contents: [
    { role: 'user', parts: [{ text: 'Read a file' }] },
    { role: 'model', parts: [{ functionCall: { id: 'tool-1', name: 'read_file', args: { path: 'a.txt' } } }] },
    { role: 'user', parts: [{ functionResponse: { id: 'tool-1', name: 'read_file', response: { output: 'file text' } } }] },
  ], tools: [{ functionDeclarations: [{ name: 'read_file', parametersJsonSchema: schema }] }],
  generationConfig: { maxOutputTokens: 10, thinkingConfig: { thinkingBudget: 4, includeThoughts: true } } },
};
const nativePaths = {
  openai: 'v1/chat/completions', 'openai-responses': 'v1/responses',
  anthropic: 'v1/messages', google: 'v1beta/models/m:generateContent',
};
const nativeUsage = {
  openai: { choices: [], usage: usage() },
  'openai-responses': { status: 'completed', output: [], usage: {
    input_tokens: 20, output_tokens: 5, total_tokens: 25,
    input_tokens_details: { cached_tokens: 10 }, output_tokens_details: { reasoning_tokens: 2 },
  } },
  anthropic: { type: 'message', content: [], usage: {
    input_tokens: 5, output_tokens: 5, cache_read_input_tokens: 10, cache_creation_input_tokens: 5,
    cache_creation: { ephemeral_5m_input_tokens: 2, ephemeral_1h_input_tokens: 3 },
  } },
  google: { candidates: [{ content: { parts: [{ text: 'result' }] }, finishReason: 'STOP' }], usageMetadata: {
    promptTokenCount: 20, cachedContentTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 2, totalTokenCount: 25,
  } },
};

for (const protocol of Object.keys(nativeRequests)) {
  test(`${protocol} image-like schema and tool data remain ordinary text without image permission`, async t => {
    const f = await fixture(t, (_req, res) => res.json(nativeUsage[protocol]));
    f.db.prepare('UPDATE channels SET protocol=?,provider=?').run(protocol, 'configured-provider');
    f.db.prepare('UPDATE models SET upstream_model=?').run('configured-model');
    await f.credit();
    const data = structuredClone(nativeRequests[protocol]);
    const parameters = { type: 'object', properties: {
      inlineData: { type: 'string' }, image_url: { type: 'string' },
    }, default: { type: 'image', source: { type: 'url', url: 'https://example.test/data' } } };
    if (protocol === 'openai') data.tools[0].function.parameters = parameters;
    else if (protocol === 'openai-responses') data.tools[0].parameters = parameters;
    else if (protocol === 'anthropic') {
      data.tools[0].input_schema = parameters;
      data.messages[1].content[0].input = { inlineData: 'ordinary function argument' };
    } else {
      data.tools[0].functionDeclarations[0].parametersJsonSchema = parameters;
      data.contents[1].parts[0].functionCall.args = { inlineData: 'ordinary function argument' };
      data.contents[2].parts[0].functionResponse.response = { type: 'image', source: 'ordinary result data' };
    }
    const result = await f.request(`/relay/chat/m/${nativePaths[protocol]}`, {
      method: 'POST', key: 'image-like-data', data,
    });
    assert.equal(result.status, 200, result.text);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.calls[0].body.tools, data.tools);
    assert.equal((await f.request('/wallet')).json.availableMicros, 999970);
  });
}

test('schema image-like fields cannot bypass the configured text input bound on image-capable models', async t => {
  const f = await fixture(t);
  await f.credit();
  f.db.prepare("UPDATE models SET capabilities='[\"text\",\"image\",\"tools\"]'").run();
  const result = await f.relay('schema-bound', body({
    messages: [{ role: 'user', content: 'x'.repeat(5000) }],
    tools: [{ type: 'function', function: {
      name: 'inspect', parameters: { type: 'object', properties: { inlineData: { type: 'string' } } },
    } }],
  }));
  assert.equal(result.status, 400, result.text);
  assert.equal(result.json.code, 'INPUT_LIMIT');
  assert.equal(f.calls.length, 0);
});

for (const protocol of ['anthropic', 'google']) {
  test(`${protocol} nested tool-result images still require image permission`, async t => {
    const f = await fixture(t, (_req, res) => res.json(nativeUsage[protocol]));
    f.db.prepare('UPDATE channels SET protocol=?,provider=?').run(protocol, 'configured-provider');
    f.db.prepare('UPDATE models SET upstream_model=?').run('configured-model');
    await f.credit();
    const data = structuredClone(nativeRequests[protocol]);
    if (protocol === 'anthropic') {
      data.messages[2].content[0].content = [{
        type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
      }];
    } else data.contents[2].parts[0].functionResponse.parts = [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }];
    const request = key => f.request(`/relay/chat/m/${nativePaths[protocol]}`, { method: 'POST', key, data });
    assert.equal((await request('nested-denied')).status, 400);
    assert.equal(f.calls.length, 0);
    f.db.prepare("UPDATE models SET capabilities='[\"text\",\"image\",\"tools\"]'").run();
    assert.equal((await request('nested-allowed')).status, 200);
    assert.equal(f.calls.length, 1);
  });
}

for (const protocol of Object.keys(nativeUsage)) {
  test(`${protocol} image inputs retain native content and settle verified token usage`, async t => {
    const f = await fixture(t, (_req, res) => res.json(nativeUsage[protocol]));
    f.db.prepare('UPDATE channels SET protocol=?,provider=?').run(protocol, 'configured-provider');
    f.db.prepare('UPDATE models SET upstream_model=?,capabilities=?').run('configured-model', '["text","image","tools"]');
    if (protocol === 'google') f.db.prepare("UPDATE channels SET base_url=replace(base_url,'/v1','/v1beta')").run();
    await f.credit();
    const image = 'data:image/png;base64,aGVsbG8=';
    const requests = {
      openai: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe' }, { type: 'image_url', image_url: { url: image } }] }], max_tokens: 10 },
      'openai-responses': { input: [{ role: 'user', content: [{ type: 'input_image', image_url: image }] }], max_output_tokens: 10 },
      anthropic: { messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }] }], max_tokens: 10 },
      google: { contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }] }], generationConfig: { maxOutputTokens: 10 } },
    };
    const result = await f.request(`/relay/chat/m/${nativePaths[protocol]}`, { method: 'POST', key: 'image', data: requests[protocol] });
    assert.equal(result.status, 200, result.text);
    assert.equal((await f.request('/wallet')).json.availableMicros, 999970);
    f.db.prepare("UPDATE models SET capabilities='[\"text\"]'").run();
    assert.equal((await f.request(`/relay/chat/m/${nativePaths[protocol]}`, { method: 'POST', key: 'forbidden-image', data: requests[protocol] })).status, 400);
  });
}

for (const protocol of Object.keys(nativeRequests)) {
  test(`${protocol} native text tools relay using configured model/cap, headers, final usage and v1 path`, async t => {
    const f = await fixture(t, (req, res) => res.json(nativeUsage[protocol]));
    f.db.prepare('UPDATE channels SET protocol=?,provider=?').run(protocol, 'configured-provider');
    f.db.prepare('UPDATE models SET upstream_model=?').run('configured-model');
    if (protocol === 'google') f.db.prepare("UPDATE channels SET base_url=replace(base_url,'/v1','/v1beta')").run();
    await f.credit();
    const result = await f.request(`/relay/chat/m/${nativePaths[protocol]}`, {
      method: 'POST', key: 'native', data: nativeRequests[protocol],
    });
    assert.equal(result.status, 200, result.text);
    assert.deepEqual(result.json, nativeUsage[protocol]);
    assert.equal((await f.request('/wallet')).json.availableMicros, 999970);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].body.tools.length, 1);
    const call = (await f.request(`/billing/calls/${result.headers.get('x-billing-call-id')}`)).json.call;
    assert.equal(call.reservedMicros, 4116);
    assert.equal(call.status, 'completed');
    if (protocol === 'google') {
      assert.equal(f.calls[0].path, '/v1beta/models/configured-model:generateContent');
      assert.equal(f.calls[0].headers['x-goog-api-key'], 'key-secret');
    } else {
      assert.equal(f.calls[0].body.model, 'configured-model');
      assert.equal(f.calls[0].path, `/${nativePaths[protocol]}`);
      if (protocol === 'anthropic') {
        assert.equal(f.calls[0].headers['x-api-key'], 'key-secret');
        assert.equal(f.calls[0].headers['anthropic-version'], '2023-06-01');
      } else assert.equal(f.calls[0].headers.authorization, 'Bearer key-secret');
    }
    const catalog = (await f.request('/models')).json.models;
    assert.equal(catalog[0].relaySupported, true);
    assert.ok(!JSON.stringify(catalog).includes('key-secret'));
  });
}

const sse = value => `data: ${JSON.stringify(value)}\n\n`;
const nativeStreams = {
  'openai-responses': sse({ type: 'response.output_text.delta', delta: 'result' })
    + sse({ type: 'response.completed', response: nativeUsage['openai-responses'] }),
  anthropic: sse({ type: 'message_start', message: { usage: { ...nativeUsage.anthropic.usage, output_tokens: 1 } } })
    + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'result' } })
    + sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } })
    + sse({ type: 'message_stop' }),
  google: sse({ candidates: [{ content: { parts: [{ text: 're' }] } }], usageMetadata: {
    promptTokenCount: 20, candidatesTokenCount: 1, totalTokenCount: 21,
  } }) + sse(nativeUsage.google),
};
for (const protocol of Object.keys(nativeStreams)) {
  test(`${protocol} SSE usage settles native cumulative totals across frames exactly once`, async t => {
    const f = await fixture(t, (req, res) => {
      res.setHeader('content-type', 'text/event-stream');
      const bytes = Buffer.from(nativeStreams[protocol]);
      for (let i = 0; i < bytes.length; i += 11) res.write(bytes.subarray(i, i + 11));
      res.end();
    });
    f.db.prepare('UPDATE channels SET protocol=?,provider=?').run(protocol, 'configured-provider');
    f.db.prepare('UPDATE models SET upstream_model=?').run('configured-model');
    if (protocol === 'google') f.db.prepare("UPDATE channels SET base_url=replace(base_url,'/v1','/v1beta')").run();
    await f.credit();
    const suffix = nativePaths[protocol].replace(':generateContent', ':streamGenerateContent');
    const data = protocol === 'google' ? nativeRequests[protocol] : { ...nativeRequests[protocol], stream: true };
    const result = await f.request(`/relay/chat/m/${suffix}`, { method: 'POST', key: 'native-stream', data });
    assert.equal(result.status, 200, result.text);
    assert.equal(result.text, nativeStreams[protocol]);
    assert.equal((await f.request('/wallet')).json.availableMicros, 999970);
    if (protocol === 'google') assert.equal(f.calls[0].query.alt, 'sse');
  });
}

test('all protocols reject server-side paid tools, remote media, persisted context, and multipliers before forwarding', async t => {
  const f = await fixture(t);
  await f.credit();
  const invalid = {
    openai: [
      { tools: [{ type: 'web_search' }] }, { functions: [{ name: 'x', parameters: schema }], n: 2 },
      { messages: [{ role: 'tool', tool_call_id: 'x', content: [{ type: 'image_url', image_url: { url: 'https://invalid.test' } }] }] },
      { modalities: ['audio'] },
    ],
    'openai-responses': [
      { tools: [{ type: 'web_search_preview' }] }, { previous_response_id: 'stored' },
      { background: true }, { input: [{ type: 'item_reference', id: 'stored' }] },
    ],
    anthropic: [
      { tools: [{ type: 'web_search_20250305', name: 'web_search' }] },
      { messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'url', url: 'https://invalid.test' } }] }] },
      { mcp_servers: [{ url: 'https://invalid.test' }] },
    ],
    google: [
      { tools: [{ googleSearch: {} }] }, { cachedContent: 'server-stored' },
      { generationConfig: { candidateCount: 2 } },
      { contents: [{ role: 'user', parts: [{ inlineData: { data: 'blob', mimeType: 'audio/wav' } }] }] },
    ],
  };
  for (const [protocol, cases] of Object.entries(invalid)) {
    f.db.prepare('UPDATE channels SET protocol=?').run(protocol);
    for (const patch of cases) {
      const result = await f.request(`/relay/chat/m/${nativePaths[protocol]}`, {
        method: 'POST', key: crypto.randomUUID(), data: { ...nativeRequests[protocol], ...patch },
      });
      assert.equal(result.status, 400, `${protocol}: ${result.text}`);
    }
  }
  assert.equal(f.calls.length, 0);
});

test('over-bound actual usage never debits funds and remains held for explicit review', async t => {
  const f = await fixture(t, (req, res) => res.json({ usage: usage(4097, 5), choices: [] }));
  await f.credit(5000);
  const result = await f.relay('too-large');
  assert.equal(result.status, 200);
  const wallet = (await f.request('/wallet')).json;
  assert.equal(wallet.availableMicros, 884);
  assert.equal(wallet.heldMicros, 4116);
  const call = (await f.request(`/billing/calls/${result.headers.get('x-billing-call-id')}`)).json.call;
  assert.equal(call.status, 'pending');
  assert.equal(call.reason, 'usage_exceeds_bound');
  assert.equal(call.chargedMicros, 0);
  assert.equal((await f.request(`/admin/billing/calls/${call.id}/review`, { user: 'admin', method: 'POST',
    data: { action: 'settle', inputTokens: 4097, outputTokens: 5, reason: 'Verified', evidence: 'ticket', requestId: 'over' } })).status, 400);
  assert.equal((await f.request('/wallet')).json.heldMicros, 4116);
});

test('linked refunds restore original gift expiry and cannot exceed or repeat the actual charge', async t => {
  const f = await fixture(t);
  grantSignupGift(f.db, 'u', { giftEnabled: true, giftAmountMicros: 5000, giftExpiryDays: 1 });
  const result = await f.relay('gift-charge');
  assert.equal(result.status, 200);
  const callId = result.headers.get('x-billing-call-id');
  f.db.prepare("UPDATE billing_lots SET expires_at=? WHERE source='gift'").run(Date.now() - 1);
  const adjustment = { amountMicros: 30, reason: 'Correct provider charge', requestId: 'refund', callId };
  for (let i = 0; i < 2; i++) {
    const refund = await f.request('/admin/users/u/adjustments', { user: 'admin', method: 'POST', data: adjustment });
    assert.equal(refund.status, 200, refund.text);
  }
  const wallet = (await f.request('/wallet')).json;
  assert.equal(wallet.availableMicros, 0);
  assert.equal(wallet.expiredMicros, 5000);
  assert.equal((await f.request('/admin/users/u/adjustments', { user: 'admin', method: 'POST',
    data: { ...adjustment, requestId: 'refund-again' } })).status, 409);
  const call = (await f.request(`/billing/calls/${callId}`)).json.call;
  assert.equal(call.chargedMicros, 30);
});

test('disconnect continues draining final usage, settles cancellation, and releases concurrency', async t => {
  let finish;
  const f = await fixture(t, async (req, res) => {
    res.setHeader('content-type', 'text/event-stream');
    res.write(sse({ choices: [{ delta: { content: 'first' } }] }));
    await new Promise(resolve => { finish = resolve; });
    res.end(sse({ choices: [], usage: usage() }) + 'data: [DONE]\n\n');
  });
  await f.credit(5000);
  const controller = new AbortController();
  const response = await fetch(`${f.url}/api/platform/relay/chat/m/v1/chat/completions`, {
    method: 'POST', signal: controller.signal,
    headers: { authorization: 'Bearer u', 'content-type': 'application/json', 'Idempotency-Key': 'disconnect' },
    body: JSON.stringify(body({ stream: true })),
  });
  const callId = response.headers.get('x-billing-call-id');
  const reader = response.body.getReader();
  await reader.read();
  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 30));
  finish();
  let call;
  for (let i = 0; i < 50; i++) {
    call = (await f.request(`/billing/calls/${callId}`)).json.call;
    if (call.status !== 'active') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(call.status, 'cancelled');
  assert.equal(call.chargedMicros, 30);
  assert.equal((await f.request('/wallet')).json.heldMicros, 0);
});

test('stale request recovery keeps holds, releases concurrency, accepts precise review once', async t => {
  const f = await fixture(t, (req, res) => res.json({ choices: [] }));
  await f.credit(10000);
  const result = await f.relay('stale');
  const callId = result.headers.get('x-billing-call-id');
  f.db.prepare("UPDATE billing_calls SET status='active',active_until=? WHERE id=?").run(Date.now() - 1, callId);
  initBilling(f.db);
  const pending = (await f.request('/admin/billing/pending', { user: 'admin' })).json.calls;
  assert.equal(pending[0].reason, 'lease_expired');
  assert.equal((await f.request('/wallet')).json.heldMicros, 4116);
  assert.equal((await f.relay('after-recovery')).status, 200);
  const review = { action: 'settle', inputTokens: 20, outputTokens: 5, reason: 'Verified provider totals',
    evidence: 'usage-record-123', requestId: 'resolve' };
  for (let i = 0; i < 2; i++) assert.equal((await f.request(`/admin/billing/calls/${callId}/review`, {
    user: 'admin', method: 'POST', data: review,
  })).status, 200);
  assert.equal((await f.request('/wallet')).json.availableMicros, 5854);
  assert.equal((await f.request('/ledger')).json.ledger.filter(entry => entry.kind === 'usage').length, 1);
});

test('malformed, contradictory, or missing final usage on every protocol retains funds for review', async t => {
  for (const protocol of Object.keys(nativeRequests)) {
    const payload = structuredClone(nativeUsage[protocol]);
    if (protocol === 'google') payload.usageMetadata.totalTokenCount = 23;
    else if (protocol === 'anthropic') payload.usage.cache_creation.ephemeral_1h_input_tokens = 5;
    else payload.usage.total_tokens = 24;
    const f = await fixture(t, (req, res) => res.json(payload));
    f.db.prepare('UPDATE channels SET protocol=?').run(protocol);
    await f.credit(10000);
    const result = await f.request(`/relay/chat/m/${nativePaths[protocol]}`, {
      method: 'POST', key: 'invalid-usage', data: nativeRequests[protocol],
    });
    assert.equal(result.status, 200, result.text);
    const call = (await f.request(`/billing/calls/${result.headers.get('x-billing-call-id')}`)).json.call;
    assert.equal(call.status, 'pending', protocol);
    assert.equal(call.chargedMicros, 0);
  }
});

test('all configured catalog protocols remain visible with truthful support markers', async t => {
  const f = await fixture(t);
  for (const protocol of [...Object.keys(nativeRequests), 'unsupported']) {
    f.db.prepare('UPDATE channels SET protocol=?').run(protocol);
    const model = (await f.request('/models')).json.models[0];
    assert.equal(model.protocol, protocol);
    assert.equal(model.relaySupported, protocol !== 'unsupported');
    assert.deepEqual(model.relayCapabilities, protocol === 'unsupported' ? [] : ['text', 'tools', 'streaming']);
  }
});

test('integer boundary prices remain exact beyond floating-point multiplication range', async t => {
  const f = await fixture(t);
  f.db.prepare('UPDATE models SET input_price_micros=?,output_price_micros=?')
    .run(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  await f.credit(Number.MAX_SAFE_INTEGER);
  assert.equal((await f.relay()).status, 200);
  assert.equal((await f.request('/wallet')).json.availableUnits, '9006974074759622475225');
  const entries = (await f.request('/ledger')).json.ledger;
  assert.equal(entries.find(entry => entry.kind === 'usage').amountUnits, '-225179981368524775');
});

test('settlement spends gift before permanent money and releases each original funding source', async t => {
  const f = await fixture(t);
  grantSignupGift(f.db, 'u', { giftEnabled: true, giftAmountMicros: 20, giftExpiryDays: 1 });
  await f.credit(10000);
  const result = await f.relay('mixed');
  assert.equal(result.status, 200);
  const wallet = (await f.request('/wallet')).json;
  assert.equal(wallet.giftMicros, 0);
  assert.equal(wallet.adjustmentMicros, 9990);
  assert.equal(wallet.heldMicros, 0);
  const allocations = f.db.prepare(`SELECT l.source,a.charged_units FROM billing_allocations a
    JOIN billing_lots l ON l.id=a.lot_id WHERE a.call_id=? ORDER BY a.position`)
    .all(result.headers.get('x-billing-call-id'));
  assert.deepEqual(allocations, [{ source: 'gift', charged_units: '20000000' }, { source: 'adjustment', charged_units: '10000000' }]);
});

test('truncated streams cannot turn interim usage into a final charge', async t => {
  const partial = {
    openai: sse({ choices: [], usage: usage() }),
    'openai-responses': sse({ type: 'response.created', response: nativeUsage['openai-responses'] }),
    anthropic: sse({ type: 'message_start', message: nativeUsage.anthropic }),
    google: sse({ usageMetadata: nativeUsage.google.usageMetadata, candidates: [{ content: { parts: [{ text: 'partial' }] } }] }),
  };
  for (const protocol of Object.keys(partial)) {
    const f = await fixture(t, (req, res) => res.type('text/event-stream').end(partial[protocol]));
    f.db.prepare('UPDATE channels SET protocol=?').run(protocol);
    await f.credit(5000);
    const path = nativePaths[protocol].replace(':generateContent', ':streamGenerateContent');
    const result = await f.request(`/relay/chat/m/${path}`, {
      method: 'POST', key: 'truncated',
      data: protocol === 'google' ? nativeRequests[protocol] : { ...nativeRequests[protocol], stream: true },
    });
    assert.equal(result.status, 200);
    const call = (await f.request(`/billing/calls/${result.headers.get('x-billing-call-id')}`)).json.call;
    assert.equal(call.status, 'pending', protocol);
    assert.equal(call.chargedMicros, 0);
    assert.equal((await f.request('/wallet')).json.heldMicros, 4116);
  }
});

test('upstream errors are redacted, never retried, and do not occupy active concurrency', async t => {
  const f = await fixture(t, (req, res) => res.status(429).json({ error: 'key-secret hello private prompt' }));
  await f.credit(10000);
  const result = await f.relay('upstream-error');
  assert.equal(result.status, 502);
  assert.ok(!result.text.includes('key-secret'));
  assert.ok(!result.text.includes('private prompt'));
  assert.equal(f.calls.length, 1);
  assert.equal((await f.relay('upstream-error')).status, 409);
  assert.equal((await f.relay('next-error')).status, 502);
  assert.equal(f.calls.length, 2);
  const serialized = JSON.stringify(f.db.prepare('SELECT * FROM billing_calls').all());
  assert.ok(!serialized.includes('hello'));
  assert.ok(!serialized.includes('key-secret'));
});

test('code generation is idempotent, exported pages are complete, failed redemption is rate limited', async t => {
  const f = await fixture(t);
  const data = { count: 3, amountMicros: 100, requestId: 'export-batch' };
  const first = await f.request('/admin/codes', { user: 'admin', method: 'POST', data });
  const again = await f.request('/admin/codes', { user: 'admin', method: 'POST', data });
  assert.deepEqual(again.json, first.json);
  const page1 = await f.request('/admin/codes?batchId=export-batch&export=true&limit=2', { user: 'admin' });
  const page2 = await f.request('/admin/codes?batchId=export-batch&export=true&limit=2&offset=2', { user: 'admin' });
  assert.equal(new Set([...page1.json.codes, ...page2.json.codes].map(row => row.code)).size, 3);
  assert.equal((await f.request('/admin/codes?batchId=export-batch', { user: 'admin' })).json.codes[0].code, undefined);
  for (let i = 0; i < 20; i++) assert.equal((await f.request('/redeem', {
    method: 'POST', data: { code: `invalid-${i}` },
  })).status, 409);
  assert.equal((await f.request('/redeem', { method: 'POST', data: { code: first.json.codes[0].code } })).status, 429);
  assert.equal((await f.request('/wallet')).json.availableMicros, 0);
});

test('existing provider catalog URL prefixes and keyless Ollama retain native routing and output caps', async t => {
  const cases = [
    ['openai', 'openai', '/v1', '/v1/chat/completions'],
    ['openai-responses', 'openai-responses', '/v1', '/v1/responses'],
    ['anthropic', 'anthropic', '/', '/v1/messages'],
    ['anthropic-proxy', 'anthropic', '/anthropic', '/anthropic/v1/messages'],
    ['google', 'google', '/', '/v1beta/models/configured-model:generateContent'],
    ['dashscope', 'openai', '/compatible-mode/v1', '/compatible-mode/v1/chat/completions'],
    ['deepseek', 'openai', '/v1', '/v1/chat/completions'],
    ['openrouter', 'openai', '/api/v1', '/api/v1/chat/completions'],
    ['minimax', 'openai', '/v1', '/v1/chat/completions'],
    ['moonshot', 'openai', '/v1', '/v1/chat/completions'],
    ['volc_ark', 'openai', '/api/v3', '/api/v3/chat/completions'],
    ['zhipu', 'openai', '/api/paas/v4', '/api/paas/v4/chat/completions'],
    ['ollama', 'openai', '/v1', '/v1/chat/completions'],
  ];
  for (const [provider, protocol, basePath, expectedPath] of cases) {
    const f = await fixture(t, (req, res) => res.json(nativeUsage[protocol]));
    const base = new URL(f.db.prepare('SELECT base_url FROM channels').get().base_url);
    base.pathname = basePath;
    f.db.prepare('UPDATE channels SET provider=?,protocol=?,base_url=?,secret=?')
      .run(provider, protocol, base.href, provider === 'ollama' ? 'sealed:' : 'sealed:key-secret');
    f.db.prepare('UPDATE models SET upstream_model=?').run('configured-model');
    await f.credit();
    const result = await f.request(`/relay/chat/m/${nativePaths[protocol]}`, {
      method: 'POST', key: 'catalog-provider', data: nativeRequests[protocol],
    });
    assert.equal(result.status, 200, `${provider}: ${result.text}`);
    assert.equal(f.calls[0].path, expectedPath, provider);
    if (provider === 'ollama') assert.equal(f.calls[0].headers.authorization, undefined);
    if (provider === 'openai') {
      assert.equal(f.calls[0].body.max_completion_tokens, 10);
      assert.equal(f.calls[0].body.max_tokens, undefined);
    } else if (protocol === 'openai') assert.equal(f.calls[0].body.max_tokens, 10);
  }
});
