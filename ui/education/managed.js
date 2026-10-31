import express from 'express';

export const managedModules = new Set(['study-coach', 'ai-classroom']);

export function managedChildEnvironment(env, moduleId, parentPort) {
  if (!env.PILOTDECK_MANAGED_URL || !managedModules.has(moduleId)) return {};
  if (!Number.isInteger(parentPort) || parentPort < 1 || parentPort > 65535) {
    throw new Error('Invalid managed parent port.');
  }
  const bridge = {
    PILOTDECK_MANAGED_BRIDGE: `http://127.0.0.1:${parentPort}`,
    PILOTDECK_MANAGED_LOCAL_KEY: env.PILOTDECK_MANAGED_LOCAL_KEY,
  };
  createManagedLearning({ env: bridge });
  return bridge;
}

export function validModelId(value) {
  return value === undefined || (typeof value === 'string' && value.trim().length > 0
    && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value));
}

class ManagedError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function managedFailure(error) {
  return error instanceof ManagedError
    ? { status: error.status, message: error.message }
    : { status: 502, message: '托管学习服务暂不可用，请稍后重试。' };
}

export function createManagedLearning({ env = {}, request = fetch } = {}) {
  const address = env.PILOTDECK_MANAGED_BRIDGE;
  const key = env.PILOTDECK_MANAGED_LOCAL_KEY;
  if (!address && !key && !env.PILOTDECK_MANAGED_URL) return null;
  // Only the parent-provided numeric loopback origin is allowed, with no
  // credentials, paths, redirects or DNS resolution of a supplied hostname.
  const match = typeof address === 'string' && /^http:\/\/127\.0\.0\.1:(\d+)\/?$/.exec(address);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535
      || typeof key !== 'string' || !key.trim() || key.length > 512 || !/^[\x21-\x7e]+$/.test(key)) {
    throw new Error('Invalid managed learning bridge configuration.');
  }
  const origin = `http://127.0.0.1:${Number(match[1])}`;
  async function call(endpoint, { body, signal } = {}) {
    const response = await request(`${origin}/api/managed/learning/${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: signal || AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 402) throw new ManagedError(402, '账户余额不足，请在账户页面查看。');
      if (response.status === 429) throw new ManagedError(429, '请求过于频繁，请稍后重试。');
      if (response.status === 403) throw new ManagedError(403, '此学习模型不可用，请刷新模型列表或联系管理员。');
      throw new ManagedError(502, '托管学习服务暂不可用，请稍后重试。');
    }
    return response.json();
  }
  return {
    async config() {
      const data = await call('models');
      if (!Array.isArray(data?.items)) throw new Error('Invalid model catalog.');
      const models = data.items.map(item => {
        if (!item || typeof item.id !== 'string' || !validModelId(item.id)
            || typeof item.name !== 'string' || !item.name.trim()
            || typeof item.protocol !== 'string'
            || !Number.isSafeInteger(item.inputPriceMicros) || item.inputPriceMicros < 0
            || !Number.isSafeInteger(item.outputPriceMicros) || item.outputPriceMicros < 0) {
          throw new Error('Invalid model catalog.');
        }
        return {
          id: item.id, name: item.name, protocol: item.protocol,
          inputPriceMicros: item.inputPriceMicros, outputPriceMicros: item.outputPriceMicros,
        };
      });
      const defaultModelId = models.find(item => item.id === data.defaultModelId)?.id || models[0]?.id || null;
      return { managed: true, models, defaultModelId };
    },
    async complete({ modelId, messages, maxTokens }, signal) {
      const data = await call('complete', {
        body: { ...(modelId === undefined ? {} : { modelId: modelId.trim() }), messages, maxTokens },
        signal,
      });
      if (typeof data?.answer !== 'string' || !data.answer.trim()) throw new Error('Empty managed answer.');
      return data.answer;
    },
  };
}

export function createManagedConfigRouter(managed) {
  const router = express.Router();
  router.get('/config', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const host = req.get('host') || '';
    // Same-origin GET fetches may omit Origin. Reject cross-origin browser
    // requests and untrusted Host values without granting CORS access.
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host)
        || (req.get('origin') && req.get('origin') !== `http://${host}`)
        || ['cross-site', 'same-site'].includes(req.get('sec-fetch-site'))) {
      return res.status(403).json({ error: '请从学习页面读取模型设置。' });
    }
    try {
      res.json(managed ? await managed.config() : { managed: false });
    } catch (error) {
      const failure = managedFailure(error);
      res.status(failure.status).json({ managed: true, error: failure.message });
    }
  });
  return router;
}
