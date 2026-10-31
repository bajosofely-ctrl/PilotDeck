import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(name) {
  const source = fs.readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', compiled)(mod, mod.exports, id => id.startsWith('./') ? load(id.slice(2)) : require(id));
  return mod.exports;
}
const { managedServiceOrigin, managedProfile, managedRuntimeEnvironment, requireManagedSender, ManagedAccounts, managedAuthRequest } = load('managedAccounts');
const { ManagedSessionCache, managedRuntimePorts, managedLearningPorts } = load('managedStorage');
const account = (id = 'alice', role = 'user') => ({ token: 'opaque-secret', user: { id, email: `${id}@example.test`, role, status: 'active' } });
const service = 'https://operator.example.test';

test('managed service is opt-in and rejects credentials, paths, and unsafe transport', () => {
  assert.equal(managedServiceOrigin(undefined), null);
  assert.equal(managedServiceOrigin('https://operator.example.test/'), service);
  assert.equal(managedServiceOrigin('http://127.0.0.1:3300'), 'http://127.0.0.1:3300');
  for (const url of ['', 'file:///tmp/operator', 'https://a:b@operator.test', `${service}/evil`, 'http://operator.test', `${service}?a=1`]) {
    assert.throws(() => managedServiceOrigin(url));
  }
});

test('profile and Chromium partition are stable per service and user, with no path traversal', () => {
  const a = managedProfile('/desktop', service, account().user);
  assert.deepEqual(a, managedProfile('/desktop', service, account().user));
  assert.notEqual(a.profilePath, managedProfile('/desktop', service, account('bob').user).profilePath);
  assert.notEqual(a.partition, managedProfile('/desktop', 'https://other.test', account().user).partition);
  assert.match(a.partition, /^persist:managed-[a-f0-9]{64}$/);
  assert.match(managedProfile('/desktop', service, account('../../escape').user).profilePath, /accounts[\\/][a-f0-9]{64}$/);
  assert.throws(() => managedProfile('/desktop', service, account('admin', 'admin').user));
  assert.throws(() => managedProfile('/desktop', service, { ...account().user, status: 'disabled' }));
});

test('runtime environment replaces inherited account paths and rotates the local relay key', () => {
  const profile = { ...managedProfile('/desktop', service, account().user), ...account(), serviceOrigin: service };
  const one = managedRuntimeEnvironment(profile);
  const two = managedRuntimeEnvironment(profile);
  assert.equal(one.PILOTDECK_MANAGED_URL, service);
  assert.equal(one.PILOTDECK_MANAGED_TOKEN, account().token);
  assert.equal(one.PILOTDECK_MANAGED_USER_ID, 'alice');
  for (const key of ['PILOT_HOME', 'DATABASE_PATH', 'PILOTDECK_CONFIG_PATH', 'PILOTDECK_CONFIG_DIR']) {
    assert.ok(one[key].startsWith(profile.profilePath));
  }
  assert.match(one.PILOTDECK_MANAGED_LOCAL_KEY, /^[a-f0-9]{64}$/);
  assert.notEqual(one.PILOTDECK_MANAGED_LOCAL_KEY, two.PILOTDECK_MANAGED_LOCAL_KEY);
  assert.notEqual(one.PILOTDECK_MANAGED_LOCAL_KEY, one.PILOTDECK_MANAGED_TOKEN);
});

test('managed default workspaces override inherited roots, remain separate from state, and persist per account', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pilotdeck-managed-workspaces-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { ensureGeneralWorkspaceDirectory } = await import('../../../ui/server/utils/generalWorkspace.js');
  const { isPathInsideOrEqual } = await import('../../../ui/server/utils/pathSafety.js');
  const inherited = { HOME: os.homedir(), WORKSPACES_ROOT: path.join(root, 'shared-workspaces') };
  const environment = (id, origin = service) => ({
    ...inherited,
    ...managedRuntimeEnvironment({
      ...account(id), serviceOrigin: origin, ...managedProfile(root, origin, account(id).user),
    }),
  });
  const alice = environment('alice');
  const bob = environment('bob');
  const otherOperator = environment('alice', 'https://other.test');
  assert.notEqual(alice.WORKSPACES_ROOT, inherited.WORKSPACES_ROOT);
  assert.notEqual(alice.WORKSPACES_ROOT, bob.WORKSPACES_ROOT);
  assert.notEqual(alice.WORKSPACES_ROOT, otherOperator.WORKSPACES_ROOT);
  assert.equal(path.dirname(alice.WORKSPACES_ROOT), path.dirname(alice.PILOT_HOME));
  assert.equal(isPathInsideOrEqual(alice.PILOT_HOME, alice.WORKSPACES_ROOT), false);
  assert.equal(isPathInsideOrEqual(alice.WORKSPACES_ROOT, alice.PILOT_HOME), false);
  assert.equal(alice.HOME, inherited.HOME);
  const first = await ensureGeneralWorkspaceDirectory(alice);
  fs.writeFileSync(path.join(first, 'private.txt'), 'alice');
  const second = await ensureGeneralWorkspaceDirectory(bob);
  assert.equal(fs.existsSync(path.join(second, 'private.txt')), false);
  fs.writeFileSync(path.join(second, 'private.txt'), 'bob');
  const restored = await ensureGeneralWorkspaceDirectory(environment('alice'));
  assert.equal(fs.readFileSync(path.join(restored, 'private.txt'), 'utf8'), 'alice');
  assert.equal(fs.readFileSync(path.join(second, 'private.txt'), 'utf8'), 'bob');
  const linked = environment('linked');
  fs.mkdirSync(linked.WORKSPACES_ROOT, { recursive: true });
  fs.symlinkSync(first, path.join(linked.WORKSPACES_ROOT, 'general'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(ensureGeneralWorkspaceDirectory(linked), { code: 'GENERAL_WORKSPACE_UNSAFE' });
  assert.equal(fs.readFileSync(path.join(first, 'private.txt'), 'utf8'), 'alice');
});

test('IPC accepts only the exact owner and its main frame at the expected document', () => {
  const frame = { url: 'data:text/html,login' };
  const owner = { mainFrame: frame };
  const event = { sender: owner, senderFrame: frame };
  requireManagedSender(event, owner, frame.url);
  assert.throws(() => requireManagedSender({ ...event, sender: {} }, owner, frame.url));
  assert.throws(() => requireManagedSender({ ...event, senderFrame: { url: frame.url } }, owner, frame.url));
  assert.throws(() => requireManagedSender(event, owner, 'data:text/html,other'));
  assert.throws(() => requireManagedSender(event, null, frame.url));
});

test('auth request allowlists fields, keeps device identity in main, disallows redirects and has no offline fallback', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(account()), { status: 200 });
  };
  await managedAuthRequest(service, 'register', { email: 'a@b.test', password: 'long-password', code: '123456', role: 'admin', deviceId: 'spoof' },
    { id: 'real-device', name: 'Desktop' }, fetchImpl);
  assert.equal(calls[0].url, `${service}/api/platform/auth/register`);
  assert.equal(calls[0].body.deviceId, 'real-device');
  assert.equal(calls[0].body.role, undefined);
  assert.equal(calls[0].options.redirect, 'error');
  await managedAuthRequest(service, 'reset-password', { email: 'a@b.test', code: '123456', password: 'replacement-password' },
    { id: 'real-device', name: 'Desktop' }, fetchImpl);
  assert.equal(calls[1].url, `${service}/api/platform/auth/reset-password`);
  assert.deepEqual(calls[1].body, { email: 'a@b.test', code: '123456', password: 'replacement-password' });
  for (const status of [401, 403, 500]) {
    await assert.rejects(managedAuthRequest(service, 'login', { email: 'a@b.test', password: 'wrong' }, { id: 'd', name: 'PC' },
      async () => new Response('{"error":"Denied"}', { status })), /Denied/);
  }
  await assert.rejects(managedAuthRequest(service, '../admin', {}, { id: 'd', name: 'PC' }, fetchImpl));
  await assert.rejects(managedAuthRequest(service, 'code', { email: 'a@b.test', purpose: 'admin' }, { id: 'd', name: 'PC' }, fetchImpl));
});

function setup(overrides = {}) {
  const events = [];
  const manager = new ManagedAccounts({
    userData: '/desktop', serviceOrigin: service,
    authenticate: async () => { events.push('authenticate'); return account(); },
    stopRuntime: async () => { events.push('stopped'); },
    openAccount: async () => { events.push('opened'); },
    closeAccount: async () => { events.push('closed'); },
    showLogin: async () => { events.push('login'); },
    revoke: async () => { events.push('revoked'); },
    isQuitting: () => false,
    ...overrides,
  });
  return { manager, events };
}

test('no account or runtime before online login; logout stops before replacing account context', async () => {
  const { manager, events } = setup();
  assert.equal(manager.current, null);
  assert.deepEqual(events, []);
  await manager.submit('login', {});
  assert.equal(manager.current.user.id, 'alice');
  assert.deepEqual(events, ['authenticate', 'stopped', 'opened']);
  await manager.logout();
  assert.equal(manager.current, null);
  assert.deepEqual(events.slice(3), ['stopped', 'closed', 'revoked', 'login']);
});

test('admin, malformed sessions, unavailable network and auth failures never open a runtime', async () => {
  for (const response of [account('admin', 'admin'), { token: '', user: account().user }, { token: 'x', user: null }]) {
    const { manager, events } = setup({ authenticate: async () => response });
    await assert.rejects(manager.submit('login', {}));
    assert.equal(manager.current, null);
    assert.deepEqual(events, []);
  }
  const { manager, events } = setup({ authenticate: async () => { throw new Error('Offline'); } });
  await assert.rejects(manager.submit('login', {}), /Offline/);
  assert.equal(manager.current, null);
  assert.deepEqual(events, []);
});

test('a failed process-tree stop retains the old account and rejects another login', async () => {
  let fail = false;
  const { manager, events } = setup({ stopRuntime: async () => { if (fail) throw new Error('children remain'); } });
  await manager.submit('login', {});
  const previous = manager.current;
  fail = true;
  await assert.rejects(manager.logout(), /children remain/);
  assert.equal(manager.current, previous);
  assert.ok(!events.includes('closed'));
  await assert.rejects(manager.submit('login', {}), /sign out/i);
});

test('concurrent authentication and quit during login cannot activate another session', async () => {
  let finish;
  let quitting = false;
  const { manager, events } = setup({
    authenticate: () => new Promise(resolve => { finish = resolve; }),
    isQuitting: () => quitting,
  });
  const pending = manager.submit('login', {});
  await assert.rejects(manager.submit('login', {}), /progress/i);
  quitting = true;
  finish(account());
  await assert.rejects(pending, /closing/i);
  assert.equal(manager.current, null);
  assert.deepEqual(events, []);
});

test('code and reset password responses cannot establish an account even if they contain a token', async () => {
  const { manager, events } = setup();
  await manager.submit('code', {});
  await manager.submit('reset-password', {});
  assert.equal(manager.current, null);
  assert.deepEqual(events, ['authenticate', 'authenticate']);
});

test('window activation failure returns to login only after cleanup succeeds', async () => {
  const { manager, events } = setup({ openAccount: async () => { throw new Error('window failed'); } });
  await assert.rejects(manager.submit('login', {}), /window failed/);
  assert.equal(manager.current, null);
  assert.deepEqual(events, ['authenticate', 'stopped', 'stopped', 'closed', 'login']);

  let stops = 0;
  const failed = setup({
    openAccount: async () => { throw new Error('window failed'); },
    stopRuntime: async () => { if (++stops === 2) throw new Error('children remain'); },
  });
  await assert.rejects(failed.manager.submit('login', {}), /children remain/);
  assert.equal(failed.manager.current.user.id, 'alice');
  await assert.rejects(failed.manager.submit('login', {}), /sign out/i);
});

function cacheFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pilotdeck-managed-cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const key = crypto.randomBytes(32);
  const encryption = {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    },
    decryptString(value) {
      const cipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      cipher.setAuthTag(value.subarray(-16));
      return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString('utf8');
    },
  };
  let now = 1_000_000;
  const cache = new ManagedSessionCache(root, service, encryption, () => now);
  const profile = { ...account(), serviceOrigin: service, ...managedProfile(root, service, account().user) };
  const id = path.basename(profile.profilePath);
  cache.save(profile);
  return { cache, root, id, profile, encryption, advance: ms => { now += ms; } };
}

test('cached sessions are encrypted and resume offline only after a recognized network failure', async t => {
  const { cache, id, profile } = cacheFixture(t);
  const disk = fs.readFileSync(path.join(profile.profilePath, 'managed-session.bin')).toString();
  assert.ok(!disk.includes(profile.token));
  assert.deepEqual(cache.list(), [{ id, email: profile.user.email }]);
  const resumed = await cache.resume(id, async () => { throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }); });
  assert.equal(resumed.offline, true);
  assert.equal(managedRuntimeEnvironment(resumed).PILOTDECK_MANAGED_OFFLINE, '1');
  const online = await cache.resume(id, async () => new Response(JSON.stringify({ user: profile.user })));
  assert.equal(online.offline, false);
  for (const failure of [new SyntaxError('bad JSON'), new TypeError('fetch failed'),
    new TypeError('fetch failed', { cause: { code: 'CERT_HAS_EXPIRED' } })]) {
    await assert.rejects(cache.resume(id, async () => { throw failure; }));
  }
});

test('401/403 revoke offline cache, while 500, redirects, mismatched identities and admins never fall back', async t => {
  for (const status of [401, 403, 500, 302]) {
    const { cache, id } = cacheFixture(t);
    await assert.rejects(cache.resume(id, async () => new Response('{}', { status })));
    assert.equal(cache.list().length, status === 401 || status === 403 ? 0 : 1);
  }
  for (const user of [account('bob').user, account('alice', 'admin').user, { ...account().user, status: 'disabled' }]) {
    const { cache, id } = cacheFixture(t);
    await assert.rejects(cache.resume(id, async () => new Response(JSON.stringify({ user }))));
    assert.deepEqual(cache.list(), []);
  }
});

test('cache rejects traversal, expiration, service mismatch, corruption and unavailable secure storage', t => {
  const { cache, id, profile, encryption, root, advance } = cacheFixture(t);
  assert.throws(() => cache.load('../x'));
  assert.deepEqual(new ManagedSessionCache(root, 'https://other.test', encryption).list(), []);
  assert.deepEqual(new ManagedSessionCache(root, service, { ...encryption, isEncryptionAvailable: () => false }).list(), []);
  assert.deepEqual(new ManagedSessionCache(root, service, { ...encryption, getSelectedStorageBackend: () => 'basic_text' }).list(), []);
  advance(8 * 24 * 60 * 60 * 1000);
  assert.throws(() => cache.load(id), /expired/);
  fs.writeFileSync(path.join(profile.profilePath, 'managed-session.bin'), 'corrupt');
  assert.deepEqual(cache.list(), []);
});

test('account ports persist across launches and a conflict cannot silently change the browser origin', async t => {
  const { profile } = cacheFixture(t);
  const calls = [];
  const first = await managedRuntimePorts(profile.profilePath, async (port, fallback) => {
    calls.push({ port, fallback }); return port + 10;
  });
  assert.deepEqual(first, { serverPort: 3011, gatewayPort: 18799 });
  const next = await managedRuntimePorts(profile.profilePath, async (port, fallback) => {
    calls.push({ port, fallback }); return port;
  });
  assert.deepEqual(next, first);
  assert.deepEqual(calls.slice(2), [{ port: 3011, fallback: false }, { port: 18799, fallback: false }]);
  await assert.rejects(managedRuntimePorts(profile.profilePath, async () => { throw new Error('port occupied'); }), /occupied/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile.profilePath, 'managed-ports.json'))), first);
});

test('learning ports avoid the existing app and persist iframe origins across customer launches', async t => {
  const { profile } = cacheFixture(t);
  const taken = new Set([3001, 3010, 3011, 3012, 3013, 3015, 18789]);
  const allocated = [];
  const first = await managedLearningPorts(profile.profilePath, [3001, 18789], async (preferred, fallback) => {
    assert.equal(fallback, true);
    const port = taken.has(preferred) ? 42000 + allocated.length : preferred;
    allocated.push(port);
    return port;
  });
  assert.equal(new Set(Object.values(first)).size, 5);
  assert.ok(Object.values(first).every(port => !taken.has(Number(port))));
  const second = await managedLearningPorts(profile.profilePath, [3001, 18789], async (preferred, fallback) => {
    assert.equal(fallback, false);
    return preferred;
  });
  assert.deepEqual(second, first);
  await assert.rejects(managedLearningPorts(profile.profilePath, [3001, 18789], async () => {
    throw new Error('port occupied');
  }), /occupied/);
});
