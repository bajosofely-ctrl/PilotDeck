import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

export function platformUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Managed service requires HTTPS (HTTP is allowed only on loopback).');
  }
  return url.href.replace(/\/+$/, '');
}

export async function platformRequest(env, endpoint, options = {}) {
  const response = await fetch(`${platformUrl(env.PILOTDECK_MANAGED_URL)}/api/platform${endpoint}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.PILOTDECK_MANAGED_TOKEN}`, ...options.headers },
    signal: options.signal || AbortSignal.timeout(15000),
    redirect: 'error',
  });
  return response;
}

export function managedModelConfig(models, { port, localKey }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !localKey) throw new Error('Invalid local managed runtime.');
  const providers = {};
  for (const model of models) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(model.id) ||
        !['openai', 'openai-responses', 'anthropic', 'google'].includes(model.protocol)) {
      throw new Error('Invalid managed model catalog.');
    }
    providers[`managed_${model.id}`] = {
      protocol: model.protocol,
      url: `http://127.0.0.1:${port}/api/managed/relay/chat/${encodeURIComponent(model.id)}${model.protocol === 'google' ? '/v1beta' : ''}`,
      apiKey: localKey,
      retry: { requestMaxRetries: 0, streamMaxRetries: 0 },
      models: {
        [model.id]: {
          displayName: model.name,
          multimodal: {
            input: model.capabilities?.includes('image') ? ['text', 'image'] : ['text'],
            maxImageBytes: 1024 * 1024,
            supportedImageMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
          },
          capabilities: {
            // The engine subtracts output capacity from the total context window.
            ...(model.maxInputTokens ? { maxContextTokens: model.maxInputTokens + (model.maxOutputTokens || 0) } : {}),
            ...(model.maxOutputTokens ? { maxOutputTokens: model.maxOutputTokens } : {}),
          },
        },
      },
    };
  }
  // The engine needs a valid default even when the account has no chat models.
  // This local transport only returns a denial; it never reaches a provider.
  if (!models.length) {
    providers.managed__disabled = {
      protocol: 'openai', url: `http://127.0.0.1:${port}/api/managed/unavailable`,
      apiKey: localKey, retry: { requestMaxRetries: 0, streamMaxRetries: 0 },
      models: { disabled: { displayName: '聊天暂未开放', capabilities: { maxContextTokens: 8192, maxOutputTokens: 512 } } },
    };
  }
  return { providers };
}

export async function bootstrapManagedClient(env = process.env) {
  if (!env.PILOTDECK_MANAGED_URL) return;
  if (!env.PILOT_HOME || !env.PILOTDECK_MANAGED_USER_ID || !env.PILOTDECK_MANAGED_TOKEN) {
    throw new Error('Missing managed account context.');
  }
  const profile = path.resolve(env.PILOT_HOME);
  const configPath = path.join(profile, 'pilotdeck.yaml');
  if (env.PILOTDECK_CONFIG_PATH && path.resolve(env.PILOTDECK_CONFIG_PATH) !== configPath) {
    throw new Error('Managed configuration must be inside the account profile.');
  }
  await fs.mkdir(profile, { recursive: true });
  const cachePath = path.join(profile, 'managed-catalog.json');
  let catalog;
  try {
    const response = await platformRequest(env, '/me');
    if (!response.ok) throw Object.assign(new Error('Account verification failed.'), { status: response.status });
    const account = await response.json();
    const user = account.user || account;
    if (user.id !== env.PILOTDECK_MANAGED_USER_ID) throw Object.assign(new Error('Account mismatch.'), { status: 403 });
    await fs.writeFile(path.join(profile, 'managed-user.json'), JSON.stringify({
      id: user.id, email: user.email, role: user.role, status: user.status, apps: user.apps,
    }), { mode: 0o600 });
    const modelsResponse = await platformRequest(env, '/models?appId=chat');
    if (!modelsResponse.ok && modelsResponse.status !== 403) throw Object.assign(new Error('Cannot read authorized models.'), { status: modelsResponse.status });
    catalog = modelsResponse.status === 403 ? { items: [], defaultModelId: null } : await modelsResponse.json();
    await fs.writeFile(cachePath, JSON.stringify(catalog), { mode: 0o600 });
  } catch (error) {
    // Only a verified desktop offline session may read its previous catalog.
    // HTTP auth/configuration failures never become an offline fallback.
    if (env.PILOTDECK_MANAGED_OFFLINE !== '1' || error.status) throw error;
    catalog = JSON.parse(await fs.readFile(cachePath, 'utf8'));
  }
  const items = Array.isArray(catalog) ? catalog : catalog.items || catalog.models || [];
  let config = {};
  let previous = '';
  try { previous = await fs.readFile(configPath, 'utf8'); config = parse(previous) || {}; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  config.schemaVersion = 1;
  config.model = managedModelConfig(items, { port: Number(env.SERVER_PORT), localKey: env.PILOTDECK_MANAGED_LOCAL_KEY });
  const preferred = items.find(item => item.id === catalog.defaultModelId) || items[0];
  config.agent = { ...config.agent, model: preferred ? `managed_${preferred.id}/${preferred.id}` : 'managed__disabled/disabled' };
  // Remove inherited references to retired providers when the authorized pool changes.
  config.agent.subagents = { ...config.agent.subagents, default: 'inherit' };
  config.webui = { ...config.webui, runtime: {
    ...config.webui?.runtime,
    databasePath: path.join(profile, 'pilotdeck.db'),
    workspacesRoot: path.join(path.dirname(profile), `${path.basename(profile)}-workspaces`),
  } };
  if (config.memory) config.memory.model = 'inherit';
  if (config.router) config.router.enabled = false;
  delete config.customEnv;
  const next = stringify(config);
  if (next === previous) return { count: items.length };
  const temporary = `${configPath}.managed.tmp`;
  await fs.writeFile(temporary, next, { mode: 0o600 });
  await fs.rename(temporary, configPath);
  return { count: items.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  bootstrapManagedClient().catch(() => {
    console.error('Managed account configuration could not be loaded.');
    process.exitCode = 1;
  });
}
