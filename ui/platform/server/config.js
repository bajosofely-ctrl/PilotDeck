import { randomUUID } from 'node:crypto';
import { asyncRoute, audit, boolean, httpError, identifier, integer, MAX_APP_MODELS, onlyFields, text, stringList } from './schema.js';
import { checkApps } from './auth.js';
import { prepareRequest, responseUsage } from './billing.js';
import { discoverModels } from './modelDiscovery.js';
import { mountChannels, upstreamUrl } from './channels.js';
import { getModel } from './modelStore.js';

const PREFIX = '/api/platform';
const MAX_PROBE_BYTES = 64 * 1024;

async function readProbe(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing probe response');
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      throw new Error('Invalid probe response');
    }
    const chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PROBE_BYTES) throw new Error('Probe response too large');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

function validProbe(payload, protocol, bounds) {
  const usage = responseUsage(payload, protocol);
  if (!usage || usage.input > bounds.input || usage.output > bounds.output) return false;
  if (protocol === 'openai') {
    return Array.isArray(payload.choices) && payload.choices.length === 1 && payload.choices.every(choice =>
      ['stop', 'length'].includes(choice?.finish_reason) && choice.message?.role === 'assistant' &&
      (typeof choice.message.content === 'string' ||
        (choice.finish_reason === 'length' && choice.message.content == null)));
  }
  if (protocol === 'openai-responses') {
    return payload.object === 'response' && ['completed', 'incomplete'].includes(payload.status) &&
      (payload.status !== 'incomplete' || payload.incomplete_details?.reason === 'max_output_tokens') &&
      Array.isArray(payload.output) && (payload.output.length > 0 || payload.status === 'incomplete') &&
      payload.output.every(item =>
        (item?.type === 'message' && item.role === 'assistant' && Array.isArray(item.content) &&
          item.content.every(part => part?.type === 'output_text' && typeof part.text === 'string')) ||
        (item?.type === 'reasoning' && Array.isArray(item.summary) &&
          item.summary.every(part => part?.type === 'summary_text' && typeof part.text === 'string')));
  }
  if (protocol === 'anthropic') {
    return payload.type === 'message' && payload.role === 'assistant' &&
      ['end_turn', 'max_tokens', 'stop_sequence'].includes(payload.stop_reason) &&
      Array.isArray(payload.content) && (payload.content.length > 0 || payload.stop_reason === 'max_tokens') &&
      payload.content.every(part => (part?.type === 'text' && typeof part.text === 'string') ||
        (part?.type === 'thinking' && typeof part.thinking === 'string') ||
        (part?.type === 'redacted_thinking' && typeof part.data === 'string'));
  }
  return Array.isArray(payload.candidates) && payload.candidates.length === 1 &&
    payload.candidates.every(candidate => ['STOP', 'MAX_TOKENS'].includes(candidate?.finishReason) &&
      ((candidate.finishReason === 'MAX_TOKENS' && candidate.content == null) ||
        (candidate.content?.role === 'model' && Array.isArray(candidate.content.parts) &&
          candidate.content.parts.every(part => typeof part?.text === 'string'))));
}

export function mountConfig(app, ctx) {
  const { db, requireAdmin, requireUser, getSettings, unseal, fetchImpl, rateLimit } = ctx;
  mountChannels(app, ctx);
  const route = (method, endpoint, ...handlers) => app[method](PREFIX + endpoint, ...handlers.map(asyncRoute));
  route('get', '/admin/settings', requireAdmin, (_req, res) => res.json({ settings: getSettings() }));
  route('put', '/admin/settings', requireAdmin, (req, res) => {
    onlyFields(req.body, ['registrationEnabled', 'deviceLimit', 'concurrencyLimit', 'defaultApps', 'giftEnabled', 'giftAmountMicros', 'giftExpiryDays']);
    const values = { ...getSettings(), ...req.body };
    boolean(values.registrationEnabled, 'registrationEnabled'); boolean(values.giftEnabled, 'giftEnabled');
    integer(values.deviceLimit, 'device limit', 1, 100); integer(values.concurrencyLimit, 'concurrency limit', 1, 100);
    checkApps(db, values.defaultApps); integer(values.giftAmountMicros, 'gift amount', 0, 1000000000000);
    if (values.giftExpiryDays !== null) integer(values.giftExpiryDays, 'gift expiry days', 1, 36500);
    db.transaction(() => {
      const update = db.prepare('UPDATE settings SET value=? WHERE key=?');
      for (const [key, value] of Object.entries(req.body)) update.run(JSON.stringify(value), key);
      audit(db, req.platformUser.id, 'settings.update');
    })();
    res.json({ settings: getSettings() });
  });
  route('post', '/admin/models/discover', requireAdmin, async (req, res) => {
    onlyFields(req.body, ['provider', 'protocol', 'baseUrl', 'apiKey', 'modelId']);
    rateLimit('model-discovery', req.platformUser.id, 10, 60000);
    const provider = text(req.body.provider, 'provider', 100).toLowerCase();
    const protocol = req.body.protocol;
    if (!['openai', 'openai-responses', 'anthropic', 'google'].includes(protocol)) {
      throw httpError(400, 'INVALID_PROTOCOL', '请选择支持的接口协议。');
    }
    const baseUrl = upstreamUrl(req.body.baseUrl);
    const supplied = req.body.apiKey;
    if (supplied !== undefined && (typeof supplied !== 'string' || supplied.length > 8192 || /[\r\n\0]/.test(supplied))) {
      throw httpError(400, 'INVALID_KEY', 'API Key 格式无效。');
    }
    let apiKey = supplied?.trim() || '';
    let saved;
    if (req.body.modelId !== undefined) {
      saved = getModel(db, identifier(req.body.modelId));
      if (!saved) throw httpError(404, 'NOT_FOUND', '模型不存在，请刷新后重试。');
    }
    if (!apiKey && saved?.secret) {
      if (upstreamUrl(saved.base_url) !== baseUrl || saved.protocol !== protocol) {
        throw httpError(400, 'DISCOVERY_KEY_REQUIRED', '修改接口地址或协议后，请重新填写 API Key 再获取列表。');
      }
      apiKey = unseal(saved.secret);
    }
    if (!apiKey && provider !== 'ollama') throw httpError(400, 'MISSING_KEY', '请先填写 API Key。');
    try {
      const result = await discoverModels({ baseUrl, protocol, apiKey }, fetchImpl);
      audit(db, req.platformUser.id, 'model.discovery-success', saved?.id || null);
      res.json(result);
    } catch (error) {
      audit(db, req.platformUser.id, 'model.discovery-failure', saved?.id || null);
      throw error;
    }
  });
  route('post', '/admin/models/:id/test', requireAdmin, async (req, res) => {
    rateLimit('model-test', req.platformUser.id, 10, 60000);
    const model = getModel(db, req.params.id);
    if (!model) throw httpError(404, 'NOT_FOUND', 'Model not found.');
    if (!model.channel_enabled) throw httpError(403, 'CHANNEL_DISABLED', '渠道已停用，无法测试模型。');
    let success = false;
    let status = null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const headers = { 'Content-Type': 'application/json' };
      const secret = model.secret ? unseal(model.secret) : '';
      const max = Math.min(model.max_output_tokens, 32);
      let path, body;
      if (model.protocol === 'google') {
        headers['x-goog-api-key'] = secret;
        path = 'v1beta/models/probe:generateContent';
        body = { contents: [{ role: 'user', parts: [{ text: 'Reply OK.' }] }], generationConfig: { maxOutputTokens: max } };
      } else if (model.protocol === 'anthropic') {
        headers['x-api-key'] = secret; headers['anthropic-version'] = '2023-06-01';
        path = 'v1/messages';
        body = { messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: max };
      } else {
        if (secret) headers.Authorization = `Bearer ${secret}`;
        path = model.protocol === 'openai-responses' ? 'v1/responses' : 'v1/chat/completions';
        body = model.protocol === 'openai-responses'
          ? { input: 'Reply OK.', max_output_tokens: max, store: false }
          : { messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: max };
      }
      // Shared normalization is pure; operator probes never reserve or settle customer funds.
      const prepared = prepareRequest(model, body, path);
      const response = await fetchImpl(prepared.url, { method: 'POST', headers, body: JSON.stringify(prepared.request),
        redirect: 'error', signal: controller.signal });
      status = response.status;
      success = validProbe(await readProbe(response, controller.signal), model.protocol, prepared);
    } catch { /* Provider errors may contain credentials. Only expose a bounded status. */ }
    finally { clearTimeout(timeout); }
    audit(db, req.platformUser.id, success ? 'model.test-success' : 'model.test-failure', model.id);
    res.json({ ok: success, upstreamStatus: status });
  });
  const apps = () => db.prepare('SELECT * FROM apps ORDER BY rowid').all().map(row => ({
    id: row.id, name: row.name, enabled: Boolean(row.enabled), defaultModelId: row.default_model_id, modelIds: JSON.parse(row.model_ids),
  }));
  route('get', '/admin/apps', requireAdmin, (_req, res) => res.json({ apps: apps() }));
  route('put', '/admin/apps', requireAdmin, (req, res) => {
    onlyFields(req.body, ['apps']);
    if (!Array.isArray(req.body.apps) || req.body.apps.length > 100) throw httpError(400, 'INVALID_APPS', 'Invalid applications.');
    const seen = new Set();
    db.transaction(() => {
      for (const value of req.body.apps) {
        onlyFields(value, ['id', 'name', 'enabled', 'defaultModelId', 'modelIds']);
        const id = identifier(value.id);
        if (seen.has(id) || !db.prepare('SELECT id FROM apps WHERE id=?').get(id)) throw httpError(400, 'INVALID_APP', 'Unknown or duplicate application.');
        seen.add(id);
        const modelIds = stringList(value.modelIds, 'models', MAX_APP_MODELS);
        if (modelIds.some(modelId => !db.prepare('SELECT id FROM models WHERE id=?').get(modelId))) throw httpError(400, 'INVALID_MODEL', 'Unknown model.');
        const defaultModelId = value.defaultModelId || null;
        if (defaultModelId && !modelIds.includes(defaultModelId)) throw httpError(400, 'INVALID_MODEL', 'Default model must be allowed.');
        db.prepare('UPDATE apps SET name=?,enabled=?,default_model_id=?,model_ids=? WHERE id=?')
          .run(text(value.name, 'application name'), Number(boolean(value.enabled, 'enabled')), defaultModelId, JSON.stringify(modelIds), id);
      }
      audit(db, req.platformUser.id, 'apps.update');
    })();
    res.json({ apps: apps() });
  });
  const release = row => ({ id: row.id, version: row.version, notes: row.notes, downloadUrl: row.download_url,
    sha256: row.sha256, sizeBytes: row.size_bytes, platform: row.platform, createdAt: row.created_at });
  const releases = () => db.prepare('SELECT * FROM releases ORDER BY created_at DESC LIMIT 100').all().map(release);
  route('get', '/admin/releases', requireAdmin, (_req, res) => res.json({ releases: releases() }));
  route('get', '/releases', requireUser, (_req, res) => res.json({ releases: releases() }));
  route('post', '/admin/releases', requireAdmin, (req, res) => {
    onlyFields(req.body, ['version', 'notes', 'downloadUrl', 'sha256', 'sizeBytes', 'platform']);
    const { version, notes, sha256 } = req.body;
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version) || version.length > 80) throw httpError(400, 'INVALID_VERSION', 'Use a semantic version.');
    if (typeof notes !== 'string' || notes.length > 20000) throw httpError(400, 'INVALID_NOTES', 'Invalid release notes.');
    if (typeof sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(sha256)) throw httpError(400, 'INVALID_HASH', 'Invalid SHA-256.');
    const url = upstreamUrl(req.body.downloadUrl);
    if (!url.startsWith('https://')) throw httpError(400, 'INVALID_URL', 'Release download requires HTTPS.');
    if (req.body.platform !== 'win32-x64') throw httpError(400, 'INVALID_PLATFORM', 'Only Windows x64 is supported.');
    const size = integer(req.body.sizeBytes, 'package size', 1, 20000000000);
    if (db.prepare('SELECT id FROM releases WHERE version=?').get(version)) throw httpError(409, 'DUPLICATE_VERSION', 'Version already published.');
    const id = randomUUID();
    db.transaction(() => {
      db.prepare('INSERT INTO releases VALUES (?,?,?,?,?,?,?,?,?)').run(id, version, notes, url, sha256.toLowerCase(), size, 'win32-x64', Date.now(), req.platformUser.id);
      audit(db, req.platformUser.id, 'release.publish', id);
    })();
    res.status(201).json({ release: release(db.prepare('SELECT * FROM releases WHERE id=?').get(id)) });
  });
}
