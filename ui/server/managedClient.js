import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { bootstrapManagedClient, platformRequest, platformUrl } from './managedBootstrap.js';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'yaml';
import { apiApplication, createManagedAppGuard } from './managedAccess.js';

const sameSecret = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const safe = handler => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

export function installManagedClient(app, { env = process.env, request: baseRequest = platformRequest } = {}) {
  const enabled = Boolean(env.PILOTDECK_MANAGED_URL);
  let sessionRevoked = false;
  const request = async (...args) => {
    const response = await baseRequest(...args);
    if (response.status === 401) sessionRevoked = true;
    return response;
  };
  if (enabled) platformUrl(env.PILOTDECK_MANAGED_URL);
  app.get('/api/managed/status', (_req, res) => res.json({ enabled, sessionValid: !sessionRevoked }));
  if (!enabled) return;

  const key = env.PILOTDECK_MANAGED_LOCAL_KEY;
  if (!key || !env.PILOTDECK_MANAGED_USER_ID) throw new Error('Managed runtime has no account context.');
  const appGuard = createManagedAppGuard({ env, request });
  const secretAccess = (req, res, next) => {
    const supplied = req.get('authorization')?.replace(/^Bearer /i, '') || req.get('x-api-key') || req.get('x-goog-api-key') || req.query.key;
    if (!sameSecret(supplied, key)) return res.status(401).json({ error: 'Local model access denied.' });
    next();
  };
  const browserOrigin = (req, res, next) => {
    const host = req.get('host') || '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) ||
        (req.get('origin') && req.get('origin') !== `http://${host}`) ||
        req.get('sec-fetch-site') === 'cross-site') {
      return res.status(403).json({ error: '请从客户端账户页面操作。' });
    }
    next();
  };
  const browserAccess = (req, res, next) => browserOrigin(req, res, () => {
    if (!['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ error: 'Expected JSON.' });
    }
    next();
  });
  const forwardJson = async (req, res, endpoint) => {
    const response = await request(env, endpoint, {
      method: req.method,
      ...(!['GET', 'HEAD'].includes(req.method) ? { body: JSON.stringify(req.body || {}) } : {}),
    });
    res.status(response.status).set('Cache-Control', 'no-store').json(await response.json());
  };
  const accountRoutes = [
    ['get', '/me'], ['get', '/wallet'], ['get', '/ledger'], ['post', '/redeem'],
    ['get', '/devices'], ['post', '/auth/change-password'], ['get', '/models'], ['get', '/releases'],
  ];
  let refreshing;
  const refreshModels = () => {
    if (!refreshing) refreshing = bootstrapManagedClient(env)
      .catch(error => { if (error.status === 401) sessionRevoked = true; throw error; })
      .finally(() => { refreshing = null; });
    return refreshing;
  };
  app.post('/api/managed/refresh-models', browserAccess, safe(async (_req, res) => res.json(await refreshModels())));
  if (env.PILOT_HOME && env.SERVER_PORT) {
    const timer = setInterval(() => void refreshModels().catch(() => {}), 60000);
    timer.unref();
  }
  for (const [method, endpoint] of accountRoutes) {
    app[method](`/api/managed${endpoint}`, browserAccess, safe((req, res) =>
      forwardJson(req, res, endpoint + (endpoint === '/models' ? '?appId=chat' : ''))));
  }
  app.delete('/api/managed/devices/:id', browserAccess, safe((req, res) => forwardJson(req, res, `/devices/${encodeURIComponent(req.params.id)}`)));

  app.post('/api/managed/unavailable/*', secretAccess, (_req, res) => res.status(403).json({
    error: { message: '聊天暂未开放，请联系管理员配置或授权模型。', type: 'permission_error', code: 'MODEL_UNAVAILABLE' },
  }));

  app.post('/api/managed/relay/:appId/:modelId/*', secretAccess, safe(async (req, res) => {
    if (!['chat', 'automation', 'skills', 'learning'].includes(req.params.appId)) return res.sendStatus(404);
    const suffix = req.params[0];
    if (!/^(v1\/)?(chat\/completions|responses|messages)$/.test(suffix) &&
        !/^v1beta\/models\/[a-zA-Z0-9_.:-]+:(streamGenerateContent|generateContent)$/.test(suffix)) return res.sendStatus(404);
    const response = await request(env,
      `/relay/${encodeURIComponent(req.params.appId)}/${encodeURIComponent(req.params.modelId)}/${suffix}`, {
        method: 'POST', body: JSON.stringify(req.body),
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        // Keep reading upstream on renderer disconnect so the server can settle
        // verified final usage. The cloud has its own bounded request timeout.
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
    res.status(response.status).set('Cache-Control', 'no-store');
    res.set('Content-Type', response.headers.get('content-type') || 'application/json');
    if (!response.body) return res.end();
    try { await pipeline(Readable.fromWeb(response.body), res); } catch { /* Cloud owns final settlement. */ }
  }));

  for (const application of ['learning', 'automation']) {
    app.get(`/api/managed/${application}/models`, secretAccess, safe(async (req, res) => {
      const response = await request(env, `/models?appId=${application}`);
      const data = await response.json();
      res.status(response.status).json(response.ok
        ? { items: data.items || data.models || [], defaultModelId: data.defaultModelId }
        : data);
    }));
  }
  app.post('/api/managed/learning/complete', secretAccess, safe(async (req, res) => {
    const catalogResponse = await request(env, '/models?appId=learning');
    if (!catalogResponse.ok) return res.status(catalogResponse.status).json(await catalogResponse.json());
    const catalog = await catalogResponse.json();
    const models = Array.isArray(catalog) ? catalog : catalog.items || catalog.models || [];
    const model = models.find(item => item.id === (req.body.modelId || catalog.defaultModelId)) || (!req.body.modelId ? models[0] : null);
    if (!model) return res.status(403).json({ error: '没有可用的学习模型，请联系管理员。' });
    const { messages } = req.body;
    if (!Array.isArray(messages) || !messages.length || messages.length > 45 ||
        messages.some(item => !['system', 'user', 'assistant'].includes(item.role) || typeof item.content !== 'string')) {
      return res.status(400).json({ error: 'Invalid learning messages.' });
    }
    const maxTokens = Math.min(1600, model.maxOutputTokens || 1600);
    let suffix = 'v1/chat/completions';
    let body = { messages, max_tokens: maxTokens, stream: false };
    if (model.protocol === 'anthropic') {
      suffix = 'v1/messages';
      body = { ...body, system: messages.filter(m => m.role === 'system').map(m => m.content).join('\n'), messages: messages.filter(m => m.role !== 'system') };
    } else if (model.protocol === 'openai-responses') {
      suffix = 'v1/responses';
      body = { input: messages, max_output_tokens: maxTokens, stream: false };
    } else if (model.protocol === 'google') {
      suffix = `v1beta/models/${encodeURIComponent(model.id)}:generateContent`;
      body = {
        contents: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        systemInstruction: { parts: [{ text: messages.filter(m => m.role === 'system').map(m => m.content).join('\n') }] },
        generationConfig: { maxOutputTokens: maxTokens },
      };
    }
    const response = await request(env, `/relay/learning/${encodeURIComponent(model.id)}/${suffix}`, {
      method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': crypto.randomUUID() },
      signal: AbortSignal.timeout(120000),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    const answer = model.protocol === 'anthropic' ? data.content?.filter(c => c.type === 'text').map(c => c.text).join('\n')
      : model.protocol === 'google' ? data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n')
      : model.protocol === 'openai-responses' ? data.output?.flatMap(o => o.content || []).map(c => c.text || '').join('\n')
      : data.choices?.[0]?.message?.content;
    if (typeof answer !== 'string') return res.status(502).json({ error: '模型未返回文本回复。' });
    res.json({ answer });
  }));

  // These routes can otherwise install customer-supplied provider credentials.
  app.use('/api', browserOrigin, (req, res, next) => appGuard(apiApplication(req.path))(req, res, next), (req, res, next) => {
    const path = req.path;
    if (req.method === 'PUT' && ['/config', '/config/'].includes(path)) {
      // Ordinary local settings remain editable; provider and shared-service
      // sections must match the current managed configuration.
      void import('./services/pilotdeckConfig.js').then(({ readPilotDeckConfigFile, preserveMaskedSecrets }) => {
        const record = readPilotDeckConfigFile();
        const raw = typeof req.body?.raw === 'string';
        const submitted = raw ? parse(req.body.raw) : req.body?.config;
        const source = raw ? record.rawYaml : record.config;
        const restored = preserveMaskedSecrets(submitted, source);
        if (!restored || req.body.providerRenames || req.body.modelRenames ||
            !isDeepStrictEqual(restored.model, source.model) ||
            !isDeepStrictEqual(restored.customEnv, source.customEnv) ||
            !isDeepStrictEqual(restored.tools?.webSearch, source.tools?.webSearch)) {
          return res.status(403).json({ error: '模型和共用服务由管理后台配置。', code: 'MANAGED_CONFIGURATION' });
        }
        next();
      }).catch(() => res.status(403).json({ error: '无法验证配置，请刷新后重试。' }));
      return;
    }
    const modelMutation = !['GET', 'HEAD'].includes(req.method) &&
      (path.startsWith('/config') || path.startsWith('/v1/model-') || path.startsWith('/settings/api-keys'));
    if (modelMutation) return res.status(403).json({ error: '模型和共用服务由管理后台配置。', code: 'MANAGED_CONFIGURATION' });
    next();
  });
  app.use('/api/managed', (error, _req, res, _next) => {
    if (res.headersSent) return res.end();
    res.status(503).json({ error: '暂时无法连接账户服务，请检查网络后重试。' });
  });
}
