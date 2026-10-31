import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = createRequire(new URL('../../../ui/package.json', import.meta.url))('jsdom');
const source = fs.readFileSync(new URL('../src/managedLogin.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', compiled)(mod, mod.exports, require);
const { managedLoginDocument, managedPasswordError, managedLoginError } = mod.exports;
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function page(t, { submit = async () => ({ ok: true }), savedAccounts = async () => [] } = {}) {
  const calls = [];
  const timers = new Map();
  let now = 100_000, nextTimer = 0;
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  const html = managedLoginDocument('http://127.0.0.1:3300');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    virtualConsole,
    beforeParse(window) {
      window.TextEncoder = TextEncoder;
      window.Date.now = () => now;
      window.setInterval = callback => { timers.set(++nextTimer, callback); return nextTimer; };
      window.clearInterval = id => timers.delete(id);
      window.pilotdeckManagedLogin = {
        submit: (action, input) => { calls.push({ action, input }); return submit(action, input); },
        savedAccounts,
      };
    },
  });
  t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
  const { window } = dom;
  const id = name => window.document.getElementById(name);
  const fire = (element, type) => element.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));
  const set = (name, value) => { id(name).value = value; fire(id(name), 'input'); };
  await flush();
  return {
    html, window, id, calls, set, fire,
    tab: mode => window.document.querySelector(`[data-mode="${mode}"]`),
    send: () => fire(id('form'), 'submit'),
    advance: ms => { now += ms; for (const callback of [...timers.values()]) callback(); },
    timers,
  };
}

test('password validation matches the backend UTF-16 minimum and UTF-8 byte maximum', () => {
  for (const value of ['a'.repeat(12), 'a'.repeat(72), '密'.repeat(24), '😀'.repeat(18)]) {
    assert.equal(managedPasswordError(value), '', value);
  }
  for (const value of ['', 'a'.repeat(11), 'a'.repeat(73), '密'.repeat(25), '😀'.repeat(19), 'a'.repeat(12) + '\0']) {
    assert.ok(managedPasswordError(value), JSON.stringify(value));
  }
  assert.equal(managedPasswordError('😀'.repeat(6)), '');
});

test('service errors are translated from an allowlist and unknown details never escape', () => {
  const cases = [
    ['Invalid email or password.', /邮箱.*密码/],
    ['Invalid or expired verification code.', /验证码.*过期/],
    ['Too many attempts. Try again later.', /频繁/],
    ['Device limit reached. Sign out an existing device first.', /设备.*上限/],
    ['Registration is disabled.', /注册/],
    ['Registration could not be completed.', /注册/],
    ['Verification email could not be sent. Try again later.', /邮件/],
    ['An active customer account is required. Administrator accounts cannot sign in here.', /客户账号/],
    ['Cached session expired or invalid. Please sign in online.', /重新登录/],
    ['Secure session storage is unavailable. Please sign in online.', /重新登录/],
    ['fetch failed', /网络/],
    ['The operation was aborted due to timeout', /超时/],
  ];
  for (const [message, expected] of cases) assert.match(managedLoginError(message), expected);
  for (const raw of ['SELECT token FROM sessions; secret=abc', '<img src=x onerror=alert(1)>', 'Error: C:\\private\\secret.yml', 'Invalid email or password. secret=abc', undefined]) {
    const result = managedLoginError(raw);
    assert.match(result, /暂时无法/);
    assert.doesNotMatch(result, /SELECT|secret|onerror|private|undefined/);
  }
});

test('document retains nonce CSP and IPC-only flow without displaying the operator URL', async t => {
  const p = await page(t);
  assert.equal(p.window.document.documentElement.lang, 'zh-CN');
  assert.doesNotMatch(p.html, /127\.0\.0\.1|http:\/\/|unsafe-inline|unsafe-eval/);
  const csp = p.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
  const nonce = p.window.document.querySelector('script').getAttribute('nonce');
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /form-action 'none'; base-uri 'none'/);
  assert.ok(csp.includes(`script-src 'nonce-${nonce}'`));
  assert.equal(p.window.document.querySelector('style').getAttribute('nonce'), nonce);
  assert.notEqual(nonce, /nonce="([^"]+)"/.exec(managedLoginDocument('https://operator.test'))[1]);
  assert.equal(p.id('password').minLength, 12);
  assert.equal(p.id('email').maxLength, 254);
  assert.equal(p.tab('reset-password').textContent, '找回密码');
});

test('all password flows reject invalid fields before IPC, including programmatic submit', async t => {
  const p = await page(t);
  for (const mode of ['login', 'register', 'reset-password']) {
    p.tab(mode).click();
    p.set('email', 'alice@example.test');
    p.set('code', '123456');
    for (const password of ['short', '密'.repeat(25), '😀'.repeat(19)]) {
      p.set('password', password);
      p.send();
      await flush();
      assert.equal(p.calls.length, 0);
      assert.ok(p.id('status').textContent.length > 0);
    }
  }
  p.set('password', 'valid-password');
  p.set('code', '12345');
  p.send();
  assert.match(p.id('status').textContent, /6.*验证码/);
  p.set('code', '123456');
  p.set('email', 'alice@localhost');
  p.send();
  assert.match(p.id('status').textContent, /邮箱/);
  assert.equal(p.calls.length, 0);
});

test('sending a code needs only a valid email and never includes the password', async t => {
  const p = await page(t);
  p.tab('register').click();
  p.set('email', 'bad-email');
  p.id('send-code').click();
  assert.equal(p.calls.length, 0);
  p.set('email', 'alice@example.test');
  p.set('password', 'private-password');
  p.id('send-code').click();
  await flush();
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].action, 'code');
  assert.deepEqual(JSON.parse(JSON.stringify(p.calls[0].input)), { email: 'alice@example.test', purpose: 'register' });
  assert.match(p.id('status').textContent, /验证码.*发送/);
});

test('in-flight requests freeze controls, mode and payload and block duplicate IPC', async t => {
  const request = deferred(), accounts = deferred();
  const p = await page(t, { submit: () => request.promise, savedAccounts: () => accounts.promise });
  p.tab('register').click();
  p.set('email', 'alice@example.test');
  p.set('password', 'valid-password');
  p.set('code', '123456');
  p.send();
  assert.equal(p.id('form').getAttribute('aria-busy'), 'true');
  assert.match(p.id('submit').textContent, /注册中/);
  accounts.resolve([{ id: 'alice', email: 'alice@example.test' }]);
  await flush();
  for (const control of p.window.document.querySelectorAll('button,input,select')) assert.equal(control.disabled, true, control.id);
  p.fire(p.tab('login'), 'click');
  p.fire(p.id('send-code'), 'click');
  p.fire(p.id('resume'), 'click');
  p.send();
  assert.equal(p.tab('register').getAttribute('aria-selected'), 'true');
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].action, 'register');
  assert.equal(p.calls[0].input.password, 'valid-password');
  request.resolve({ ok: false, error: 'Invalid or expired verification code.' });
  await flush();
  assert.equal(p.id('email').disabled, false);
  assert.equal(p.id('form').getAttribute('aria-busy'), 'false');
  assert.match(p.id('status').textContent, /验证码/);
});

test('code cooldown survives tab changes, email casing, other requests and elapsed wall time', async t => {
  const p = await page(t, { submit: async action => action === 'code' ? { ok: true } : { ok: false, error: 'Invalid or expired verification code.' } });
  p.tab('register').click();
  p.set('email', 'Alice@example.test');
  p.id('send-code').click();
  await flush();
  assert.equal(p.id('send-code').disabled, true);
  assert.match(p.id('send-code').textContent, /60/);
  p.tab('login').click();
  p.tab('reset-password').click();
  p.set('email', 'alice@example.test');
  p.set('password', 'valid-password');
  p.set('code', '123456');
  p.send();
  await flush();
  assert.equal(p.id('send-code').disabled, true);
  p.fire(p.id('send-code'), 'click');
  assert.equal(p.calls.filter(call => call.action === 'code').length, 1);
  p.advance(59_001);
  assert.match(p.id('send-code').textContent, /1/);
  p.advance(1_000);
  assert.equal(p.id('send-code').disabled, false);
  assert.equal(p.id('send-code').textContent, '发送验证码');
  assert.equal(p.timers.size, 0);
  p.id('send-code').click();
  await flush();
  assert.equal(p.calls.at(-1).input.purpose, 'reset-password');
});

test('failed code delivery still cools down uncertain or rate-limited attempts', async t => {
  const p = await page(t, { submit: async () => ({ ok: false, error: 'Too many attempts. Try again later.' }) });
  p.tab('register').click();
  p.set('email', 'alice@example.test');
  p.id('send-code').click();
  await flush();
  assert.match(p.id('status').textContent, /频繁/);
  assert.equal(p.id('send-code').disabled, true);
  p.advance(60_000);
  assert.equal(p.id('send-code').disabled, false);
});

test('reset submits the backend password field, returns to login and clears sensitive inputs', async t => {
  const p = await page(t);
  p.tab('reset-password').click();
  p.set('email', 'alice@example.test');
  p.set('password', '新的安全密码新的安全密码');
  p.set('code', '123456');
  p.send();
  await flush();
  assert.equal(p.calls[0].action, 'reset-password');
  assert.equal(p.calls[0].input.password, '新的安全密码新的安全密码');
  assert.equal(p.tab('login').getAttribute('aria-selected'), 'true');
  assert.equal(p.id('password').value, '');
  assert.equal(p.id('code').value, '');
  assert.equal(p.id('code').required, false);
  assert.equal(p.id('password').autocomplete, 'current-password');
  assert.match(p.id('status').textContent, /密码已重置/);
  assert.equal(p.id('submit').disabled, false);
});

test('saved-account resume remains available and labels cannot inject HTML', async t => {
  const p = await page(t, { savedAccounts: async () => [{ id: 'alice', email: '<img src=x onerror=alert(1)>' }] });
  assert.equal(p.id('saved').hidden, false);
  assert.equal(p.window.document.querySelector('img'), null);
  assert.equal(p.id('saved-account').options[0].textContent, '<img src=x onerror=alert(1)>');
  p.id('resume').click();
  await flush();
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].action, 'resume');
  assert.deepEqual(JSON.parse(JSON.stringify(p.calls[0].input)), { accountId: 'alice' });
  p.send();
  assert.equal(p.calls.length, 1);
});

test('rejected IPC and unknown response errors show safe Chinese text and allow retry', async t => {
  let attempt = 0;
  const p = await page(t, { submit: async () => {
    if (++attempt === 1) throw new Error('secret token in C:\\private\\config');
    return { ok: false, error: '<img src=x onerror=alert(1)> secret' };
  } });
  p.set('email', 'alice@example.test');
  p.set('password', 'valid-password');
  for (let i = 0; i < 2; i++) {
    p.send();
    await flush();
    assert.match(p.id('status').textContent, /暂时无法/);
    assert.doesNotMatch(p.id('status').textContent, /secret|private|onerror/);
    assert.equal(p.id('submit').disabled, false);
    assert.equal(p.window.document.querySelector('img'), null);
  }
});

test('successful login clears credentials and stays locked until main closes the window', async t => {
  const p = await page(t);
  p.set('email', 'alice@example.test');
  p.set('password', 'valid-password');
  p.send();
  await flush();
  assert.equal(p.id('password').value, '');
  assert.match(p.id('status').textContent, /正在打开/);
  assert.equal(p.id('submit').disabled, true);
  p.fire(p.tab('register'), 'click');
  p.send();
  assert.equal(p.calls.length, 1);
});
