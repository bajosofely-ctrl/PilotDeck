import { test, expect } from '@playwright/test';

async function fixture(page, { saved = false, failTest = false } = {}) {
  const calls = [];
  let mail = { provider: 'qq', enabled: saved, senderEmail: saved ? 'sender@qq.com' : '', senderName: 'PilotDeck', hasAuthorizationCode: saved };
  await page.addInitScript(() => sessionStorage.setItem('pilotdeck.admin.token', 'mail-fixture-token'));
  await page.route('**/api/platform/**', async route => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace('/api/platform', '');
    const body = request.postDataJSON();
    const method = request.method();
    calls.push({ endpoint, method, body });
    const json = (data, status = 200) => route.fulfill({ status, json: data });
    if (endpoint === '/me') return json({ user: { id: 'admin', role: 'admin', email: 'operator@example.test' } });
    if (endpoint === '/admin/users') return json({ users: [], total: 0 });
    if (endpoint === '/admin/mail' && method === 'GET') return json({ mail });
    if (endpoint === '/admin/mail' && method === 'PUT') {
      mail = { ...mail, enabled: body.enabled, senderEmail: body.senderEmail, senderName: body.senderName,
        hasAuthorizationCode: Boolean(body.authorizationCode) || mail.hasAuthorizationCode };
      return json({ mail });
    }
    if (endpoint === '/admin/mail/test') {
      if (failTest) return json({ error: '邮箱认证失败，请检查发件邮箱、SMTP 服务开关和授权码。' }, 503);
      return json({ ok: true });
    }
    return json({ error: `Unexpected fixture: ${method} ${endpoint}` }, 500);
  });
  await page.goto('/#mail');
  return calls;
}

test('mail settings save credentials without retaining them and test only explicitly saved configuration', async ({ page }, testInfo) => {
  const calls = await fixture(page);
  await expect(page.getByRole('heading', { name: '邮件设置', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送测试邮件' })).toBeDisabled();
  await page.getByLabel('发件邮箱', { exact: true }).fill('sender@qq.com');
  await page.getByLabel('SMTP 授权码', { exact: true }).fill('abcdefghijklmnop');
  await page.getByLabel('启用验证码邮件', { exact: true }).check();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已保存');
  await expect(page.getByLabel('SMTP 授权码', { exact: true })).toHaveValue('');
  expect(calls.filter(call => call.endpoint === '/admin/mail/test')).toHaveLength(0);
  const save = calls.find(call => call.method === 'PUT');
  expect(save.body).toEqual({ enabled: true, senderEmail: 'sender@qq.com', senderName: 'PilotDeck', authorizationCode: 'abcdefghijklmnop' });
  await page.getByLabel('测试收件邮箱').fill('recipient@example.test');
  await page.getByRole('button', { name: '发送测试邮件' }).click();
  await expect(page.getByRole('status').filter({ hasText: '已提交邮件服务器' })).toBeVisible();
  expect(calls.find(call => call.endpoint === '/admin/mail/test').body).toEqual({ email: 'recipient@example.test' });
  await page.getByLabel('发件人名称').fill('New sender');
  await expect(page.getByRole('button', { name: '发送测试邮件' })).toBeDisabled();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '发送测试邮件' })).toBeEnabled();
  expect(calls.filter(call => call.method === 'PUT')[1].body).not.toHaveProperty('authorizationCode');
  await page.reload();
  await expect(page.getByLabel('SMTP 授权码', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('SMTP 授权码', { exact: true })).toHaveAttribute('placeholder', '已保存，留空不修改');
  await page.screenshot({ path: testInfo.outputPath('mail-desktop.png'), fullPage: true });
});

test('mail settings remain usable on mobile and show SMTP failure without losing the saved state', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await fixture(page, { saved: true, failTest: true });
  await expect(page.getByRole('heading', { name: '邮件设置', exact: true })).toBeVisible();
  await page.getByLabel('测试收件邮箱').fill('recipient@example.test');
  await page.getByRole('button', { name: '发送测试邮件' }).click();
  await expect(page.getByRole('alert')).toContainText('邮箱认证失败');
  await expect(page.getByRole('button', { name: '发送测试邮件' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('mail-mobile.png'), fullPage: true });
});
