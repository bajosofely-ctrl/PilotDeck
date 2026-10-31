import { randomUUID } from 'node:crypto';
import { asyncRoute, audit, boolean, httpError, identifier, integer, MAX_APP_MODELS, onlyFields, stringList, text } from './schema.js';
import { checkApps } from './auth.js';
import { discoverModels } from './modelDiscovery.js';
import { canonicalModelName, getModel, listModels, publicModel } from './modelStore.js';

const connectionFields = ['provider', 'protocol', 'baseUrl', 'apiKey'];
const channelFields = ['id', 'name', ...connectionFields, 'enabled'];
const modelFields = ['id', 'name', 'channelId', 'upstreamModel', 'enabled', 'inputPriceMicros', 'outputPriceMicros',
  'maxInputTokens', 'maxOutputTokens', 'capabilities', 'appIds'];

export function upstreamUrl(value) {
  const raw = text(value, 'base URL', 2048);
  let url;
  try { url = new URL(raw); } catch { throw httpError(400, 'INVALID_URL', '接口地址无效。'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw httpError(400, 'INVALID_URL', '接口地址必须是 HTTP(S)，且不能包含凭据、查询参数或片段。');
  }
  return url.href.replace(/\/+$/, '');
}

function channelById(db, id) {
  const row = db.prepare('SELECT * FROM channels WHERE id=?').get(identifier(id));
  if (!row) throw httpError(404, 'NOT_FOUND', '渠道不存在，请刷新后重试。');
  return row;
}

function publicChannel(db, row) {
  return { id: row.id, name: row.name, provider: row.provider, protocol: row.protocol, baseUrl: row.base_url,
    hasApiKey: Boolean(row.secret), enabled: Boolean(row.enabled),
    modelCount: db.prepare('SELECT count(*) n FROM models WHERE channel_id=?').get(row.id).n };
}

function channelValue(body, old, seal) {
  const value = { ...(old ? publicChannelValues(old) : { enabled: false }), ...body };
  const id = identifier(old ? old.id : value.id === undefined ? randomUUID() : value.id);
  const name = text(value.name, 'channel name');
  const protocol = value.protocol;
  if (!['openai', 'openai-responses', 'anthropic', 'google'].includes(protocol)) {
    throw httpError(400, 'INVALID_PROTOCOL', '请选择支持的接口协议。');
  }
  // A protocol identifies the wire format, not a vendor-specific OpenAI parameter policy.
  const provider = text(value.provider === undefined ? 'custom' : value.provider, 'provider', 100).toLowerCase();
  const baseUrl = upstreamUrl(value.baseUrl);
  const enabled = Number(boolean(value.enabled, 'enabled'));
  if (body.apiKey !== undefined && (typeof body.apiKey !== 'string' || body.apiKey.length > 8192 || /[\r\n\0]/.test(body.apiKey))) {
    throw httpError(400, 'INVALID_KEY', 'API Key 格式无效。');
  }
  const supplied = body.apiKey?.trim();
  if (old?.secret && (upstreamUrl(old.base_url) !== baseUrl || old.protocol !== protocol) && !supplied) {
    throw httpError(400, 'CHANNEL_KEY_REQUIRED', '修改接口地址或协议后，请重新填写 API Key。');
  }
  // Blank, like omission, preserves the saved key. There is no implicit credential deletion.
  const secret = supplied ? seal(supplied) : old?.secret || '';
  if (enabled && !secret && provider !== 'ollama') throw httpError(400, 'MISSING_KEY', '启用渠道前请填写 API Key。');
  return { id, name, provider, protocol, baseUrl, secret, enabled };
}

function publicChannelValues(row) {
  return { id: row.id, name: row.name, provider: row.provider, protocol: row.protocol,
    baseUrl: row.base_url, enabled: Boolean(row.enabled) };
}

function writeChannel(db, value) {
  const modelNames = db.prepare('SELECT upstream_model FROM models WHERE channel_id=?').all(value.id)
    .map(row => canonicalModelName(value.protocol, row.upstream_model));
  if (new Set(modelNames).size !== modelNames.length) {
    throw httpError(409, 'DUPLICATE_UPSTREAM_MODEL', '修改协议会使现有模型名称重复，请先调整模型名称。');
  }
  db.prepare(`INSERT INTO channels(id,name,provider,protocol,base_url,secret,enabled) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,provider=excluded.provider,protocol=excluded.protocol,
    base_url=excluded.base_url,secret=excluded.secret,enabled=excluded.enabled`)
    .run(value.id, value.name, value.provider, value.protocol, value.baseUrl, value.secret, value.enabled);
}

function modelValue(db, body, channel, old = null) {
  const value = { enabled: false, ...(old ? publicModel(db, old) : {}), ...body };
  const enabled = boolean(value.enabled, 'enabled');
  if (enabled && !channel.secret && channel.provider !== 'ollama') {
    throw httpError(400, 'MISSING_KEY', '启用模型前请为渠道配置 API Key。');
  }
  return {
    id: identifier(old?.id ?? value.id), name: text(value.name, 'name'),
    channelId: channel.id, protocol: channel.protocol, upstreamModel: text(value.upstreamModel, 'upstream model', 200),
    enabled: Number(enabled),
    inputPrice: integer(value.inputPriceMicros, 'input price', 0, 1000000000000),
    outputPrice: integer(value.outputPriceMicros, 'output price', 0, 1000000000000),
    inputLimit: integer(value.maxInputTokens, 'input limit', 1, 10000000),
    outputLimit: integer(value.maxOutputTokens, 'output limit', 1, 10000000),
    capabilities: stringList(value.capabilities, 'capabilities', 20),
    appIds: Object.hasOwn(body, 'appIds') ? checkApps(db, body.appIds) : undefined,
  };
}

function writeModel(db, value) {
  const canonical = canonicalModelName(value.protocol, value.upstreamModel);
  const duplicate = db.prepare('SELECT id,upstream_model FROM models WHERE channel_id=? AND id<>?')
    .all(value.channelId, value.id).find(row => canonicalModelName(value.protocol, row.upstream_model) === canonical);
  if (duplicate) throw httpError(409, 'DUPLICATE_UPSTREAM_MODEL', '该渠道下的上游模型已存在。');
  db.prepare(`INSERT INTO models(id,name,channel_id,provider,protocol,base_url,secret,upstream_model,enabled,
    input_price_micros,output_price_micros,max_input_tokens,max_output_tokens,capabilities)
    VALUES (?,?,?,'','openai','','',?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,channel_id=excluded.channel_id,
    provider='',protocol='openai',base_url='',secret='',upstream_model=excluded.upstream_model,enabled=excluded.enabled,
    input_price_micros=excluded.input_price_micros,output_price_micros=excluded.output_price_micros,
    max_input_tokens=excluded.max_input_tokens,max_output_tokens=excluded.max_output_tokens,capabilities=excluded.capabilities`)
    .run(value.id, value.name, value.channelId, value.upstreamModel, value.enabled, value.inputPrice,
      value.outputPrice, value.inputLimit, value.outputLimit, JSON.stringify(value.capabilities));
  if (value.appIds !== undefined) {
    const update = db.prepare('UPDATE apps SET model_ids=?,default_model_id=? WHERE id=?');
    for (const app of db.prepare('SELECT * FROM apps').all()) {
      const ids = JSON.parse(app.model_ids);
      const include = value.appIds.includes(app.id);
      const next = include ? [...new Set([...ids, value.id])] : ids.filter(id => id !== value.id);
      if (next.length > MAX_APP_MODELS) throw httpError(400, 'APP_MODEL_LIMIT', `每个应用最多分配 ${MAX_APP_MODELS} 个模型。`);
      update.run(JSON.stringify(next), !include && app.default_model_id === value.id ? null : app.default_model_id, app.id);
    }
  }
}

export function mountChannels(app, ctx) {
  const { db, requireAdmin, seal, unseal, fetchImpl, rateLimit } = ctx;
  const route = (method, path, handler) => app[method](`/api/platform${path}`, requireAdmin, asyncRoute(handler));
  route('get', '/admin/channels', (_req, res) => {
    res.json({ channels: db.prepare('SELECT * FROM channels ORDER BY name,id').all().map(row => publicChannel(db, row)) });
  });
  for (const method of ['post', 'patch']) {
    route(method, method === 'post' ? '/admin/channels' : '/admin/channels/:id', (req, res) => {
      const creating = method === 'post';
      onlyFields(req.body, creating ? channelFields : channelFields.filter(field => field !== 'id'));
      const value = db.transaction(() => {
        const old = creating ? null : channelById(db, req.params.id);
        const value = channelValue(req.body, old, seal);
        if (creating && db.prepare('SELECT id FROM channels WHERE id=?').get(value.id)) {
          throw httpError(409, 'DUPLICATE_CHANNEL', '渠道标识已存在。');
        }
        writeChannel(db, value);
        audit(db, req.platformUser.id, creating ? 'channel.create' : 'channel.update', value.id);
        return publicChannel(db, channelById(db, value.id));
      }).immediate();
      res.status(creating ? 201 : 200).json({ channel: value });
    });
  }
  route('delete', '/admin/channels/:id', (req, res) => {
    db.transaction(() => {
      const channel = channelById(db, req.params.id);
      if (db.prepare('SELECT id FROM models WHERE channel_id=? LIMIT 1').get(channel.id)) {
        throw httpError(409, 'CHANNEL_IN_USE', '渠道仍有关联模型，请先将模型移至其他渠道。');
      }
      db.prepare('DELETE FROM channels WHERE id=?').run(channel.id);
      audit(db, req.platformUser.id, 'channel.delete', channel.id);
    }).immediate();
    res.json({ ok: true });
  });
  for (const action of ['discover', 'test']) {
    route('post', `/admin/channels/:id/${action}`, async (req, res) => {
      onlyFields(req.body ?? {}, []);
      rateLimit('channel-discovery', req.platformUser.id, 10, 60000);
      const channel = channelById(db, req.params.id);
      if (!channel.secret && channel.provider !== 'ollama') throw httpError(400, 'MISSING_KEY', '请先填写渠道 API Key。');
      try {
        const result = await discoverModels({ protocol: channel.protocol, baseUrl: channel.base_url,
          apiKey: channel.secret ? unseal(channel.secret) : '' }, fetchImpl);
        audit(db, req.platformUser.id, `channel.${action}-success`, channel.id);
        res.json(action === 'test' ? { ok: true, modelCount: result.models.length } : result);
      } catch (error) {
        audit(db, req.platformUser.id, `channel.${action}-failure`, channel.id);
        if (error.public) throw error;
        throw httpError(502, 'CHANNEL_DISCOVERY_FAILED', '渠道模型列表读取失败，请检查渠道配置后重试。');
      }
    });
  }
  route('post', '/admin/channels/:id/import', (req, res) => {
    onlyFields(req.body, ['models']);
    if (!Array.isArray(req.body.models) || !req.body.models.length || req.body.models.length > 100) {
      throw httpError(400, 'INVALID_MODELS', '请选择 1 至 100 个模型。');
    }
    const result = db.transaction(() => {
      const channel = channelById(db, req.params.id);
      const values = req.body.models.map(body => {
        onlyFields(body, modelFields.filter(field => field !== 'channelId'));
        return modelValue(db, body, channel);
      });
      const skipped = [], pending = [], ids = new Set();
      const pairs = new Map(db.prepare('SELECT id,upstream_model FROM models WHERE channel_id=?').all(channel.id)
        .map(row => [canonicalModelName(channel.protocol, row.upstream_model), row.id]));
      // Validate the entire batch, including rows that will be skipped, before performing writes.
      for (const value of values) {
        const canonical = canonicalModelName(channel.protocol, value.upstreamModel);
        if (pairs.has(canonical)) {
          skipped.push({ id: value.id, upstreamModel: value.upstreamModel, existingModelId: pairs.get(canonical), reason: 'already_exists' });
          continue;
        }
        if (ids.has(value.id) || db.prepare('SELECT id FROM models WHERE id=?').get(value.id)) {
          throw httpError(409, 'DUPLICATE_MODEL', '模型标识已存在，请修改后重试。');
        }
        ids.add(value.id);
        pairs.set(canonical, value.id);
        pending.push(value);
      }
      for (const value of pending) writeModel(db, value);
      audit(db, req.platformUser.id, 'channel.import', channel.id);
      return { models: pending.map(value => publicModel(db, getModel(db, value.id))), skipped };
    }).immediate();
    res.status(201).json(result);
  });
  route('get', '/admin/models', (_req, res) => res.json({ models: listModels(db).map(row => publicModel(db, row)) }));
  for (const method of ['post', 'patch']) {
    route(method, method === 'post' ? '/admin/models' : '/admin/models/:id', (req, res) => {
      const creating = method === 'post';
      onlyFields(req.body, creating ? [...modelFields, ...connectionFields] : modelFields.filter(field => field !== 'id'));
      const model = db.transaction(() => {
        const old = creating ? null : getModel(db, identifier(req.params.id));
        if (!creating && !old) throw httpError(404, 'NOT_FOUND', '模型不存在。');
        const channelId = Object.hasOwn(req.body, 'channelId') ? identifier(req.body.channelId) : old?.channel_id;
        if (channelId && connectionFields.some(field => Object.hasOwn(req.body, field))) {
          throw httpError(400, 'INVALID_INPUT', '请在渠道中修改连接配置。');
        }
        let channel;
        if (channelId) channel = channelById(db, channelId);
        else {
          // Legacy create requests get a private channel; credentials are never persisted on models.
          const value = channelValue({ name: req.body.name, provider: req.body.provider, protocol: req.body.protocol,
            baseUrl: req.body.baseUrl, apiKey: req.body.apiKey,
            enabled: (typeof req.body.apiKey === 'string' && Boolean(req.body.apiKey.trim())) ||
              (typeof req.body.provider === 'string' && req.body.provider.trim().toLowerCase() === 'ollama') }, null, seal);
          writeChannel(db, value);
          channel = channelById(db, value.id);
        }
        const value = modelValue(db, req.body, channel, old);
        if (creating && db.prepare('SELECT id FROM models WHERE id=?').get(value.id)) {
          throw httpError(409, 'DUPLICATE_MODEL', '模型标识已存在。');
        }
        writeModel(db, value);
        audit(db, req.platformUser.id, creating ? 'model.create' : 'model.update', value.id);
        return publicModel(db, getModel(db, value.id));
      }).immediate();
      res.status(creating ? 201 : 200).json({ model });
    });
  }
}
