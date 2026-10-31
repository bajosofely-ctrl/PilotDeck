import { expect } from '@playwright/test';
import { test, channel, model, alpha, beta, inputPrice, outputPrice, mutations, noConnectionFields, fillModel } from './channel-center.fixture.js';

test('channel presets support official OpenAI parameters and keyless Ollama without extra model fields', async ({ page, center }) => {
  await center.open();
  for (const [preset, provider] of [['openai-official', 'openai'], ['ollama', 'ollama']]) {
    await page.getByRole('button', { name: '添加渠道', exact: true }).click();
    await page.getByLabel('渠道名称', { exact: true }).fill(`Preset ${provider}`);
    await page.getByLabel('服务地址', { exact: true }).fill('http://127.0.0.1:11434/v1');
    await page.getByRole('combobox', { name: '接口协议', exact: true }).selectOption(preset);
    if (provider === 'openai') await page.getByLabel('API Key', { exact: true }).fill('fixture-openai-key');
    await page.getByLabel('启用此渠道').check();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const body = mutations(center.calls, '/admin/channels').at(-1).body;
    expect(body).toMatchObject({ protocol: 'openai', provider, enabled: true });
    if (provider === 'ollama') expect(body).not.toHaveProperty('apiKey');
    const row = page.getByRole('row').filter({ has: page.getByText(`Preset ${provider}`, { exact: true }) });
    await row.getByRole('button', { name: '编辑渠道', exact: true }).click();
    await expect(page.getByRole('combobox', { name: '接口协议', exact: true })).toHaveValue(preset);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  }
});

test('Google discovery treats models-prefixed saved names as already imported', async ({ page, center }) => {
  center.channels[0].protocol = 'google';
  center.models[0].upstreamModel = 'models/gemini-fixture';
  center.discovery = { models: [{ id: 'gemini-fixture', name: 'Gemini' }], truncated: false };
  await center.open();
  await center.discover();
  await expect(page.getByRole('checkbox', { name: '选择 gemini-fixture', exact: true })).toBeDisabled();
  await expect(page.getByRole('cell', { name: '已导入', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '导入选中模型', exact: true })).toBeDisabled();
});

test('navigation keeps distinct channel and model forms without connection fields in models', async ({ page, center }, testInfo) => {
  await center.open();
  await expect(page.getByRole('link', { name: '模型与价格', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^模型渠道/ })).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: testInfo.outputPath('desktop-channels-table.png'), fullPage: true });
  await page.getByRole('button', { name: '添加渠道', exact: true }).click();
  for (const label of ['渠道名称', '服务地址', 'API Key', '启用此渠道']) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('combobox', { name: '接口协议', exact: true })).toBeVisible();
  await expect(page.getByLabel(inputPrice, { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('模型名称', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('desktop-channel-form.png'), fullPage: true });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await center.modelsTab();
  await page.screenshot({ path: testInfo.outputPath('desktop-models-table.png'), fullPage: true });
  await page.getByRole('button', { name: '添加模型', exact: true }).click();
  for (const label of ['模型名称', '显示名称', inputPrice, outputPrice, '启用此模型']) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('combobox', { name: '所属渠道', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '聊天', exact: true })).toBeVisible();
  for (const label of ['API Key', '服务地址', '接口协议', '模型标识', '服务商']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
  }
  await expect(page.getByLabel('最大输入 Token', { exact: true })).not.toBeVisible();
  await expect(page.getByLabel('启用此模型', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel(inputPrice, { exact: true })).toHaveValue('');
  await expect(page.getByLabel(outputPrice, { exact: true })).toHaveValue('');
  await page.screenshot({ path: testInfo.outputPath('desktop-manual-model-form.png'), fullPage: true });
});

test('channel creation keeps its ID on failure and editing omits the unchanged key', async ({ page, center }) => {
  let attempts = 0;
  center.intercept = async ({ path, method, json }) => {
    if (path === '/admin/channels' && method === 'POST' && attempts++ === 0) {
      await json({ error: '测试保存失败，请重试' }, 503); return true;
    }
  };
  await center.open();
  await page.getByRole('button', { name: '添加渠道', exact: true }).click();
  await page.getByLabel('渠道名称', { exact: true }).fill('新建渠道');
  await page.getByLabel('服务地址', { exact: true }).fill('https://new.example.test/v1');
  await page.getByRole('combobox', { name: '接口协议', exact: true }).selectOption('openai-responses');
  await page.getByLabel('API Key', { exact: true }).fill('fixture-only-key');
  await page.getByRole('button', { name: '显示密钥', exact: true }).click();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: '隐藏密钥', exact: true }).click();
  await expect(page.getByLabel('API Key', { exact: true })).toHaveAttribute('type', 'password');
  await page.getByLabel('启用此渠道', { exact: true }).check();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('测试保存失败');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saves = mutations(center.calls, '/admin/channels');
  expect(saves).toHaveLength(2);
  expect(saves[0].body).toEqual(saves[1].body);
  expect(saves[0].body.id).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/);
  expect(saves[1].body).toMatchObject({
    name: '新建渠道', protocol: 'openai-responses', baseUrl: 'https://new.example.test/v1',
    apiKey: 'fixture-only-key', enabled: true,
  });
  const row = page.getByRole('row').filter({ has: page.getByText('新建渠道', { exact: true }) });
  await row.getByRole('button', { name: '编辑渠道', exact: true }).click();
  await expect(page.getByLabel('API Key（留空保留现有密钥）', { exact: true })).toHaveValue('');
  await page.getByLabel('渠道名称', { exact: true }).fill('重命名渠道');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const edited = mutations(center.calls, `/admin/channels/${saves[1].body.id}`).at(-1).body;
  for (const key of ['apiKey', 'hasApiKey', 'id']) expect(edited).not.toHaveProperty(key);
  expect(edited.name).toBe('重命名渠道');
  expect(await page.locator('body').innerText()).not.toContain('fixture-only-key');
});

test('changing a saved channel endpoint or protocol requires an explicit replacement key', async ({ page, center }) => {
  await center.open();
  await center.channelRow().getByRole('button', { name: '编辑渠道', exact: true }).click();
  await page.getByLabel('服务地址', { exact: true }).fill('https://other.example.test/v1');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('新的 API Key');
  expect(mutations(center.calls, `/admin/channels/${channel.id}`)).toHaveLength(0);
  await page.getByLabel('服务地址', { exact: true }).fill(channel.baseUrl);
  await page.getByRole('combobox', { name: '接口协议', exact: true }).selectOption('anthropic');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('新的 API Key');
  expect(mutations(center.calls, `/admin/channels/${channel.id}`)).toHaveLength(0);
  await page.getByLabel('API Key（留空保留现有密钥）', { exact: true }).fill('fixture-replacement-key');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(mutations(center.calls, `/admin/channels/${channel.id}`).at(-1).body).toMatchObject({
    protocol: 'anthropic', baseUrl: channel.baseUrl, apiKey: 'fixture-replacement-key',
  });
});

test('channel and model connectivity and enable actions use separate endpoints', async ({ page, center }) => {
  await center.open();
  await center.channelRow().getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('连接成功');
  expect(mutations(center.calls, `/admin/channels/${channel.id}/test`).at(-1).body).toEqual({});
  expect(mutations(center.calls, `/admin/models/${model.id}/test`)).toHaveLength(0);
  await center.channelRow().getByRole('button', { name: '停用渠道', exact: true }).click();
  await expect(center.channelRow().getByRole('button', { name: '启用渠道', exact: true })).toBeVisible();
  expect(mutations(center.calls, `/admin/channels/${channel.id}`).at(-1).body).toEqual({ enabled: false });
  expect(center.models[0].enabled).toBe(true);
  await center.modelsTab();
  await expect(page.getByText('渠道已停用', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /^模型渠道/ }).click();
  await center.channelRow().getByRole('button', { name: '启用渠道', exact: true }).click();
  await expect(center.channelRow().getByRole('button', { name: '停用渠道', exact: true })).toBeVisible();
  await center.modelsTab();
  const row = page.getByRole('row').filter({ has: page.getByText(model.name, { exact: true }) });
  await row.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('连接成功');
  expect(mutations(center.calls, `/admin/models/${model.id}/test`).at(-1).body).toEqual({});
  await row.getByRole('button', { name: '停用模型', exact: true }).click();
  await expect(row.getByRole('button', { name: '启用模型', exact: true })).toBeVisible();
  expect(mutations(center.calls, `/admin/models/${model.id}`).at(-1).body).toEqual({ enabled: false });
  expect(center.channels[0].enabled).toBe(true);
  await row.getByRole('button', { name: '启用模型', exact: true }).click();
  await expect(row.getByRole('button', { name: '停用模型', exact: true })).toBeVisible();
});

test('model editing preserves exact RMB, capabilities and limits while atomically changing apps', async ({ page, center }) => {
  // publicModel still returns read-only connection summaries for compatibility.
  Object.assign(center.models[0], {
    provider: channel.provider, protocol: channel.protocol, baseUrl: channel.baseUrl, hasApiKey: true,
  });
  await center.open();
  await center.modelsTab();
  await page.getByRole('button', { name: '编辑模型', exact: true }).click();
  await expect(page.getByLabel(inputPrice, { exact: true })).toHaveValue('1.25');
  await expect(page.getByRole('combobox', { name: '所属渠道', exact: true })).toHaveValue(channel.id);
  await expect(page.getByRole('checkbox', { name: '聊天', exact: true })).toBeChecked();
  await page.getByRole('checkbox', { name: '聊天', exact: true }).uncheck();
  await page.getByLabel(inputPrice, { exact: true }).fill('0.000001');
  await page.getByLabel(outputPrice, { exact: true }).fill('3.123456');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const body = mutations(center.calls, `/admin/models/${model.id}`).at(-1).body;
  expect(body).toMatchObject({
    channelId: channel.id, inputPriceMicros: 1, outputPriceMicros: 3123456, appIds: [],
    maxInputTokens: model.maxInputTokens, maxOutputTokens: model.maxOutputTokens, capabilities: model.capabilities,
  });
  expect(body).not.toHaveProperty('id');
  noConnectionFields(body);
  expect(mutations(center.calls, '/admin/apps')).toHaveLength(0);
});

test('manual models retain IDs after save failure and preserve explicit advanced settings', async ({ page, center }) => {
  let attempts = 0;
  center.intercept = async ({ path, method, json }) => {
    if (path === '/admin/models' && method === 'POST' && attempts++ === 0) {
      await json({ error: '测试保存失败，请重试' }, 503); return true;
    }
  };
  await center.open();
  await center.modelsTab();
  const ids = [];
  for (const upstream of ['vendor/manual-one', 'vendor/manual-two']) {
    await page.getByRole('button', { name: '添加模型', exact: true }).click();
    await fillModel(page, upstream);
    await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue(upstream);
    await page.getByLabel('显示名称', { exact: true }).fill('运营名称');
    await page.getByLabel('模型名称', { exact: true }).fill(`${upstream}-edited`);
    await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('运营名称');
    await page.getByRole('checkbox', { name: '聊天', exact: true }).check();
    await page.getByText('高级设置', { exact: true }).click();
    await expect(page.getByLabel('最大输入 Token', { exact: true })).toHaveValue('65536');
    await expect(page.getByLabel('最大输出 Token', { exact: true })).toHaveValue('1024');
    await page.getByLabel('最大输入 Token', { exact: true }).fill('16384');
    await page.getByLabel('最大输出 Token', { exact: true }).fill('2048');
    await page.getByRole('checkbox', { name: '工具调用', exact: true }).check();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    if (!ids.length) {
      await expect(page.getByRole('alert')).toContainText('测试保存失败');
      await page.getByRole('button', { name: '保存', exact: true }).click();
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const body = mutations(center.calls, '/admin/models').at(-1).body;
    expect(body).toMatchObject({
      channelId: channel.id, upstreamModel: `${upstream}-edited`, name: '运营名称', appIds: ['chat'],
      inputPriceMicros: 1250000, outputPriceMicros: 2500000, enabled: false,
      maxInputTokens: 16384, maxOutputTokens: 2048, capabilities: ['text', 'tools'],
    });
    noConnectionFields(body);
    expect(body.id).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/);
    ids.push(body.id);
  }
  expect(new Set(ids).size).toBe(2);
  const saves = mutations(center.calls, '/admin/models');
  expect(saves[0].body).toEqual(saves[1].body);
});

test('discovery fetches on mount without credentials and protects same-channel duplicates', async ({ page, center }, testInfo) => {
  center.channels.push({ ...channel, id: 'other-channel', name: '另一渠道' });
  center.models.push({ ...model, id: 'other-model', channelId: 'other-channel', upstreamModel: beta });
  center.discovery.truncated = true;
  await center.open();
  await center.discover();
  await expect(page.getByRole('checkbox', { name: `选择 ${model.upstreamModel}`, exact: true })).toBeDisabled();
  await expect(page.getByRole('row').filter({ has: page.getByRole('checkbox', { name: `选择 ${model.upstreamModel}`, exact: true }) })).toContainText('已导入');
  for (const label of [`名称 ${model.upstreamModel}`, `输入售价 ${model.upstreamModel}`, `输出售价 ${model.upstreamModel}`, `启用 ${model.upstreamModel}`]) {
    await expect(page.getByLabel(label, { exact: true })).toBeDisabled();
  }
  await expect(page.getByRole('checkbox', { name: `选择 ${beta}`, exact: true })).toBeEnabled();
  const requests = mutations(center.calls, `/admin/channels/${channel.id}/discover`);
  expect(requests).toHaveLength(1);
  expect(requests[0].body).toEqual({});
  expect(requests[0].authorization).toBe('Bearer fixture-token');
  expect(mutations(center.calls, '/admin/models')).toHaveLength(0);
  await expect(page.getByText(/仅.*部分模型/)).toBeVisible();
  await page.getByRole('checkbox', { name: '全选当前结果', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: `选择 ${model.upstreamModel}`, exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: `选择 ${alpha}`, exact: true })).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('desktop-channel-discovery.png'), fullPage: true });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(mutations(center.calls, `/admin/channels/${channel.id}/import`)).toHaveLength(0);
});

test('filtered bulk prices import selected models with exact RMB and stable IDs on retry', async ({ page, center }, testInfo) => {
  let attempts = 0;
  center.intercept = async ({ path, method, json }) => {
    if (path === `/admin/channels/${channel.id}/import` && method === 'POST' && attempts++ === 0) {
      await json({ error: '测试导入失败，请重试' }, 503); return true;
    }
  };
  await center.open();
  await center.discover();
  await page.getByRole('dialog').getByLabel('搜索模型', { exact: true }).fill('ALPHA');
  await expect(page.getByRole('checkbox', { name: `选择 ${beta}`, exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: '全选当前结果', exact: true }).check();
  await page.getByLabel(inputPrice, { exact: true }).fill('0.000001');
  await page.getByLabel(outputPrice, { exact: true }).fill('3.123456');
  await page.getByRole('button', { name: '应用到已选', exact: true }).click();
  await expect(page.getByLabel(`输入售价 ${alpha}`, { exact: true })).toHaveValue('0.000001');
  await page.getByLabel(`名称 ${alpha}`, { exact: true }).fill('运营 Alpha');
  await expect(page.getByLabel(`启用 ${alpha}`, { exact: true })).not.toBeChecked();
  await page.getByRole('dialog').getByLabel('搜索模型', { exact: true }).fill('');
  await expect(page.getByRole('checkbox', { name: `选择 ${alpha}`, exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: `选择 ${beta}`, exact: true })).not.toBeChecked();
  await expect(page.getByLabel(`输入售价 ${beta}`, { exact: true })).toHaveValue('');
  await page.getByRole('checkbox', { name: `选择 ${beta}`, exact: true }).check();
  await page.getByLabel(`输入售价 ${beta}`, { exact: true }).fill('0');
  await page.getByLabel(`输出售价 ${beta}`, { exact: true }).fill('0');
  await page.getByLabel(`启用 ${beta}`, { exact: true }).check();
  await page.getByLabel(`能力 ${beta}`, { exact: true }).selectOption('text,tools');
  await page.getByRole('checkbox', { name: '聊天', exact: true }).check();
  await page.screenshot({ path: testInfo.outputPath('desktop-batch-import.png'), fullPage: true });
  await page.getByRole('button', { name: '导入选中模型', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('测试导入失败');
  await page.getByRole('button', { name: '导入选中模型', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const requests = mutations(center.calls, `/admin/channels/${channel.id}/import`);
  expect(requests).toHaveLength(2);
  expect(requests[0].body).toEqual(requests[1].body);
  const rows = requests[1].body.models;
  expect(rows).toHaveLength(2);
  expect(rows.find(item => item.upstreamModel === alpha)).toMatchObject({
    name: '运营 Alpha', inputPriceMicros: 1, outputPriceMicros: 3123456, enabled: false, appIds: ['chat'],
  });
  expect(rows.find(item => item.upstreamModel === beta)).toMatchObject({
    inputPriceMicros: 0, outputPriceMicros: 0, enabled: true, capabilities: ['text', 'tools'], appIds: ['chat'],
  });
  expect(new Set(rows.map(item => item.id)).size).toBe(2);
  for (const item of rows) {
    expect(item.id).toMatch(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/);
    noConnectionFields(item);
  }
  expect(center.models.find(item => item.id === model.id)).toEqual(model);
  await expect(page.getByRole('tab', { name: /^模型管理/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('运营 Alpha', { exact: true })).toBeVisible();
  expect(mutations(center.calls, '/admin/models')).toHaveLength(0);
});

test('import requires selected rows and explicit prices, including hidden selected rows, and accepts zero', async ({ page, center }) => {
  await center.open();
  await center.discover();
  await expect(page.getByRole('button', { name: '导入选中模型', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: `选择 ${alpha}`, exact: true }).check();
  await page.getByRole('dialog').getByLabel('搜索模型', { exact: true }).fill('Beta');
  await page.getByRole('button', { name: '导入选中模型', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('输入和输出售价');
  expect(mutations(center.calls, `/admin/channels/${channel.id}/import`)).toHaveLength(0);
  await page.getByRole('dialog').getByLabel('搜索模型', { exact: true }).fill('');
  await page.getByLabel(`输入售价 ${alpha}`, { exact: true }).fill('0');
  await page.getByLabel(`输出售价 ${alpha}`, { exact: true }).fill('0');
  await page.getByRole('button', { name: '导入选中模型', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(mutations(center.calls, `/admin/channels/${channel.id}/import`).at(-1).body.models).toEqual([
    expect.objectContaining({ upstreamModel: alpha, inputPriceMicros: 0, outputPriceMicros: 0, enabled: false }),
  ]);
});

test('discovery error and empty results allow retry and manual entry on the same channel', async ({ page, center }) => {
  let attempts = 0;
  center.intercept = async ({ path, json }) => {
    if (path === `/admin/channels/${channel.id}/discover`) {
      if (attempts++ === 0) await json({ error: '隔离测试：模型列表暂不可用' }, 502);
      else await json({ models: [], truncated: false });
      return true;
    }
  };
  await center.open();
  await center.discover();
  await expect(page.getByRole('alert')).toContainText('模型列表暂不可用');
  await page.getByRole('button', { name: '重新获取', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(/未获取到模型/)).toBeVisible();
  expect(mutations(center.calls, `/admin/channels/${channel.id}/discover`)).toHaveLength(2);
  await page.getByRole('button', { name: '手动添加模型', exact: true }).click();
  await expect(page.getByRole('heading', { name: '添加模型', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.getByRole('combobox', { name: '所属渠道', exact: true })).toHaveValue(channel.id);
  await fillModel(page, 'manual-after-empty');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved = mutations(center.calls, '/admin/models').at(-1).body;
  noConnectionFields(saved);
  expect(saved).toMatchObject({ channelId: channel.id, upstreamModel: 'manual-after-empty', enabled: false });
  expect(mutations(center.calls, `/admin/channels/${channel.id}/import`)).toHaveLength(0);
});

test('closed discovery aborts requests and ignores late responses after reopening or manual fallback', async ({ page, center }) => {
  await center.open();
  // Ignore AbortSignal here deliberately: cancelled transports must not publish late results.
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    window.discoveryPending = [];
    window.fetch = (url, init) => String(url).endsWith('/discover')
      ? new Promise(resolve => window.discoveryPending.push({
        signal: init.signal,
        finish: id => resolve(new Response(JSON.stringify({ models: [{ id, name: id }], truncated: false }), { status: 200 })),
      }))
      : original(url, init);
  });
  await center.discover();
  await expect.poll(() => page.evaluate(() => window.discoveryPending.length)).toBe(1);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  expect(await page.evaluate(() => window.discoveryPending[0].signal.aborted)).toBe(true);
  await center.discover();
  await expect.poll(() => page.evaluate(() => window.discoveryPending.length)).toBe(2);
  await page.evaluate(() => window.discoveryPending[1].finish('fresh-result'));
  await expect(page.getByRole('checkbox', { name: '选择 fresh-result', exact: true })).toBeVisible();
  await page.evaluate(() => window.discoveryPending[0].finish('stale-result'));
  await expect(page.getByRole('checkbox', { name: '选择 stale-result', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: '选择 fresh-result', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '重新获取', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.discoveryPending.length)).toBe(3);
  await page.getByRole('button', { name: '手动添加模型', exact: true }).click();
  expect(await page.evaluate(() => window.discoveryPending[2].signal.aborted)).toBe(true);
  await page.evaluate(() => window.discoveryPending[2].finish('closed-result'));
  await expect(page.getByRole('heading', { name: '添加模型', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '选择 closed-result', exact: true })).toHaveCount(0);
  expect(center.calls.filter(call => call.method !== 'GET')).toEqual([]);
});

test('mobile channel tables, batch import and model forms stay within the viewport', async ({ page, center }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await center.open();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-channels-table.png'), fullPage: true });
  await page.getByRole('button', { name: '添加渠道', exact: true }).click();
  expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-channel-form.png'), fullPage: true });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await center.discover();
  await expect(page.getByRole('checkbox', { name: `选择 ${alpha}`, exact: true })).toBeVisible();
  expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-batch-import.png'), fullPage: true });
  await page.getByRole('checkbox', { name: `选择 ${alpha}`, exact: true }).check();
  await page.getByLabel(inputPrice, { exact: true }).fill('1.25');
  await page.getByLabel(outputPrice, { exact: true }).fill('2.5');
  await page.getByRole('button', { name: '应用到已选', exact: true }).click();
  await page.getByLabel(`输出售价 ${alpha}`, { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByLabel(`输出售价 ${alpha}`, { exact: true })).toHaveValue('2.5');
  await page.screenshot({ path: testInfo.outputPath('mobile-batch-import-prices.png'), fullPage: true });
  await page.getByRole('button', { name: '导入选中模型', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: '导入选中模型', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('mobile-batch-import-actions.png'), fullPage: true });
  await page.getByRole('button', { name: '手动添加模型', exact: true }).click();
  await fillModel(page);
  await page.getByText('高级设置', { exact: true }).click();
  expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-model-form.png'), fullPage: true });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await center.modelsTab();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-models-table.png'), fullPage: true });
});
