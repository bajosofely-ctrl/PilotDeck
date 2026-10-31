import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPlatformApp } from './app.js';
import { createMailSender } from './mail.js';

const password = 'Mail-fixture-password-123';
const authorizationCode = 'abcdefghijklmnop';
const configuration = {
  enabled: true, senderEmail: 'fixture@qq.com', senderName: 'PilotDeck',
  authorizationCode,
};

async function fixture(t, options = {}) {
  const sent = [];
  const transports = [];
  let closed = 0;
  const platform = await createPlatformApp({
    dbPath: ':memory:', encryptionKey: 'mail-fixture-encryption-key-at-least-32',
    bootstrapAdmin: { email: 'operator@example.test', password },
    mailEnv: {},
    createMailTransport: config => {
      transports.push(config);
      return {
        sendMail: async message => {
          sent.push(message);
          if (options.sendError) throw options.sendError;
          return options.result || { accepted: message.to, rejected: [] };
        },
        close: () => { closed++; },
      };
    },
    ...options.platformOptions,
  });
  const server = platform.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    platform.close();
  });
  const api = async (endpoint, method = 'GET', body, token = adminToken) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/platform${endpoint}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  let adminToken;
  const admin = await api('/auth/login', 'POST', { email: 'operator@example.test', password, deviceId: 'mail-admin' }, null);
  assert.equal(admin.status, 200);
  adminToken = admin.body.token;
  return { ...platform, api, sent, transports, closed: () => closed };
}

test('mail settings are admin-only, encrypted, masked and separate from general settings', async t => {
  const f = await fixture(t);
  assert.equal((await f.api('/admin/mail', 'GET', undefined, null)).status, 401);
  assert.equal((await f.api('/admin/mail', 'PUT', configuration, null)).status, 401);
  await f.api('/admin/users', 'POST', { email: 'customer@example.test', password });
  const customer = await f.api('/auth/login', 'POST', { email: 'customer@example.test', password, deviceId: 'mail-customer' }, null);
  for (const [endpoint, method, body] of [
    ['/admin/mail', 'GET'], ['/admin/mail', 'PUT', configuration],
    ['/admin/mail/test', 'POST', { email: 'recipient@example.test' }],
  ]) assert.equal((await f.api(endpoint, method, body, customer.body.token)).status, 403);
  const saved = await f.api('/admin/mail', 'PUT', configuration);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.mail, {
    provider: 'qq', enabled: true, senderEmail: 'fixture@qq.com', senderName: 'PilotDeck',
    hasAuthorizationCode: true,
  });
  assert.ok(!JSON.stringify((await f.api('/admin/mail')).body).includes(authorizationCode));
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM platform_meta').all()).includes(authorizationCode));
  assert.ok(!JSON.stringify((await f.api('/admin/settings')).body).includes('fixture@qq.com'));
  assert.equal(f.db.prepare("SELECT count(*) n FROM audit_log WHERE action='mail.update'").get().n, 1);
});

test('saved SMTP configuration delivers registration and reset codes through verified TLS', async t => {
  const f = await fixture(t);
  assert.equal((await f.api('/admin/mail', 'PUT', configuration)).status, 200);
  const response = await f.api('/auth/code', 'POST', { email: 'new@example.test', purpose: 'register' }, null);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
  const message = f.sent[0];
  assert.deepEqual(message.from, { name: 'PilotDeck', address: 'fixture@qq.com' });
  assert.deepEqual(message.to, ['new@example.test']);
  assert.match(message.subject, /注册/);
  const code = message.text.match(/\b\d{6}\b/)?.[0];
  assert.ok(code);
  assert.ok(!JSON.stringify(response.body).includes(code));
  assert.equal(f.transports[0].host, 'smtp.qq.com');
  assert.equal(f.transports[0].port, 465);
  assert.equal(f.transports[0].secure, true);
  assert.equal(f.transports[0].tls.rejectUnauthorized, true);
  assert.deepEqual(f.transports[0].auth, { user: 'fixture@qq.com', pass: authorizationCode });
  assert.equal(f.transports[0].disableFileAccess, true);
  assert.equal(f.transports[0].disableUrlAccess, true);
  assert.ok(f.transports[0].socketTimeout <= 30000);
  assert.equal(f.closed(), 1);
  const registered = await f.api('/auth/register', 'POST', { email: 'new@example.test', password, code, deviceId: 'registered' }, null);
  assert.equal(registered.status, 201);
  await f.api('/admin/users', 'POST', { email: 'reset@example.test', password });
  assert.equal((await f.api('/auth/code', 'POST', { email: 'reset@example.test', purpose: 'reset-password' }, null)).status, 200);
  assert.match(f.sent[1].subject, /密码重置/);
});

test('empty secret preserves credentials; changing sender requires a new authorization code', async t => {
  const f = await fixture(t);
  await f.api('/admin/mail', 'PUT', configuration);
  assert.equal((await f.api('/admin/mail', 'PUT', { ...configuration, senderName: 'Updated', authorizationCode: '' })).status, 200);
  assert.equal((await f.api('/admin/mail/test', 'POST', { email: 'recipient@example.test' })).status, 200);
  assert.equal(f.transports[0].auth.pass, authorizationCode);
  assert.equal(f.sent[0].from.name, 'Updated');
  assert.equal((await f.api('/admin/mail', 'PUT', { ...configuration, senderEmail: 'different@qq.com', authorizationCode: '' })).status, 400);
  assert.equal((await f.api('/admin/mail')).body.mail.senderEmail, 'fixture@qq.com');
  assert.equal((await f.api('/admin/mail', 'PUT', { ...configuration, senderEmail: 'different@qq.com', authorizationCode: 'ponmlkjihgfedcba' })).status, 200);
});

test('test email uses fixed content, can validate a disabled sender and respects rate limits', async t => {
  const f = await fixture(t);
  await f.api('/admin/mail', 'PUT', { ...configuration, enabled: false });
  assert.equal((await f.api('/admin/mail/test', 'POST', { email: 'recipient@example.test', text: 'arbitrary' })).status, 400);
  for (let i = 0; i < 3; i++) {
    const result = await f.api('/admin/mail/test', 'POST', { email: 'recipient@example.test' });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true });
  }
  assert.equal((await f.api('/admin/mail/test', 'POST', { email: 'recipient@example.test' })).status, 429);
  assert.equal(f.sent.length, 3);
  assert.match(f.sent[0].subject, /测试/);
  assert.ok(!f.sent[0].text.includes(authorizationCode));
  assert.equal((await f.api('/auth/code', 'POST', { email: 'new@example.test', purpose: 'register' }, null)).status, 503);
  assert.equal(f.sent.length, 3);
});

test('mail settings reject injected headers, unsupported SMTP hosts and malformed values', async t => {
  const f = await fixture(t);
  for (const body of [
    { ...configuration, host: '127.0.0.1' }, { ...configuration, port: 25 },
    { ...configuration, senderName: 'Sender\r\nBcc: stolen@example.test' },
    { ...configuration, senderEmail: 'fake@gmail.com' },
    { ...configuration, senderEmail: 'fake@qq.com\r\nMAIL FROM:bad' },
    { ...configuration, enabled: 'true' }, { ...configuration, authorizationCode: '' },
    { ...configuration, authorizationCode: 'short' }, { ...configuration, authorizationCode: authorizationCode + '\r\nx' },
  ]) assert.equal((await f.api('/admin/mail', 'PUT', body)).status, 400);
  assert.equal(f.sent.length, 0);
  assert.equal((await f.api('/admin/mail')).body.mail.hasAuthorizationCode, false);
});

test('SMTP errors never leak credentials; failed registration codes cannot be reused', async t => {
  const f = await fixture(t, { sendError: Object.assign(new Error(`AUTH secret ${authorizationCode}`), { code: 'EAUTH' }) });
  await f.api('/admin/mail', 'PUT', configuration);
  const result = await f.api('/admin/mail/test', 'POST', { email: 'recipient@example.test' });
  assert.equal(result.status, 503);
  assert.match(result.body.error, /授权码/);
  assert.ok(!JSON.stringify(result.body).includes(authorizationCode));
  const sent = await f.api('/auth/code', 'POST', { email: 'new@example.test', purpose: 'register' }, null);
  assert.equal(sent.status, 503);
  const code = f.sent[1].text.match(/\b\d{6}\b/)?.[0];
  const registration = await f.api('/auth/register', 'POST', { email: 'new@example.test', password, code, deviceId: 'invalid-code' }, null);
  assert.equal(registration.status, 400);
  assert.equal(f.closed(), 2);
  assert.ok(!JSON.stringify(f.db.prepare('SELECT * FROM audit_log').all()).includes(authorizationCode));
});

test('SMTP recipient rejection is a delivery failure, not a successful test', async t => {
  const f = await fixture(t, { result: { accepted: [], rejected: ['recipient@example.test'] } });
  await f.api('/admin/mail', 'PUT', configuration);
  assert.equal((await f.api('/admin/mail/test', 'POST', { email: 'recipient@example.test' })).status, 503);
  assert.equal(f.closed(), 1);
});

test('legacy HTTPS mail configuration stays compatible until SMTP settings are explicitly saved', async () => {
  const requests = [];
  const sender = createMailSender({
    PLATFORM_MAIL_URL: 'https://mail.example.test/send', PLATFORM_MAIL_TOKEN: 'fixture-only',
    PLATFORM_MAIL_FROM: 'sender@example.test',
  }, async (url, options) => {
    requests.push({ url, options });
    return new Response('{}');
  });
  await sender({ email: 'recipient@example.test', code: '123456', purpose: 'register', expiresInMinutes: 10 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer fixture-only');
  assert.equal(JSON.parse(requests[0].options.body).to[0], 'recipient@example.test');
});
