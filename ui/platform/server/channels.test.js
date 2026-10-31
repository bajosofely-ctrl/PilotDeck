import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import Database from 'better-sqlite3';
import { createPlatformApp } from './app.js';
import { initChannels, initSchema, MAX_APP_MODELS } from './schema.js';
import { initBilling } from './billing.js';

const password = 'Channel-fixture-password-123!';

test('application settings remain editable after importing more than 100 assigned models', async t => {
  const f = await fixture(t);
  await f.api('/admin/channels', 'POST', channelBody());
  await f.api('/admin/models', 'POST', modelBody({ appIds: ['chat'] }));
  const rows = Array.from({ length: 100 }, (_, index) => {
    const { channelId, ...row } = modelBody({ id: `batch-${index}`, upstreamModel: `batch-${index}`, appIds: ['chat'] });
    return row;
  });
  assert.equal((await f.api('/admin/channels/channel-a/import', 'POST', { models: rows })).status, 201);
  const app = (await f.api('/admin/apps')).data.apps.find(item => item.id === 'chat');
  assert.equal(app.modelIds.length, 101);
  assert.equal((await f.api('/admin/apps', 'PUT', { apps: [{ ...app, enabled: false }] })).status, 200);
  const saved = (await f.api('/admin/apps')).data.apps.find(item => item.id === 'chat');
  assert.equal(saved.enabled, false);
  assert.deepEqual(saved.modelIds, app.modelIds);
  const ids = Array.from({ length: MAX_APP_MODELS }, (_, index) => `existing-${index}`);
  f.db.prepare("UPDATE apps SET model_ids=? WHERE id='chat'").run(JSON.stringify(ids));
  const rejected = await f.api('/admin/models', 'POST', modelBody({ id: 'over-limit', upstreamModel: 'over-limit', appIds: ['chat'] }));
  assert.equal(rejected.status, 400);
  assert.equal(rejected.data.code, 'APP_MODEL_LIMIT');
  assert.equal(f.db.prepare("SELECT id FROM models WHERE id='over-limit'").get(), undefined);
  assert.equal((await f.api('/admin/apps', 'PUT', { apps: [{ ...app, modelIds: [...ids, 'over-limit'] }] })).status, 400);
});

test('Google model aliases are deduplicated without altering legacy names, prices or apps', async t => {
  const f = await fixture(t);
  await f.api('/admin/channels', 'POST', channelBody({ protocol: 'google' }));
  assert.equal((await f.api('/admin/models', 'POST', modelBody({ upstreamModel: 'models/gemini-x', appIds: ['chat'] }))).status, 201);
  const { channelId, ...alias } = modelBody({ id: 'alias', upstreamModel: 'gemini-x', inputPriceMicros: 999, appIds: [] });
  const imported = await f.api('/admin/channels/channel-a/import', 'POST', { models: [alias] });
  assert.equal(imported.status, 201);
  assert.equal(imported.data.models.length, 0);
  assert.equal(imported.data.skipped[0].existingModelId, 'model-a');
  assert.equal((await f.api('/admin/models', 'POST', { ...alias, channelId: 'channel-a' })).status, 409);
  const model = (await f.api('/admin/models')).data.models[0];
  assert.equal(model.upstreamModel, 'models/gemini-x');
  assert.equal(model.inputPriceMicros, 1000000);
  assert.deepEqual(model.appIds, ['chat']);
  await f.api('/admin/channels', 'POST', channelBody({ id: 'other-channel', protocol: 'openai' }));
  for (const [id, upstreamModel] of [['one', 'gemini-y'], ['two', 'models/gemini-y']]) {
    assert.equal((await f.api('/admin/models', 'POST', modelBody({ id, channelId: 'other-channel', upstreamModel }))).status, 201);
  }
  assert.equal((await f.api('/admin/channels/other-channel', 'PATCH', { protocol: 'google', apiKey: 'explicit-fixture-key' })).status, 409);
  assert.equal((await f.api('/admin/channels')).data.channels.find(item => item.id === 'other-channel').protocol, 'openai');
});

const channelBody = (extra = {}) => ({
  id: 'channel-a', name: 'Fixture channel', provider: 'fixture', protocol: 'openai',
  baseUrl: 'https://first.example.test/v1', apiKey: 'fixture-key-one', enabled: true, ...extra,
});
const modelBody = (extra = {}) => ({
  id: 'model-a', channelId: 'channel-a', name: 'Fixture model', upstreamModel: 'upstream-a',
  inputPriceMicros: 1000000, outputPriceMicros: 2000000,
  maxInputTokens: 8192, maxOutputTokens: 1024, capabilities: ['text'], ...extra,
});

async function fixture(t) {
  const outbound = [];
  let response = () => Response.json({ data: [{ id: 'upstream-a' }, { id: 'upstream-b' }] });
  const platform = await createPlatformApp({
    dbPath: ':memory:', encryptionKey: 'channel-fixture-encryption-key-123456',
    bootstrapAdmin: { email: 'admin@example.test', password },
    fetchImpl: async (url, options) => { outbound.push({ url, options }); return response(); },
  });
  const server = platform.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    platform.close();
  });
  let admin;
  const api = async (path, method = 'GET', body, token = admin) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/platform${path}`, {
      method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, data: await res.json() };
  };
  admin = (await api('/auth/login', 'POST', { email: 'admin@example.test', password, deviceId: 'admin' }, null)).data.token;
  const user = (await api('/admin/users', 'POST', { email: 'customer@example.test', password })).data.user;
  const customer = (await api('/auth/login', 'POST', { email: user.email, password, deviceId: 'customer' }, null)).data.token;
  return { ...platform, api, customer, user, outbound, respond: fn => { response = fn; } };
}

function legacyDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE models (id TEXT PRIMARY KEY, name TEXT, provider TEXT, protocol TEXT, base_url TEXT,
      upstream_model TEXT, secret TEXT, enabled INTEGER, input_price_micros INTEGER, output_price_micros INTEGER,
      max_input_tokens INTEGER, max_output_tokens INTEGER, capabilities TEXT);
    CREATE TABLE apps (id TEXT PRIMARY KEY, default_model_id TEXT REFERENCES models(id), model_ids TEXT);
    CREATE TABLE billing_calls (id TEXT PRIMARY KEY, model_id TEXT REFERENCES models(id), amount TEXT);
    INSERT INTO models VALUES ('m1','First','fixture','openai','https://same.test','remote','encrypted-1',1,123,456,8192,1024,'["text"]'),
      ('m2','Second','fixture','openai','https://same.test','remote','encrypted-2',0,321,654,4096,512,'["text","image"]');
    INSERT INTO apps VALUES ('chat','m1','["m1","m2"]');
    INSERT INTO billing_calls VALUES ('call','m1','314159');
  `);
  return db;
}

test('channel migration is transactional, repeatable and preserves distinct encrypted connections and history', () => {
  const db = legacyDatabase();
  try {
    const models = db.prepare('SELECT * FROM models ORDER BY id').all();
    const apps = db.prepare('SELECT * FROM apps').all();
    const billing = db.prepare('SELECT * FROM billing_calls').all();
    initChannels(db);
    const channels = db.prepare('SELECT * FROM channels ORDER BY id').all();
    assert.equal(channels.length, 2);
    assert.deepEqual(channels.map(c => c.secret).sort(), ['encrypted-1', 'encrypted-2']);
    for (const old of models) {
      const row = db.prepare('SELECT * FROM models WHERE id=?').get(old.id);
      const connection = db.prepare('SELECT * FROM channels WHERE id=?').get(row.channel_id);
      assert.equal(connection.secret, old.secret);
      assert.equal(connection.base_url, old.base_url);
      assert.equal(row.secret, '');
      assert.equal(row.base_url, '');
      for (const field of ['id', 'name', 'enabled', 'upstream_model', 'input_price_micros', 'output_price_micros',
        'max_input_tokens', 'max_output_tokens', 'capabilities']) assert.deepEqual(row[field], old[field]);
    }
    initChannels(db);
    assert.deepEqual(db.prepare('SELECT * FROM channels ORDER BY id').all(), channels);
    assert.deepEqual(db.prepare('SELECT * FROM apps').all(), apps);
    assert.deepEqual(db.prepare('SELECT * FROM billing_calls').all(), billing);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally { db.close(); }
});

test('failed migration rolls back DDL, channel inserts and model changes together', () => {
  const db = legacyDatabase();
  try {
    db.exec("CREATE TRIGGER reject_migration BEFORE UPDATE ON models WHEN OLD.id='m2' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    assert.throws(() => initChannels(db), /fixture failure/);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='channels'").get(), undefined);
    assert.equal(db.pragma('table_info(models)').some(c => c.name === 'channel_id'), false);
    assert.equal(db.prepare("SELECT secret FROM models WHERE id='m1'").get().secret, 'encrypted-1');
    db.exec('DROP TRIGGER reject_migration');
    initChannels(db);
    assert.equal(db.prepare('SELECT count(*) n FROM channels').get().n, 2);
  } finally { db.close(); }
});

test('native platform migration preserves encrypted credentials, all account tables and settled billing exactly', async t => {
  const f = await fixture(t);
  await f.api('/admin/channels', 'POST', channelBody());
  await f.api('/admin/models', 'POST', modelBody({ enabled: true, appIds: ['chat', 'automation'] }));
  await f.api('/admin/channels', 'POST', channelBody({ id: 'channel-b', apiKey: 'second-fixture-key' }));
  await f.api('/admin/models', 'POST', modelBody({ id: 'model-b', channelId: 'channel-b', inputPriceMicros: 123, appIds: ['chat'] }));
  f.db.prepare("UPDATE apps SET default_model_id='model-a' WHERE id='chat'").run();
  await f.api(`/admin/users/${f.user.id}/adjustments`, 'POST', { amountMicros: 1000000, reason: 'Fixture', requestId: crypto.randomUUID() });
  f.respond(() => Response.json({ choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22 } }));
  assert.equal((await f.api('/relay/chat/model-a/chat/completions', 'POST',
    { messages: [{ role: 'user', content: 'Fixture' }], max_tokens: 10 }, f.customer)).status, 200);
  const balance = (await f.api('/wallet', 'GET', undefined, f.customer)).data;
  assert.equal(balance.availableMicros, 999976);
  assert.equal(f.db.prepare('SELECT status FROM billing_calls').get().status, 'completed');
  // Recreate the exact pre-channel layout from isolated, API-populated native SQLite tables.
  f.db.transaction(() => {
    f.db.exec(`
      DROP TRIGGER models_channel_required_insert;
      DROP TRIGGER models_channel_required_update;
      DROP INDEX models_channel_upstream;
      UPDATE models SET provider=(SELECT provider FROM channels WHERE id=models.channel_id),
        protocol=(SELECT protocol FROM channels WHERE id=models.channel_id),
        base_url=(SELECT base_url FROM channels WHERE id=models.channel_id),
        secret=(SELECT secret FROM channels WHERE id=models.channel_id);
      ALTER TABLE models DROP COLUMN channel_id;
      DROP TABLE channels;
    `);
  })();
  const legacy = f.db.prepare('SELECT * FROM models ORDER BY id').all();
  const unchangedTables = f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('models','channels') ORDER BY name")
    .all().map(row => row.name);
  const snapshot = () => Object.fromEntries(unchangedTables.map(name => [name, f.db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
  const before = snapshot();
  initSchema(f.db);
  initBilling(f.db);
  assert.deepEqual(snapshot(), before);
  for (const old of legacy) {
    const { channel_id, provider, protocol, base_url, secret, ...row } = f.db.prepare('SELECT * FROM models WHERE id=?').get(old.id);
    const { provider: oldProvider, protocol: oldProtocol, base_url: oldUrl, secret: oldSecret, ...oldRow } = old;
    assert.deepEqual(row, oldRow);
    assert.deepEqual({ provider, protocol, base_url, secret }, { provider: '', protocol: 'openai', base_url: '', secret: '' });
    const channel = f.db.prepare('SELECT * FROM channels WHERE id=?').get(channel_id);
    assert.deepEqual([channel.provider, channel.protocol, channel.base_url, channel.secret, channel.enabled],
      [oldProvider, oldProtocol, oldUrl, oldSecret, 1]);
  }
  const channels = f.db.prepare('SELECT * FROM channels ORDER BY id').all();
  assert.equal(channels.length, 2);
  assert.notEqual(channels[0].secret, channels[1].secret);
  initSchema(f.db);
  initBilling(f.db);
  assert.deepEqual(f.db.prepare('SELECT * FROM channels ORDER BY id').all(), channels);
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(f.db.pragma('foreign_key_check'), []);
  assert.equal(f.db.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual((await f.api('/wallet', 'GET', undefined, f.customer)).data, balance);
  const catalog = (await f.api('/models?appId=chat', 'GET', undefined, f.customer)).data;
  assert.equal(catalog.defaultModelId, 'model-a');
  assert.deepEqual(catalog.models.map(model => model.id), ['model-a']);
  f.respond(() => Response.json({ data: [{ id: 'upstream-a' }] }));
  for (const old of legacy) {
    const { channel_id } = f.db.prepare('SELECT channel_id FROM models WHERE id=?').get(old.id);
    assert.equal((await f.api(`/admin/channels/${channel_id}/discover`, 'POST', {})).status, 200);
    assert.equal(f.outbound.at(-1).options.headers.Authorization,
      old.id === 'model-a' ? 'Bearer fixture-key-one' : 'Bearer second-fixture-key');
  }
});

test('new channels default disabled even with a key and require explicit opt-in', async t => {
  const f = await fixture(t);
  const created = await f.api('/admin/channels', 'POST', channelBody({ enabled: undefined }));
  assert.equal(created.status, 201);
  assert.equal(created.data.channel.enabled, false);
  await f.api('/admin/models', 'POST', modelBody({ enabled: true, appIds: ['chat'] }));
  assert.deepEqual((await f.api('/models?appId=chat', 'GET', undefined, f.customer)).data.models, []);
  assert.equal((await f.api('/relay/chat/model-a/chat/completions', 'POST',
    { messages: [{ role: 'user', content: 'Fixture' }], max_tokens: 10 }, f.customer)).status, 403);
  assert.equal(f.outbound.length, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM billing_calls').get().n, 0);
  await f.api('/admin/channels/channel-a', 'PATCH', { enabled: true });
  assert.equal((await f.api('/models?appId=chat', 'GET', undefined, f.customer)).data.models.length, 1);
  const draft = await f.api('/admin/channels', 'POST', channelBody({ id: 'draft', enabled: undefined, apiKey: undefined }));
  assert.equal(draft.status, 201);
  assert.equal(draft.data.channel.enabled, false);
});

test('channel CRUD protects credentials, endpoint changes and in-use deletion', async t => {
  const f = await fixture(t);
  for (const token of [null, f.customer]) {
    assert.equal((await f.api('/admin/channels', 'GET', undefined, token)).status, token ? 403 : 401);
    assert.equal((await f.api('/admin/channels', 'POST', channelBody(), token)).status, token ? 403 : 401);
  }
  const created = await f.api('/admin/channels', 'POST', channelBody());
  assert.equal(created.status, 201);
  assert.equal(created.data.channel.hasApiKey, true);
  assert.equal(created.data.channel.modelCount, 0);
  assert.ok(!JSON.stringify(created.data).includes('fixture-key-one'));
  const secret = f.db.prepare('SELECT secret FROM channels').get().secret;
  assert.ok(secret && !secret.includes('fixture-key-one'));
  for (const apiKey of [undefined, '', '  ']) {
    assert.equal((await f.api('/admin/channels/channel-a', 'PATCH', { name: 'Renamed', apiKey })).status, 200);
    assert.equal(f.db.prepare('SELECT secret FROM channels').get().secret, secret);
    assert.equal((await f.api('/admin/channels/channel-a', 'PATCH', { baseUrl: 'https://second.test', apiKey })).status, 400);
    assert.equal((await f.api('/admin/channels/channel-a', 'PATCH', { protocol: 'google', apiKey })).status, 400);
  }
  assert.equal((await f.api('/admin/channels/channel-a', 'PATCH', { baseUrl: 'https://second.test', apiKey: 'replacement' })).status, 200);
  assert.equal((await f.api('/admin/channels', 'POST', channelBody())).status, 409);
  assert.equal((await f.api('/admin/models', 'POST', modelBody())).status, 201);
  assert.equal((await f.api('/admin/channels', 'GET')).data.channels[0].modelCount, 1);
  assert.equal((await f.api('/admin/channels/channel-a', 'DELETE')).status, 409);
  const spare = await f.api('/admin/channels', 'POST', channelBody({ id: 'spare', apiKey: '', enabled: false }));
  assert.equal(spare.status, 201);
  assert.equal((await f.api('/admin/channels/spare', 'DELETE')).status, 200);
  assert.equal((await f.api('/admin/channels/spare', 'DELETE')).status, 404);
});

test('channel discovery/test use only GET and return sanitized failures without records or billing', async t => {
  const f = await fixture(t);
  await f.api('/admin/channels', 'POST', channelBody());
  for (const action of ['discover', 'test', 'import']) {
    for (const token of [null, f.customer]) {
      assert.equal((await f.api(`/admin/channels/channel-a/${action}`, 'POST', {}, token)).status, token ? 403 : 401);
    }
  }
  assert.equal((await f.api('/admin/channels/channel-a', 'PATCH', { enabled: false }, f.customer)).status, 403);
  assert.equal((await f.api('/admin/channels/channel-a', 'DELETE', undefined, f.customer)).status, 403);
  const discovered = await f.api('/admin/channels/channel-a/discover', 'POST', {});
  assert.equal(discovered.status, 200);
  assert.deepEqual(discovered.data, { models: [{ id: 'upstream-a', name: 'upstream-a' }, { id: 'upstream-b', name: 'upstream-b' }], truncated: false });
  assert.deepEqual((await f.api('/admin/channels/channel-a/test', 'POST', {})).data, { ok: true, modelCount: 2 });
  assert.ok(f.outbound.every(call => call.options.method === 'GET' && call.options.headers.Authorization === 'Bearer fixture-key-one'));
  f.respond(() => Response.json({ error: 'fixture-key-one' }, { status: 401 }));
  const failed = await f.api('/admin/channels/channel-a/test', 'POST', {});
  assert.equal(failed.status, 502);
  assert.ok(!JSON.stringify(failed.data).includes('fixture-key-one'));
  assert.equal(f.db.prepare('SELECT count(*) n FROM models').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM billing_calls').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM billing_ledger').get().n, 0);
});

test('manual model saves assign apps atomically, preserve omissions and clear only removed defaults', async t => {
  const f = await fixture(t);
  await f.api('/admin/channels', 'POST', channelBody());
  const created = await f.api('/admin/models', 'POST', modelBody({ appIds: ['chat', 'automation'] }));
  assert.equal(created.status, 201);
  assert.equal(created.data.model.enabled, false);
  assert.equal(created.data.model.channelName, 'Fixture channel');
  assert.deepEqual(created.data.model.appIds, ['chat', 'automation']);
  assert.equal(created.data.model.channelEnabled, true);
  assert.equal(f.db.prepare("SELECT default_model_id FROM apps WHERE id='chat'").get().default_model_id, null);
  f.db.prepare("UPDATE apps SET default_model_id='model-a' WHERE id IN ('chat','automation')").run();
  assert.equal((await f.api('/admin/models/model-a', 'PATCH', { name: 'New name' })).status, 200);
  assert.deepEqual((await f.api('/admin/models')).data.models[0].appIds, ['chat', 'automation']);
  assert.equal((await f.api('/admin/models/model-a', 'PATCH', { appIds: ['automation'], enabled: true })).status, 200);
  const apps = (await f.api('/admin/apps')).data.apps;
  assert.equal(apps.find(a => a.id === 'chat').defaultModelId, null);
  assert.equal(apps.find(a => a.id === 'automation').defaultModelId, 'model-a');
  assert.equal((await f.api('/admin/models/model-a', 'PATCH', { name: 'Rejected', appIds: ['missing'] })).status, 400);
  assert.equal((await f.api('/admin/models')).data.models[0].name, 'New name');
  assert.equal((await f.api('/admin/models/model-a', 'PATCH', { apiKey: 'wrong-place' })).status, 400);
  assert.equal((await f.api('/admin/models/model-a', 'PATCH', { channelId: null })).status, 400);
  assert.equal((await f.api('/admin/models', 'POST', modelBody({ id: 'no-price', inputPriceMicros: undefined }))).status, 400);
  assert.equal((await f.api('/admin/models', 'POST', modelBody({ id: 'no-channel', channelId: 'missing' }))).status, 404);
  assert.equal((await f.api('/admin/models', 'POST', modelBody({ id: 'zero', upstreamModel: 'free', inputPriceMicros: 0, outputPriceMicros: 0 }))).status, 201);
});

test('batch import validates every row before writes, skips existing pairs and never overwrites IDs', async t => {
  const f = await fixture(t);
  await f.api('/admin/channels', 'POST', channelBody());
  await f.api('/admin/models', 'POST', modelBody({ enabled: true, appIds: ['chat'] }));
  const row = extra => { const { channelId, ...value } = modelBody(extra); return value; };
  const importRows = models => f.api('/admin/channels/channel-a/import', 'POST', { models });
  const failed = await importRows([row({ id: 'new', upstreamModel: 'new', appIds: ['automation'] }),
    row({ id: 'bad', upstreamModel: 'bad', inputPriceMicros: -1 })]);
  assert.equal(failed.status, 400);
  assert.equal(f.db.prepare('SELECT count(*) n FROM models').get().n, 1);
  assert.equal(f.db.prepare("SELECT model_ids FROM apps WHERE id='automation'").get().model_ids, '[]');
  assert.equal((await importRows([row({ inputPriceMicros: -1 })])).status, 400);
  assert.equal((await importRows([row({ id: 'new', upstreamModel: 'new' }), row({ upstreamModel: 'different' })])).status, 409);
  assert.equal(f.db.prepare('SELECT count(*) n FROM models').get().n, 1);
  const result = await importRows([
    row({ id: 'ignored', inputPriceMicros: 999, appIds: [] }),
    row({ id: 'new', upstreamModel: 'new', appIds: ['automation'] }),
    row({ id: 'same-pair', upstreamModel: 'new', inputPriceMicros: 999 }),
  ]);
  assert.equal(result.status, 201);
  assert.equal(result.data.models.length, 1);
  assert.equal(result.data.models[0].enabled, false);
  assert.equal(result.data.skipped.length, 2);
  assert.equal(f.db.prepare("SELECT input_price_micros FROM models WHERE id='model-a'").get().input_price_micros, 1000000);
  assert.deepEqual((await f.api('/admin/models')).data.models.find(m => m.id === 'model-a').appIds, ['chat']);
  const retry = await importRows([row({ id: 'new', upstreamModel: 'new' })]);
  assert.equal(retry.data.models.length, 0);
  assert.equal(retry.data.skipped.length, 1);
  assert.equal((await importRows([row({ id: 'dup', upstreamModel: 'd1' }), row({ id: 'dup', upstreamModel: 'd2' })])).status, 409);
  assert.equal(f.db.prepare("SELECT id FROM models WHERE id='dup'").get(), undefined);
});

test('imports accept at most 100 rows and reject oversized batches before any write', async t => {
  const f = await fixture(t);
  await f.api('/admin/channels', 'POST', channelBody());
  const models = Array.from({ length: 101 }, (_, index) => {
    const { channelId, ...row } = modelBody({ id: `model-${index}`, upstreamModel: `upstream-${index}` });
    return row;
  });
  assert.equal((await f.api('/admin/channels/channel-a/import', 'POST', { models })).status, 400);
  assert.equal(f.db.prepare('SELECT count(*) n FROM models').get().n, 0);
  const result = await f.api('/admin/channels/channel-a/import', 'POST', { models: models.slice(0, 100) });
  assert.equal(result.status, 201);
  assert.equal(result.data.models.length, 100);
  assert.deepEqual(result.data.skipped, []);
  assert.ok(result.data.models.every(model => model.enabled === false));
});

test('write failures roll back model edits, app defaults, import rows and audit entries together', async t => {
  const f = await fixture(t);
  await f.api('/admin/channels', 'POST', channelBody());
  await f.api('/admin/models', 'POST', modelBody({ appIds: ['chat'] }));
  f.db.prepare("UPDATE apps SET default_model_id='model-a' WHERE id='chat'").run();
  const before = {
    models: f.db.prepare('SELECT * FROM models').all(),
    apps: f.db.prepare('SELECT * FROM apps').all(),
    audit: f.db.prepare('SELECT * FROM audit_log').all(),
  };
  f.db.exec(`CREATE TRIGGER reject_app_update BEFORE UPDATE ON apps WHEN OLD.id='automation'
    BEGIN SELECT RAISE(ABORT,'private-fixture-error'); END`);
  const failedEdit = await f.api('/admin/models/model-a', 'PATCH', { name: 'Rollback', appIds: ['automation'] });
  assert.equal(failedEdit.status, 500);
  assert.ok(!JSON.stringify(failedEdit.data).includes('private-fixture-error'));
  assert.deepEqual(f.db.prepare('SELECT * FROM models').all(), before.models);
  assert.deepEqual(f.db.prepare('SELECT * FROM apps').all(), before.apps);
  assert.deepEqual(f.db.prepare('SELECT * FROM audit_log').all(), before.audit);
  f.db.exec('DROP TRIGGER reject_app_update');
  f.db.exec(`CREATE TRIGGER reject_second_model BEFORE INSERT ON models WHEN NEW.id='second'
    BEGIN SELECT RAISE(ABORT,'private-fixture-error'); END`);
  const rows = ['first', 'second'].map(id => {
    const { channelId, ...row } = modelBody({ id, upstreamModel: id, appIds: ['automation'] });
    return row;
  });
  assert.equal((await f.api('/admin/channels/channel-a/import', 'POST', { models: rows })).status, 500);
  assert.deepEqual(f.db.prepare('SELECT * FROM models').all(), before.models);
  assert.deepEqual(f.db.prepare('SELECT * FROM apps').all(), before.apps);
  assert.deepEqual(f.db.prepare('SELECT * FROM audit_log').all(), before.audit);
});

test('legacy create uses a private channel and enabling its model works without connection copies', async t => {
  const f = await fixture(t);
  const { channelId, ...model } = modelBody();
  const legacy = { ...model, provider: 'fixture', protocol: 'openai', baseUrl: 'https://legacy.test/v1',
    apiKey: 'legacy-fixture-key', appIds: ['chat'] };
  const created = await f.api('/admin/models', 'POST', legacy);
  assert.equal(created.status, 201);
  assert.equal(created.data.model.enabled, false);
  assert.equal(created.data.model.channelEnabled, true);
  assert.equal(f.db.prepare('SELECT secret FROM models').get().secret, '');
  const count = f.db.prepare('SELECT count(*) n FROM channels').get().n;
  assert.equal((await f.api('/admin/models', 'POST', legacy)).status, 409);
  assert.equal(f.db.prepare('SELECT count(*) n FROM channels').get().n, count);
  assert.equal((await f.api('/admin/models/model-a', 'PATCH', { enabled: true })).status, 200);
  assert.equal((await f.api('/models?appId=chat', 'GET', undefined, f.customer)).data.models.length, 1);
});

test('optional provider does not misidentify compatible channels as OpenAI, and keyless Ollama still works', async t => {
  const f = await fixture(t);
  const created = await f.api('/admin/channels', 'POST', channelBody({ id: undefined, provider: undefined }));
  assert.equal(created.status, 201);
  assert.equal(created.data.channel.provider, 'custom');
  assert.ok(created.data.channel.id);
  await f.api('/admin/models', 'POST', modelBody({ channelId: created.data.channel.id, enabled: true }));
  f.respond(() => Response.json({ choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22 } }));
  assert.equal((await f.api('/admin/models/model-a/test', 'POST', {})).data.ok, true);
  const request = JSON.parse(f.outbound.at(-1).options.body);
  assert.equal(request.max_tokens, 32);
  assert.equal(request.max_completion_tokens, undefined);
  assert.equal((await f.api('/admin/channels', 'POST', channelBody({ id: 'ollama', provider: 'ollama', apiKey: '' }))).status, 201);
  f.respond(() => Response.json({ data: [{ id: 'local-model' }] }));
  assert.equal((await f.api('/admin/channels/ollama/test', 'POST', {})).status, 200);
  assert.equal(f.outbound.at(-1).options.headers.Authorization, undefined);
});

test('channel update is authoritative for catalog, relay, legacy discovery and model probes; disable denies before billing', async t => {
  const f = await fixture(t);
  await f.api('/admin/channels', 'POST', channelBody());
  await f.api('/admin/models', 'POST', modelBody({ enabled: true, appIds: ['chat'] }));
  f.db.prepare("UPDATE apps SET default_model_id='model-a' WHERE id='chat'").run();
  await f.api(`/admin/users/${f.user.id}/adjustments`, 'POST', { amountMicros: 1000000, reason: 'Fixture', requestId: crypto.randomUUID() });
  assert.equal((await f.api('/admin/channels/channel-a', 'PATCH', {
    baseUrl: 'https://second.example.test/v1', apiKey: 'fixture-key-two', provider: 'changed',
  })).status, 200);
  // Deliberately corrupt obsolete copies: no runtime path may use these fields.
  f.db.prepare("UPDATE models SET base_url='https://stale.test',secret='stale-secret',protocol='google',provider='stale'").run();
  const adminModel = (await f.api('/admin/models')).data.models[0];
  assert.equal(adminModel.baseUrl, 'https://second.example.test/v1');
  assert.equal(adminModel.protocol, 'openai');
  assert.ok(!JSON.stringify(adminModel).includes('fixture-key-two'));
  assert.equal((await f.api('/admin/models/discover', 'POST', {
    modelId: 'model-a', provider: 'changed', protocol: 'openai', baseUrl: adminModel.baseUrl,
  })).status, 200);
  assert.equal(f.outbound.at(-1).options.headers.Authorization, 'Bearer fixture-key-two');
  f.respond(() => Response.json({ choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: 2, total_tokens: 22 } }));
  assert.equal((await f.api('/admin/models/model-a/test', 'POST', {})).data.ok, true);
  assert.equal(f.outbound.at(-1).url, 'https://second.example.test/v1/chat/completions');
  const body = { messages: [{ role: 'user', content: 'Hello' }], max_tokens: 10 };
  const relay = await f.api('/relay/chat/model-a/chat/completions', 'POST', body, f.customer);
  assert.equal(relay.status, 200, JSON.stringify(relay.data));
  assert.equal(f.outbound.at(-1).options.headers.authorization, 'Bearer fixture-key-two');
  const before = f.db.prepare('SELECT * FROM billing_calls').all();
  assert.equal(before.length, 1);
  assert.equal(before[0].status, 'completed');
  const outbound = f.outbound.length;
  await f.api('/admin/channels/channel-a', 'PATCH', { enabled: false });
  const catalog = await f.api('/models?appId=chat', 'GET', undefined, f.customer);
  assert.deepEqual(catalog.data.models, []);
  assert.equal(catalog.data.defaultModelId, null);
  assert.equal((await f.api('/relay/chat/model-a/chat/completions', 'POST', body, f.customer)).status, 403);
  assert.equal((await f.api('/admin/models/model-a/test', 'POST', {})).status, 403);
  assert.equal(f.outbound.length, outbound);
  assert.deepEqual(f.db.prepare('SELECT * FROM billing_calls').all(), before);
  assert.equal(f.db.prepare("SELECT default_model_id FROM apps WHERE id='chat'").get().default_model_id, 'model-a');
  await f.api('/admin/channels/channel-a', 'PATCH', { enabled: true });
  assert.equal((await f.api('/models?appId=chat', 'GET', undefined, f.customer)).data.defaultModelId, 'model-a');
});
