import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { createPlatformApp } from './server/app.js';
import { installManagedClient } from '../server/managedClient.js';

test('operator configuration, customer redemption, local chat and learning share verified billing', async t => {
  const servers = [];
  let platform;
  let browser;
  t.after(async () => {
    await browser?.close();
    for (const server of servers) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    platform?.close();
  });
  const listen = async app => {
    const server = app.listen(0, '127.0.0.1'); servers.push(server); await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
  };
  const upstream = express(); upstream.use(express.json());
  let calls = 0;
  upstream.get('/v1/models', (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer fixture-provider-key');
    res.json({ data: [{ id: 'fixture-upstream' }, { id: 'fixture-second' }] });
  });
  upstream.post('/v1/chat/completions', (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer fixture-provider-key');
    assert.equal(req.body.model, 'fixture-upstream');
    calls++;
    res.json({ choices: [{ message: { role: 'assistant', content: 'Fixture verified answer' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
  });
  const providerUrl = await listen(upstream);
  const password = 'Isolated-fixture-password-123';
  platform = await createPlatformApp({ dbPath: ':memory:', encryptionKey: 'isolated-integration-key-never-production',
    bootstrapAdmin: { email: 'operator@example.test', password } });
  const cloud = await listen(platform.app);
  const api = async (endpoint, body, token, method = body ? 'POST' : 'GET') => {
    const response = await fetch(`${cloud}/api/platform${endpoint}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    assert.ok(response.ok, `${endpoint}: ${response.status} ${JSON.stringify(value)}`);
    return value;
  };
  const admin = await api('/auth/login', { email: 'operator@example.test', password, deviceId: 'operator-device' });
  await api('/admin/users', { email: 'customer@example.test', password }, admin.token);
  const customer = await api('/auth/login', { email: 'customer@example.test', password, deviceId: 'customer-device' });
  await api('/admin/channels', {
    id: 'fixture-channel', name: '测试渠道', provider: 'deepseek', protocol: 'openai',
    baseUrl: `${providerUrl}/v1`, apiKey: 'fixture-provider-key', enabled: true,
  }, admin.token);
  await api('/admin/models', {
    id: 'fixture-model', name: '测试模型', channelId: 'fixture-channel',
    upstreamModel: 'fixture-upstream', enabled: true,
    inputPriceMicros: 1000000, outputPriceMicros: 2000000, maxInputTokens: 4096, maxOutputTokens: 256, capabilities: ['text', 'tools'],
  }, admin.token);
  await api('/admin/apps', { apps: ['chat', 'learning', 'automation'].map(id => ({
    id, name: id, enabled: true, defaultModelId: 'fixture-model', modelIds: ['fixture-model'],
  })) }, admin.token, 'PUT');
  const batch = await api('/admin/codes', { count: 1, amountMicros: 1000000, requestId: 'integration-batch' }, admin.token);
  await api('/redeem', { code: batch.codes[0].code }, customer.token);
  const local = express(); local.use(express.json());
  installManagedClient(local, { env: {
    PILOTDECK_MANAGED_URL: cloud, PILOTDECK_MANAGED_TOKEN: customer.token,
    PILOTDECK_MANAGED_USER_ID: customer.user.id, PILOTDECK_MANAGED_LOCAL_KEY: 'fixture-local-key',
  } });
  const client = await listen(local);
  const send = async (endpoint, body) => {
    const response = await fetch(`${client}/api/managed${endpoint}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer fixture-local-key' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    assert.ok(response.ok, JSON.stringify(data));
    return data;
  };
  const catalog = await send('/learning/models');
  assert.equal(catalog.items[0].id, 'fixture-model');
  assert.equal(JSON.stringify(catalog).includes('fixture-provider-key'), false);
  const completion = await send('/relay/chat/fixture-model/v1/chat/completions', {
    messages: [{ role: 'user', content: 'hello' }], max_tokens: 100,
  });
  assert.equal(completion.choices[0].message.content, 'Fixture verified answer');
  const learning = await send('/learning/complete', { messages: [{ role: 'user', content: 'explain AI' }] });
  assert.equal(learning.answer, 'Fixture verified answer');
  assert.equal(calls, 2);
  const wallet = await api('/wallet', undefined, customer.token);
  assert.equal(wallet.availableMicros, 999720);
  assert.equal(wallet.heldMicros, 0);
  const ledger = await api('/ledger', undefined, customer.token);
  assert.equal(ledger.ledger.filter(row => row.kind === 'usage').length, 2);

  const { createManagedAutomationRuntime } = await import('../../dist/src/model/ManagedAutomationRuntime.js');
  const automation = await createManagedAutomationRuntime({
    PILOTDECK_MANAGED_URL: cloud, SERVER_PORT: new URL(client).port,
    PILOTDECK_MANAGED_LOCAL_KEY: 'fixture-local-key',
  }, 'cron:integration-task', { provider: 'managed_fixture-model', model: 'fixture-model' });
  const taskRequest = {
    provider: 'managed_fixture-model', model: 'fixture-model',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Run the scheduled task' }] }], maxOutputTokens: 100,
  };
  await automation.model.complete(taskRequest);
  assert.equal(calls, 3);
  const automationLedger = await api('/ledger', undefined, customer.token);
  const usage = automationLedger.ledger.filter(row => row.kind === 'usage');
  assert.equal(usage.length, 3);
  assert.equal(usage.filter(row => row.call?.appId === 'automation').length, 1);
  assert.ok(usage.every(row => row.call?.inputTokens === 100 && row.call?.outputTokens === 20));
  await api('/admin/apps', { apps: [{ id: 'automation', name: 'Automation', enabled: false,
    defaultModelId: 'fixture-model', modelIds: ['fixture-model'] }] }, admin.token, 'PUT');
  await assert.rejects(automation.model.complete(taskRequest), /authorization failed/);
  assert.equal(calls, 3, 'Revoked automation must never fall back to chat');

  if (process.env.PLATFORM_BROWSER_TEST === '1') {
    const { chromium } = await import('@playwright/test');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(cloud);
    await page.getByLabel('邮箱', { exact: true }).fill('operator@example.test');
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByText('customer@example.test', { exact: true }).waitFor();
    for (const label of ['模型与价格', '应用管理', '兑换码', '账务管理', '注册与默认值', '客户端版本']) {
      await page.getByRole('link', { name: label, exact: true }).click();
      await page.getByRole('heading', { name: label, exact: true }).waitFor();
      assert.equal(await page.getByRole('alert').count(), 0, `Unexpected error on ${label}`);
      if (label === '账务管理') {
        await page.getByText('输入 100 / 输出 20 Token', { exact: true }).first().waitFor();
        await page.screenshot({ path: '.pilotdeck/platform/verified-admin-ledger.png', fullPage: true });
      }
    }
    await page.getByRole('link', { name: '模型与价格', exact: true }).click();
    await page.getByRole('button', { name: '获取模型', exact: true }).click();
    await page.getByRole('checkbox', { name: '选择 fixture-second', exact: true }).check();
    assert.equal(await page.getByRole('checkbox', { name: '选择 fixture-upstream', exact: true }).isDisabled(), true);
    await page.getByLabel('输入售价 fixture-second', { exact: true }).fill('0.5');
    await page.getByLabel('输出售价 fixture-second', { exact: true }).fill('1.2');
    await page.getByRole('dialog').getByRole('checkbox', { name: '学习', exact: true }).check();
    await page.getByRole('button', { name: '导入选中模型', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByText('fixture-second', { exact: true }).first().waitFor();
    const imported = (await api('/admin/models', undefined, admin.token)).models.find(model => model.upstreamModel === 'fixture-second');
    assert.ok(imported);
    assert.equal(imported.channelId, 'fixture-channel');
    assert.equal(imported.enabled, false);
    assert.equal(imported.inputPriceMicros, 500000);
    assert.equal(imported.outputPriceMicros, 1200000);
    assert.deepEqual(imported.appIds, ['learning']);
    assert.deepEqual((await send('/learning/models')).items.map(model => model.id), ['fixture-model']);
    assert.equal(calls, 3, 'Discovery and import must not generate paid requests');
    await page.screenshot({ path: '.pilotdeck/platform/verified-channel-model-center.png', fullPage: true });
    await page.getByRole('link', { name: '用户管理', exact: true }).click();
    await page.getByText('customer@example.test', { exact: true }).waitFor();
    await page.screenshot({ path: '.pilotdeck/platform/verified-admin-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: '.pilotdeck/platform/verified-admin-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
  }
});
