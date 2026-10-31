import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createPlatformApp } from './server/app.js';

test('customer desktop registers, signs in, redeems, chats, opens learning and isolates accounts', {
  skip: process.env.CUSTOMER_DESKTOP_TEST !== '1', timeout: 360000,
}, async t => {
  const { _electron } = await import('@playwright/test');
  const requireDesktop = createRequire(new URL('../../apps/desktop/package.json', import.meta.url));
  const root = path.resolve(import.meta.dirname, '../..');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pilotdeck-customer-desktop-'));
  const packagedExecutable = process.env.CUSTOMER_DESKTOP_EXECUTABLE;
  const screenshots = path.join(root, '.pilotdeck', packagedExecutable ? 'packaging-verification' : 'platform');
  await mkdir(screenshots, { recursive: true });
  let desktop;
  let platform;
  let server;
  let completed = false;
  t.after(async () => {
    if (desktop && !completed) {
      for (const [index, page] of desktop.windows().entries()) {
        await page.screenshot({ path: path.join(screenshots, `failure-${index}.png`) }).catch(() => {});
        await writeFile(path.join(screenshots, `failure-${index}.txt`),
          `${page.url()}\n${await page.locator('body').innerText().catch(() => '')}`).catch(() => {});
      }
    }
    if (desktop) {
      for (const page of desktop.windows()) {
        if (page.url().startsWith('http://127.0.0.1:')) {
          const loginWindow = desktop.waitForEvent('window', { timeout: 30000 });
          await page.evaluate(() => window.pilotdeckDesktop.managedLogout()).catch(() => {});
          const login = await loginWindow;
          await login.locator('#email').waitFor();
        }
      }
      await desktop.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); }).catch(() => {});
      await desktop.close().catch(() => {});
    }
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    platform?.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  const password = 'Desktop-fixture-only-123';
  let providerCalls = 0;
  const mailbox = new Map();
  platform = await createPlatformApp({
    dbPath: path.join(directory, 'platform.sqlite'),
    encryptionKey: 'isolated-desktop-fixture-encryption-key',
    bootstrapAdmin: { email: 'operator@example.test', password },
    sendCode: async ({ email, code }) => { mailbox.set(email, code); },
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'https://desktop-fixture.example/v1/chat/completions');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'fixture-upstream');
      providerCalls++;
      const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
      const answer = 'Desktop managed chat verified.';
      if (!body.stream) return Response.json({ choices: [{ message: { role: 'assistant', content: answer } }], usage });
      const chunk = { id: 'fixture-completion', object: 'chat.completion.chunk', model: 'fixture-upstream', created: 1 };
      return new Response([
        { ...chunk, choices: [{ index: 0, delta: { role: 'assistant', content: answer }, finish_reason: null }] },
        { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
        { ...chunk, choices: [], usage },
      ].map(value => `data: ${JSON.stringify(value)}\n\n`).join('') + 'data: [DONE]\n\n', {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    },
  });
  // A packaged local-test client has a fixed service origin. The caller must
  // stop its local service first; listen fails if that port is still occupied.
  server = platform.app.listen(packagedExecutable ? 3100 : 0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = async (endpoint, body, token, method = body ? 'POST' : 'GET') => {
    const response = await fetch(`${origin}/api/platform${endpoint}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    assert.ok(response.ok, `${endpoint}: ${JSON.stringify(data)}`);
    return data;
  };
  const admin = await api('/auth/login', { email: 'operator@example.test', password, deviceId: 'fixture-admin' });
  await api('/admin/users', { email: 'first@example.test', password }, admin.token);
  const batch = await api('/admin/codes', { amountMicros: 2000000, count: 1, requestId: 'desktop-test-code' }, admin.token);
  const env = { ...process.env, PILOTDECK_MANAGED_URL: origin,
    PILOTDECK_DESKTOP_NODE: process.execPath };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PILOTDECK_DESKTOP_RUNTIME_ROOT;
  if (packagedExecutable) {
    delete env.PILOTDECK_DESKTOP_NODE;
    delete env.PILOTDECK_MANAGED_URL;
  }
  desktop = await _electron.launch({
    executablePath: packagedExecutable || requireDesktop('electron'),
    args: [...(packagedExecutable ? [] : [path.join(root, 'apps/desktop')]), `--user-data-dir=${path.join(directory, 'desktop')}`],
    cwd: root, env, timeout: 60000,
  });
  if (packagedExecutable) {
    const packaged = await desktop.evaluate(({ app }) => ({
      packaged: app.isPackaged, name: app.getName(), service: process.env.PILOTDECK_MANAGED_URL,
      nodeOverride: process.env.PILOTDECK_DESKTOP_NODE,
    }));
    assert.equal(packaged.packaged, true);
    assert.equal(packaged.name, 'PilotDeck Local Test');
    assert.equal(packaged.service, 'http://127.0.0.1:3100');
    assert.equal(packaged.nodeOverride, undefined);
  }
  const capture = async (page, name) => {
    const png = await desktop.evaluate(async ({ BrowserWindow }, url) => {
      const owner = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === url);
      if (!owner) throw new Error('Customer window is missing');
      owner.show();
      const image = await owner.capturePage();
      if (image.isEmpty()) throw new Error('Customer window capture is empty');
      return image.toPNG().toString('base64');
    }, page.url());
    await writeFile(path.join(screenshots, name), Buffer.from(png, 'base64'));
  };
  const login = await desktop.firstWindow();
  await login.locator('#email').waitFor();
  await login.screenshot({ path: path.join(screenshots, 'customer-login.png') });
  const signIn = async (page, email) => {
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    const next = desktop.waitForEvent('window');
    await page.locator('#submit').click();
    const client = await next;
    await client.waitForURL('**/account', { timeout: 120000 });
    await client.getByRole('heading', { name: '我的账户', exact: true }).waitFor();
    await client.getByText(email, { exact: true }).first().waitFor();
    return client;
  };
  let client = await signIn(login, 'first@example.test');
  await client.getByText('暂未开放对话模型，请联系管理员。', { exact: true }).waitFor();
  await client.getByLabel('兑换码', { exact: true }).fill(batch.codes[0].code);
  await client.getByRole('button', { name: '兑换', exact: true }).click();
  await client.getByText('兑换成功，余额已更新。', { exact: true }).waitFor();
  await client.getByText('兑换充值', { exact: true }).waitFor();
  await client.screenshot({ path: path.join(screenshots, 'customer-account.png') });
  await client.evaluate(() => localStorage.setItem('fixture-account-marker', 'first-account'));
  const clientOrigin = new URL(client.url()).origin;
  await client.goto(`${clientOrigin}/settings/models`);
  await client.getByRole('heading', { name: '可用模型', exact: true }).first().waitFor();
  assert.equal(await client.locator('input[type=password]').count(), 0);
  await client.goto(`${clientOrigin}/education`);
  await client.getByRole('heading', { name: '学习', exact: true }).waitFor({ timeout: 30000 });
  await client.screenshot({ path: path.join(screenshots, 'customer-learning.png') });
  await client.getByRole('button', { name: /AI 通识与实验/ }).click();
  await client.locator('iframe.education-frame').waitFor({ timeout: 30000 });
  await client.frameLocator('iframe.education-frame').locator('body').waitFor();
  assert.ok(await client.frameLocator('iframe.education-frame').locator('body').innerText());
  await capture(client, 'customer-learning-module.png');
  await client.goto(`${clientOrigin}/account`);
  await api('/admin/channels', {
    id: 'desktop-channel', name: 'Desktop fixture', provider: 'openai', protocol: 'openai',
    baseUrl: 'https://desktop-fixture.example/v1', apiKey: 'fixture-secret', enabled: true,
  }, admin.token);
  await api('/admin/models', {
    id: 'desktop-fixture', name: '桌面验收模型', channelId: 'desktop-channel', upstreamModel: 'fixture-upstream',
    enabled: true, inputPriceMicros: 1000000, outputPriceMicros: 2000000,
    maxInputTokens: 100000, maxOutputTokens: 2048, capabilities: ['text', 'tools'],
  }, admin.token);
  await api('/admin/apps', { apps: [{
    id: 'chat', name: '聊天', enabled: true, defaultModelId: 'desktop-fixture', modelIds: ['desktop-fixture'],
  }] }, admin.token, 'PUT');
  await client.getByRole('button', { name: '刷新', exact: true }).click();
  await client.getByText('桌面验收模型', { exact: true }).waitFor();
  await client.getByRole('button', { name: '开始对话', exact: true }).click();
  const composer = client.locator('textarea').first();
  await composer.waitFor({ timeout: 120000 });
  await composer.fill('Reply with one short sentence.');
  await client.getByRole('button', { name: '发送', exact: true }).click();
  await client.getByText('Desktop managed chat verified.', { exact: true }).first().waitFor({ timeout: 60000 });
  assert.ok(providerCalls > 0);
  await capture(client, 'customer-chat.png');
  await client.goto(`${clientOrigin}/account`);
  await client.getByText('输入 100 / 输出 20', { exact: true }).first().waitFor({ timeout: 15000 });
  await capture(client, 'customer-account-billed.png');
  const nextLogin = desktop.waitForEvent('window');
  await client.getByRole('button', { name: '退出登录', exact: true }).click();
  const secondLogin = await nextLogin;
  await secondLogin.locator('#email').waitFor();
  await secondLogin.getByRole('tab', { name: '注册', exact: true }).click();
  await secondLogin.locator('#email').fill('second@example.test');
  await secondLogin.locator('#send-code').click();
  await secondLogin.getByRole('status').filter({ hasText: '验证码已发送' }).waitFor();
  assert.ok(mailbox.get('second@example.test'));
  await secondLogin.locator('#code').fill(mailbox.get('second@example.test'));
  client = await signIn(secondLogin, 'second@example.test');
  assert.equal(await client.evaluate(() => localStorage.getItem('fixture-account-marker')), null);
  assert.equal(await client.getByText('兑换充值', { exact: true }).count(), 0);
  await client.setViewportSize({ width: 420, height: 760 });
  assert.equal(await client.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await client.screenshot({ path: path.join(screenshots, 'customer-account-mobile.png') });
  completed = true;
});
