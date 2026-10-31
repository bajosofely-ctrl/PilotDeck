import { test, expect } from '@playwright/test';

// These fixtures only exist inside intercepted browser requests. No live API is contacted.
const user = { id: 'fixture-user', email: 'customer@example.test', role: 'user', status: 'active', deviceLimit: 3, concurrencyLimit: 3, apps: ['chat'], createdAt: 1700000000000 };
const admin = { ...user, id: 'fixture-admin', email: 'admin@example.test', role: 'admin' };
const settings = { registrationEnabled: true, deviceLimit: 3, concurrencyLimit: 3, defaultApps: ['chat'], giftEnabled: false, giftAmountMicros: 0, giftExpiryDays: null };
const channel = { id: 'fixture-channel', name: '隔离测试渠道', provider: 'Fixture', protocol: 'openai', baseUrl: 'https://provider.example.test/v1', hasApiKey: true, enabled: true, modelCount: 1 };
const model = { id: 'fixture-model', name: '隔离测试模型', channelId: channel.id, channelName: channel.name, channelEnabled: true, appIds: ['chat'], upstreamModel: 'fixture-upstream', enabled: true, inputPriceMicros: 1250000, outputPriceMicros: 2500000, maxInputTokens: 8192, maxOutputTokens: 1024, capabilities: ['text'] };
const app = { id: 'chat', name: 'Chat', enabled: true, defaultModelId: model.id, modelIds: [model.id] };
const code = { id: 'fixture-code', batchId: 'fixture-batch', code: 'FIXTURE-ONLY-NOT-REDEEMABLE', amountMicros: 2000000, status: 'unused', expiresAt: null, redeemedBy: null, redeemedAt: null };
const pending = { id: 'fixture-call', userId: user.id, appId: 'chat', modelId: model.id, status: 'pending', reservedMicros: 1000000, createdAt: 1700000000000, inputBound: 8192, outputBound: 1024 };

async function fixture(page, options = {}) {
  const calls = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/platform/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/platform', '');
    const method = request.method();
    const body = request.postDataJSON();
    calls.push({ path, method, body, query: url.searchParams.toString(), authorization: request.headers().authorization });
    const json = (payload, status = 200) => route.fulfill({ status, json: payload });
    if (options.intercept && await options.intercept({ route, path, method, body, json, calls })) return;
    if (path === '/auth/login') return json({ token: 'fixture-token', user: options.role === 'user' ? user : admin });
    if (path === '/me') return json({ user: admin });
    if (path === '/auth/logout') return json({ ok: true });
    if (path === '/admin/users' && method === 'GET') return json({ users: options.empty ? [] : [user], total: options.empty ? 0 : 1 });
    if (path === '/admin/users' && method === 'POST') return json({ user: { ...user, ...body } }, 201);
    if (path === `/admin/users/${user.id}`) return json({ user });
    if (path.endsWith('/wallet')) return json({ availableMicros: 6000000, rechargeMicros: 2000000, giftMicros: 3000000, adjustmentMicros: 1000000, heldMicros: 500000, expiredMicros: 0 });
    if (path.endsWith('/adjustments')) return json({ entry: { id: 'fixture-adjustment' } });
    if (path.includes('/devices')) return method === 'GET' ? json({ devices: [{ id: 'fixture-session', deviceId: 'fixture-device', deviceName: '隔离测试设备', createdAt: 1700000000000, lastSeenAt: 1700000100000 }] }) : json({ ok: true });
    if (path.endsWith('/reset-password')) return json({ ok: true });
    if (path === '/admin/settings') return json({ settings });
    if (path === '/admin/channels' && method === 'GET') return json({ channels: options.empty ? [] : [channel] });
    if (path === '/admin/models') return method === 'GET' ? json({ models: options.empty ? [] : [model] }) : json({ model: body }, 201);
    if (path.startsWith('/admin/models/')) return json({ model: { ...model, ...body } });
    if (path === '/admin/apps') return json({ apps: [app] });
    if (path === '/admin/codes') {
      if (method === 'POST') return json({ codes: [{ ...code, amountMicros: body.amountMicros }] }, 201);
      const { code: plaintext, ...hidden } = code;
      return json({ codes: options.empty ? [] : [url.searchParams.get('export') === 'true' ? code : hidden] });
    }
    if (path.endsWith('/revoke')) return json({ ok: true });
    if (path === '/admin/ledger') return json({ ledger: options.empty ? [] : [{ id: 'fixture-ledger', userId: user.id, kind: 'adjustment', amountMicros: 1000000, amountUnits: '1000000000000', actorId: admin.id, createdAt: 1700000000000, reason: '隔离测试调整', beforeUnits: '0', afterUnits: '1000000000000' }] });
    if (path === '/admin/billing/pending') return json({ calls: [pending] });
    if (path.endsWith('/review')) return json({ call: { ...pending, status: 'released' } });
    if (path === '/admin/releases') return method === 'GET' ? json({ releases: [] }) : json({ release: body }, 201);
    return json({ error: `Unhandled fixture: ${method} ${path}` }, 500);
  });
  await page.goto('/');
  await page.getByLabel('邮箱', { exact: true }).fill(admin.email);
  await page.getByLabel('密码', { exact: true }).fill('fixture-only-password-123');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  if (options.role !== 'user') await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible();
  return { calls, errors };
}

test('login sends device identity, stores only session token, validates session on reload', async ({ page }) => {
  const { calls, errors } = await fixture(page);
  const login = calls.find((call) => call.path === '/auth/login');
  expect(login.body).toMatchObject({ email: admin.email, password: 'fixture-only-password-123', deviceName: 'PilotDeck 管理后台 · 浏览器' });
  expect(login.body.deviceId).toBeTruthy();
  expect(await page.evaluate(() => sessionStorage.getItem('pilotdeck.admin.token'))).toBe('fixture-token');
  expect(await page.evaluate(() => localStorage.getItem('pilotdeck.admin.token'))).toBeNull();
  await page.reload();
  await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible();
  expect(calls.some((call) => call.path === '/me' && call.authorization === 'Bearer fixture-token')).toBeTruthy();
  expect(errors).toEqual([]);
});

test('customer login is rejected and server session is revoked', async ({ page }) => {
  const { calls } = await fixture(page, { role: 'user' });
  await expect(page.getByRole('alert')).toContainText('没有管理员权限');
  expect(calls.some((call) => call.path === '/auth/logout')).toBeTruthy();
  expect(await page.evaluate(() => sessionStorage.getItem('pilotdeck.admin.token'))).toBeNull();
  await expect(page.getByRole('navigation')).toHaveCount(0);
});

test('server error has retry and empty state contains no fabricated users', async ({ page }) => {
  let failed = false;
  await fixture(page, { empty: true, intercept: async ({ path, json }) => {
    if (path === '/admin/users' && !failed) { failed = true; await json({ error: '隔离测试：数据库暂不可用' }, 503); return true; }
  } });
  await expect(page.getByRole('alert')).toContainText('数据库暂不可用');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByText('暂无用户', { exact: true })).toBeVisible();
  await expect(page.getByText(user.email, { exact: true })).toHaveCount(0);
});

test('expired bearer returns to login without retaining token', async ({ page }) => {
  await fixture(page, { intercept: async ({ path, json }) => {
    if (path === '/admin/models') { await json({ error: 'Expired test session' }, 401); return true; }
  } });
  await page.getByRole('link', { name: '模型与价格' }).click();
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('登录已失效');
  expect(await page.evaluate(() => sessionStorage.getItem('pilotdeck.admin.token'))).toBeNull();
});

test('idle admin page detects a revoked session without user interaction', async ({ page }) => {
  await page.clock.install();
  let revoked = false;
  await fixture(page, { intercept: async ({ path, json }) => {
    if (path === '/me' && revoked) {
      await json({ error: 'Session is no longer valid.', code: 'UNAUTHORIZED' }, 401);
      return true;
    }
  } });
  revoked = true;
  await page.clock.fastForward(16000);
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('登录已失效');
  expect(await page.evaluate(() => sessionStorage.getItem('pilotdeck.admin.token'))).toBeNull();
});

test('focus check tolerates temporary failure but signs out a revoked session on return', async ({ page }) => {
  let status = 503;
  const { calls } = await fixture(page, { intercept: async ({ path, json }) => {
    if (path === '/me') { await json({ error: 'Session check unavailable' }, status); return true; }
  } });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => calls.filter(call => call.path === '/me').length).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('pilotdeck.admin.token'))).toBe('fixture-token');
  status = 401;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible();
});

test('late unauthorized response from the previous login cannot clear a new session', async ({ page }) => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let settingsRequested = false;
  let logins = 0;
  await fixture(page, { intercept: async ({ path, method, json }) => {
    if (path === '/auth/login') { await json({ token: `fixture-token-${++logins}`, user: admin }); return true; }
    if (path === '/admin/settings' && method === 'PUT') {
      settingsRequested = true;
      await held;
      await json({ error: 'Old session' }, 401);
      return true;
    }
    if (path === '/admin/models') { await json({ error: 'Revoked session' }, 401); return true; }
  } });
  try {
    await page.getByRole('link', { name: '注册与默认值' }).click();
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect.poll(() => settingsRequested).toBe(true);
    await page.getByRole('link', { name: '模型与价格' }).click();
    await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible();
    await page.getByLabel('邮箱', { exact: true }).fill(admin.email);
    await page.getByLabel('密码', { exact: true }).fill('fixture-only-password-123');
    await page.evaluate(() => { location.hash = 'users'; });
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible();
    const response = page.waitForResponse(r => r.url().endsWith('/admin/settings') && r.request().method() === 'PUT');
    release();
    await (await response).finished();
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('pilotdeck.admin.token'))).toBe('fixture-token-2');
  } finally { release(); }
});

test('user creation uses defaults; details display wallet and revoke specific session', async ({ page }) => {
  const { calls } = await fixture(page);
  await page.getByRole('button', { name: '创建用户' }).click();
  await page.getByLabel('邮箱', { exact: true }).fill('new@example.test');
  await page.getByLabel('初始密码（至少 12 个字符）').fill('fixture-new-password-123');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.find((call) => call.method === 'POST' && call.path === '/admin/users').body).toMatchObject({ deviceLimit: 3, apps: ['chat'] });
  await page.getByRole('button', { name: user.email, exact: true }).click();
  await expect(page.getByText('¥6.00', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '登录设备' }).click();
  await page.getByRole('button', { name: '强制下线' }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.some((call) => call.method === 'DELETE' && call.path.endsWith('/devices/fixture-session'))).toBeTruthy();
});

test('adjustment retry reuses identical payload after uncertain server error', async ({ page }) => {
  let attempts = 0;
  const { calls } = await fixture(page, { intercept: async ({ path, json }) => {
    if (path.endsWith('/adjustments') && attempts++ === 0) { await json({ error: '隔离测试：结果待确认' }, 503); return true; }
  } });
  await page.getByRole('button', { name: user.email, exact: true }).click();
  await page.getByRole('button', { name: '调整余额' }).click();
  await page.getByLabel('金额（元）', { exact: true }).fill('0.123456');
  await page.getByLabel('调整原因 / 关联流水').fill('fixture-only adjustment');
  await page.getByRole('button', { name: '确认调整' }).click();
  await expect(page.getByRole('alert')).toContainText('结果待确认');
  await expect(page.getByLabel('金额（元）', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重试此笔调整' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const adjustments = calls.filter((call) => call.path.endsWith('/adjustments'));
  expect(adjustments).toHaveLength(2);
  expect(adjustments[0].body).toEqual(adjustments[1].body);
  expect(adjustments[0].body.amountMicros).toBe(123456);
});

test('apps save allowlist and clearing selected model clears default', async ({ page }) => {
  const { calls } = await fixture(page);
  await page.getByRole('link', { name: '应用管理' }).click();
  await page.getByRole('checkbox', { name: model.name, exact: true }).uncheck();
  await expect(page.getByLabel('默认模型')).toHaveValue('');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存');
  const saved = calls.find((call) => call.path === '/admin/apps' && call.method === 'PUT');
  expect(saved.body.apps[0]).toMatchObject({ modelIds: [], defaultModelId: null });
});

test('codes generate, export decrypted list, filter and revoke', async ({ page }) => {
  const { calls } = await fixture(page);
  await page.getByRole('link', { name: '兑换码', exact: true }).click();
  await page.getByRole('button', { name: '批量生成', exact: true }).click();
  await page.getByLabel('单码面值（元）').fill('2.123456');
  await page.getByRole('button', { name: '生成兑换码', exact: true }).click();
  await expect(page.getByText(code.code, { exact: true })).toBeVisible();
  expect(calls.find((call) => call.path === '/admin/codes' && call.method === 'POST').body).toMatchObject({ count: 1, amountMicros: 2123456, expiresAt: null });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出当前列表' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let csv = '';
  for await (const chunk of stream) csv += chunk.toString('utf8');
  expect(csv).toContain(code.code);
  expect(calls.some((call) => call.query.includes('export=true'))).toBeTruthy();
  await page.getByRole('combobox', { name: '状态', exact: true }).selectOption('redeemed');
  await expect(page.getByText('暂无兑换码', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: '状态', exact: true }).selectOption('unused');
  await page.getByRole('button', { name: '作废', exact: true }).click();
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.some((call) => call.path === '/admin/codes/fixture-code/revoke')).toBeTruthy();
});

test('gift configuration and pending usage settlement post exact payloads', async ({ page }) => {
  const { calls } = await fixture(page);
  await page.getByRole('link', { name: '注册与默认值' }).click();
  await page.getByLabel('启用注册赠送').check();
  await page.getByLabel('赠送金额（元）').fill('1.23');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存');
  expect(calls.find((call) => call.path === '/admin/settings' && call.method === 'PUT').body).toMatchObject({ giftAmountMicros: 1230000, giftExpiryDays: null, giftEnabled: true });
  await page.getByRole('link', { name: '账务管理' }).click();
  await page.getByRole('tab', { name: '异常待核查' }).click();
  await page.getByRole('button', { name: '核查处理' }).click();
  await page.getByLabel('处理方式').selectOption('settle');
  await page.getByLabel('核实输入 Token').fill('20');
  await page.getByLabel('核实输出 Token').fill('5');
  await page.getByLabel('核查原因', { exact: true }).fill('fixture verified usage');
  await page.getByLabel('核查凭据 / 服务商工单').fill('fixture-ticket');
  await page.getByRole('button', { name: '确认按用量结算' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.find((call) => call.path.endsWith('/review')).body).toMatchObject({ action: 'settle', inputTokens: 20, outputTokens: 5, evidence: 'fixture-ticket' });
});

test('release form posts integrity and package metadata', async ({ page }) => {
  const { calls, errors } = await fixture(page);
  await page.getByRole('link', { name: '客户端版本' }).click();
  await page.getByRole('button', { name: '发布版本', exact: true }).click();
  await page.getByLabel('版本号', { exact: true }).fill('1.2.3');
  await page.getByLabel('安装包下载地址').fill('https://downloads.example.test/fixture.exe');
  await page.getByLabel('SHA-256 校验值').fill('a'.repeat(64));
  await page.getByLabel('安装包大小（字节）').fill('123456');
  await page.getByLabel('更新说明').fill('隔离测试版本\n不用于真实分发。');
  await page.getByRole('dialog').getByRole('button', { name: '发布版本', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.find((call) => call.path === '/admin/releases' && call.method === 'POST').body).toMatchObject({ version: '1.2.3', sizeBytes: 123456, sha256: 'a'.repeat(64) });
  expect(errors).toEqual([]);
});

test('desktop and mobile layouts keep content inside viewport', async ({ page }, testInfo) => {
  const { errors } = await fixture(page);
  await page.screenshot({ path: testInfo.outputPath('desktop-users.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '展开导航' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: '展开导航' }).click();
  await page.getByRole('link', { name: '模型与价格' }).click();
  await page.getByRole('tab', { name: /^模型管理/ }).click();
  await page.getByRole('button', { name: '编辑模型', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('mobile-model-form.png'), fullPage: true });
  expect(errors).toEqual([]);
});
