import { httpError } from './schema.js';

const failure = (message = '无法获取模型列表，请检查接口地址和网络，或手动填写模型名称。') =>
  httpError(502, 'MODEL_DISCOVERY_FAILED', message);
const safeText = value => typeof value === 'string' && value.trim().length > 0 &&
  value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;

async function readCatalog(response, signal, budget) {
  const reader = response.body?.getReader();
  const cancel = () => { void reader?.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw failure('服务商拒绝访问，请检查 API Key 和模型列表权限。');
      if ([404, 405, 501].includes(response.status)) throw failure('该接口未提供模型列表，请核对基础地址，或手动填写模型名称。');
      if (response.status === 429) throw failure('服务商请求过于频繁，请稍后重试。');
      throw failure();
    }
    if (!reader || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw failure();
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      budget.bytes -= value.byteLength;
      if (budget.bytes < 0) throw failure('模型列表响应过大，请使用更精确的服务地址，或手动填写模型名称。');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader?.releaseLock();
  }
}

/** Only model identifiers and display names leave the operator's discovery request. */
export async function discoverModels({ baseUrl, protocol, apiKey }, fetchImpl = fetch, { timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const base = new URL(baseUrl);
    const root = base.href.replace(/\/+$/, '');
    const google = protocol === 'google';
    const anthropic = protocol === 'anthropic';
    const version = google ? (/\/(?:v1beta|v1)$/.test(base.pathname) ? '' : '/v1beta')
      : (base.pathname === '/' || (anthropic && !/\/v1$/.test(base.pathname))) ? '/v1' : '';
    const endpoint = new URL(`${root}${version}/models`);
    const headers = { Accept: 'application/json' };
    if (google) headers['x-goog-api-key'] = apiKey;
    else if (anthropic) { headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01'; }
    else if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (google) endpoint.searchParams.set('pageSize', '100');
    if (anthropic) endpoint.searchParams.set('limit', '100');
    const models = new Map();
    const cursors = new Set();
    const budget = { bytes: 2 * 1024 * 1024 };
    let truncated = false;
    for (let page = 0; page < 5; page++) {
      const response = await fetchImpl(endpoint.href, {
        method: 'GET', headers, redirect: 'error', signal: controller.signal,
      });
      const payload = await readCatalog(response, controller.signal, budget);
      const items = google ? payload?.models : payload?.data;
      if (!Array.isArray(items)) throw failure('服务商返回的模型列表格式不受支持，请手动填写模型名称。');
      for (const item of items) {
        if (google && Array.isArray(item?.supportedGenerationMethods) &&
            !item.supportedGenerationMethods.includes('generateContent')) continue;
        const id = safeText(google ? item?.name?.replace(/^models\//, '') : item?.id);
        if (!id || models.has(id)) continue;
        if (models.size >= 5000) { truncated = true; break; }
        const name = safeText(item?.displayName ?? item?.display_name ?? item?.name) || id;
        models.set(id, { id, name });
      }
      const more = google ? Boolean(payload.nextPageToken) : payload.has_more === true;
      if (!more) break;
      if (truncated || page === 4 || (!google && !anthropic)) { truncated = true; break; }
      const cursor = google ? payload.nextPageToken : payload.last_id;
      if (typeof cursor !== 'string' || !cursor || cursor.length > 2048) throw failure();
      if (cursors.has(cursor)) { truncated = true; break; }
      cursors.add(cursor);
      // Treat provider pagination as an opaque cursor, never as a destination URL.
      endpoint.searchParams.set(google ? 'pageToken' : 'after_id', cursor);
    }
    return { models: [...models.values()], truncated };
  } catch (error) {
    if (controller.signal.aborted) throw httpError(502, 'MODEL_DISCOVERY_TIMEOUT', '获取模型列表超时，请稍后重试或手动填写。');
    if (error.public) throw error;
    throw failure();
  } finally {
    clearTimeout(timer);
  }
}
