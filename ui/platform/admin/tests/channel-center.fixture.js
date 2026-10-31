import { test as base, expect } from '@playwright/test';

export const channel = {
  id: 'fixture-channel', name: '示例渠道', provider: '示例渠道', protocol: 'openai',
  baseUrl: 'https://provider.example.test/v1', hasApiKey: true, enabled: true, modelCount: 1,
};
export const model = {
  id: 'fixture-model', channelId: channel.id, channelName: channel.name, channelEnabled: true,
  name: '已有模型', upstreamModel: 'vendor/existing', enabled: true,
  inputPriceMicros: 1250000, outputPriceMicros: 2500000, maxInputTokens: 8192, maxOutputTokens: 1024,
  capabilities: ['text', 'tools'], appIds: ['chat'],
};
export const alpha = 'vendor/alpha:latest';
export const beta = 'vendor/beta';
export const inputPrice = '输入售价（元 / 百万 Token）';
export const outputPrice = '输出售价（元 / 百万 Token）';
export const mutations = (calls, path) => calls.filter(call => call.path === path && call.method !== 'GET');
export function noConnectionFields(body) {
  for (const field of ['apiKey', 'hasApiKey', 'baseUrl', 'protocol', 'provider']) {
    expect(body, `Model payload must not own ${field}`).not.toHaveProperty(field);
  }
}

// List refreshes see prior mutations, but no request reaches a real API or upstream.
export const test = base.extend({
  center: async ({ page, baseURL }, use) => {
    const state = {
      calls: [], errors: [], unexpected: [], intercept: null,
      channels: [structuredClone(channel)], models: [structuredClone(model)],
      apps: [{ id: 'chat', name: 'Chat', enabled: true, defaultModelId: model.id, modelIds: [model.id] }],
      discovery: {
        models: [{ id: model.upstreamModel, name: '已有上游模型' }, { id: alpha, name: 'Alpha' }, { id: beta, name: 'Beta' }],
        truncated: false,
      },
    };
    page.on('pageerror', error => state.errors.push(error.message));
    await page.addInitScript(() => sessionStorage.setItem('pilotdeck.admin.token', 'fixture-token'));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(baseURL).origin || url.pathname.startsWith('/api/')) {
        state.unexpected.push(`${route.request().method()} ${url.origin}${url.pathname}`);
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    await page.route('**/api/platform/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace('/api/platform', '');
      const method = request.method(), body = request.postDataJSON();
      state.calls.push({ path, method, body, authorization: request.headers().authorization });
      const json = (payload, status = 200) => route.fulfill({ json: payload, status });
      if (state.intercept && await state.intercept({ path, method, body, json, route })) return;
      if (path === '/me' && method === 'GET') return json({ user: { id: 'fixture-admin', role: 'admin', email: 'admin@example.test' } });
      if (path === '/admin/apps' && method === 'GET') return json({ apps: state.apps });
      if (path === '/admin/channels' && method === 'GET') {
        return json({ channels: state.channels.map(item => ({
          ...item, modelCount: state.models.filter(entry => entry.channelId === item.id).length,
        })) });
      }
      if (path === '/admin/models' && method === 'GET') {
        return json({ models: state.models.map(item => {
          const owner = state.channels.find(entry => entry.id === item.channelId);
          return { ...item, channelName: owner?.name, channelEnabled: owner?.enabled };
        }) });
      }
      if (path === '/admin/channels' && method === 'POST') {
        const { apiKey, ...fields } = body;
        const item = { ...fields, hasApiKey: Boolean(apiKey), modelCount: 0 };
        state.channels.push(item);
        return json({ channel: item }, 201);
      }
      const channelPath = /^\/admin\/channels\/([^/]+)(?:\/(discover|test|import))?$/.exec(path);
      if (channelPath) {
        const owner = state.channels.find(item => item.id === decodeURIComponent(channelPath[1]));
        if (owner && method === 'PATCH' && !channelPath[2]) {
          const { apiKey, ...fields } = body;
          Object.assign(owner, fields, apiKey ? { hasApiKey: true } : {});
          return json({ channel: owner });
        }
        if (owner && method === 'POST' && channelPath[2] === 'discover') return json(state.discovery);
        if (owner && method === 'POST' && channelPath[2] === 'test') return json({ ok: true, modelCount: state.discovery.models.length });
        if (owner && method === 'POST' && channelPath[2] === 'import') {
          const imported = [], skipped = [];
          for (const item of body.models) {
            if (state.models.some(existing => existing.channelId === owner.id && existing.upstreamModel === item.upstreamModel)) {
              skipped.push(item.upstreamModel);
            } else {
              const saved = { ...item, channelId: owner.id, channelName: owner.name, channelEnabled: owner.enabled };
              state.models.push(saved);
              imported.push(saved);
            }
          }
          return json({ models: imported, skipped }, 201);
        }
      }
      if (path === '/admin/models' && method === 'POST') {
        state.models.push(body);
        return json({ model: body }, 201);
      }
      const modelPath = /^\/admin\/models\/([^/]+)(?:\/(test))?$/.exec(path);
      if (modelPath) {
        const item = state.models.find(entry => entry.id === decodeURIComponent(modelPath[1]));
        if (item && method === 'PATCH' && !modelPath[2]) {
          Object.assign(item, body);
          return json({ model: item });
        }
        if (item && method === 'POST' && modelPath[2] === 'test') return json({ ok: true, upstreamStatus: 200 });
      }
      state.unexpected.push(`${method} ${path}`);
      return json({ error: 'Unhandled isolated fixture request' }, 500);
    });
    state.open = async () => {
      await page.goto('/#models');
      await expect(page.getByRole('tab', { name: /^模型渠道/ })).toBeVisible();
      await expect(page.getByRole('button', { name: '添加渠道', exact: true })).toBeVisible();
    };
    state.channelRow = () => page.getByRole('row').filter({ has: page.getByText(channel.name, { exact: true }) });
    state.discover = async () => {
      await state.channelRow().getByRole('button', { name: '获取模型', exact: true }).click();
      await expect(page.getByRole('heading', { name: `获取模型 · ${channel.name}`, exact: true })).toBeVisible();
    };
    state.modelsTab = () => page.getByRole('tab', { name: /^模型管理/ }).click();
    await use(state);
    expect(state.errors, 'Uncaught browser exceptions').toEqual([]);
    expect(state.unexpected, 'Every API and upstream request must be mocked').toEqual([]);
  },
});

export async function fillModel(page, upstream = 'vendor/manual') {
  await page.getByRole('combobox', { name: '所属渠道', exact: true }).selectOption(channel.id);
  await page.getByLabel('模型名称', { exact: true }).fill(upstream);
  await page.getByLabel(inputPrice, { exact: true }).fill('1.25');
  await page.getByLabel(outputPrice, { exact: true }).fill('2.5');
}
