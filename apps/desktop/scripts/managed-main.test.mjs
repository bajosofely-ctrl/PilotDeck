import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const sourceRoot = path.resolve(import.meta.dirname, '../src');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t, { managed = true, bootstrapFailure = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pilotdeck-managed-main-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const handlers = new Map(), windows = [], spawns = [], events = [], sessions = new Map();
  let logPath = path.join(directory, 'logs');
  let failStop = false;
  const app = Object.assign(new EventEmitter(), {
    isPackaged: false, isReady: () => true, getLocale: () => 'en', getVersion: () => '1.0.0',
    getPath: key => key === 'logs' ? logPath : directory,
    setAppLogsPath: value => { logPath = value; },
    requestSingleInstanceLock: () => true, whenReady: async () => {},
    setAppUserModelId() {}, disableHardwareAcceleration() {}, setBadgeCount() {},
    show() {}, hide() {}, quit: () => { events.push('quit'); },
  });
  function partition(name = 'default') {
    if (!sessions.has(name)) sessions.set(name, {
      name, webRequest: { onBeforeRequest: callback => { events.push(callback ? 'block-session' : 'unblock-session'); } },
      setPermissionRequestHandler() {}, clearCache: async () => {},
      closeAllConnections: async () => { events.push('close-connections'); },
      clearStorageData: async () => { events.push('clear-workers'); },
      clearAuthCache: async () => {}, flushStorageData() {},
    });
    return sessions.get(name);
  }
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false; this.visible = false;
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: '' }, session: partition(options.webPreferences.partition),
        send: (channel, value) => events.push({ channel, value }),
        setWindowOpenHandler() {}, setIgnoreMenuShortcuts() {},
      });
      windows.push(this);
    }
    static getFocusedWindow() { return windows.find(w => !w.destroyed); }
    async loadURL(url) { this.webContents.mainFrame.url = url; this.emit('ready-to-show'); }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    isMinimized() { return false; }
    isFullScreen() { return false; }
    show() { this.visible = true; }
    focus() {}
    hide() { this.visible = false; }
    restore() {}
    setMenu() {}
    setMenuBarVisibility() {}
    setTitleBarOverlay() {}
    setBackgroundColor() {}
    setOverlayIcon() {}
    destroy() {
      this.destroyed = true; this.emit('closed');
      events.push('destroy-window');
      if (windows.every(w => w.destroyed)) app.emit('window-all-closed');
    }
  }
  const mockProcess = {
    platform: 'win32', arch: 'x64', versions: process.versions,
    env: {
      ...process.env, PILOTDECK_DESKTOP_RUNTIME_ROOT: directory, PILOTDECK_DESKTOP_NODE: process.execPath,
      PILOT_HOME: path.join(directory, 'legacy-home'), DATABASE_PATH: 'inherited-other-user.db',
      PILOTDECK_CONFIG_PATH: 'inherited-other-user.yaml', PILOTDECK_MANAGED_OFFLINE: '1',
      ...(managed ? { PILOTDECK_MANAGED_URL: 'https://operator.example.test' } : {}),
    },
    cwd: () => directory, stdout: { write() {} },
  };
  if (!managed) delete mockProcess.env.PILOTDECK_MANAGED_URL;
  const electron = {
    app, BrowserWindow: Window, session: { fromPartition: partition },
    safeStorage: { isEncryptionAvailable: () => false },
    ipcMain: { handle: (name, callback) => handlers.set(name, callback), on: (name, callback) => handlers.set(name, callback) },
    Menu: { buildFromTemplate: value => value, setApplicationMenu() {} },
    dialog: { showErrorBox: (...args) => events.push(args), showMessageBox: async () => ({ response: 1 }) },
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createFromBuffer: () => ({ getSize: () => ({}) }) },
    nativeTheme: Object.assign(new EventEmitter(), { shouldUseDarkColors: false }),
    powerMonitor: new EventEmitter(), clipboard: {}, screen: {}, shell: { openPath: async () => {}, openExternal: async () => {} },
    Notification: { isSupported: () => false },
  };
  const overrides = {
    rendererRecovery: { installRendererRecovery() {} },
    desktopCommands: { emptyMenuState: {}, commandEnabled: () => false },
    windowChrome: { windowChromeOptions: () => ({}), windowPalette: () => ({}), WINDOWS_CAPTION_HEIGHT: 30 },
    desktopAbout: {}, windowsCaptionMenu: {}, linuxCaptionMenu: {},
    applicationMenu: { buildApplicationMenu: () => [] },
    desktopTray: { createDesktopTray: () => ({ available: () => false, refreshMenu() {}, dispose() {}, setQuitting() {}, setNotificationCount() {} }) },
    appearance: { normalizeAppearance: () => ({ language: 'en', themeMode: 'system' }), startupText: value => value,
      renderLoadingHtml: () => '<html><body><p id="detail"></p></body></html>' },
    appearanceStorage: {}, filePicker: { createFilePicker: () => async () => {} },
    computerUse: { ComputerUseController: class { async initialize() { events.push('computer-start'); } async stop() { events.push('computer-stop'); } } },
    updateDownload: {}, updates: {}, updateNetwork: {},
  };
  const network = {
    createServer() {
      return Object.assign(new EventEmitter(), {
        listen(port) { this.port = port; setImmediate(() => this.emit('listening')); },
        address() { return { port: this.port }; },
        close(callback) { callback(); },
      });
    },
    createConnection() {
      const socket = Object.assign(new EventEmitter(), { end() {}, destroy() {} });
      setImmediate(() => socket.emit('connect'));
      return socket;
    },
  };
  const processTree = {
    spawnManaged(bin, args, options) {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), connected: true, send() {}, exitCode: null });
      spawns.push({ bin, args, options, child });
      const bootstrap = args.some(arg => arg.endsWith('managedBootstrap.js'));
      events.push(bootstrap ? 'bootstrap' : 'server');
      if (bootstrap && bootstrapFailure) fs.writeFileSync(path.join(options.env.PILOT_HOME, 'managed-session.bin'), 'encrypted-cache-fixture');
      if (bootstrap) setImmediate(() => child.emit('managed-exit', bootstrapFailure ? 1 : 0));
      return child;
    },
    async stopProcessTree() { events.push('stop-tree'); if (failStop) throw new Error('children remain'); },
  };
  const moduleCache = new Map();
  const fetchImpl = async (url, options) => url.endsWith('/auth/logout')
    ? new Response('{}')
    : new Response(JSON.stringify({ token: 'customer-session', user: {
      id: JSON.parse(options.body).email.split('@')[0], email: JSON.parse(options.body).email, role: 'user', status: 'active',
    } }));
  function load(filename) {
    const name = path.basename(filename, '.ts');
    if (overrides[name]) return overrides[name];
    if (moduleCache.has(filename)) return moduleCache.get(filename);
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const mod = { exports: {} };
    moduleCache.set(filename, mod.exports);
    const localRequire = id => {
      if (id === 'electron') return electron;
      if (id === 'electron-updater') return {};
      if (id === 'node:net') return network;
      if (id.endsWith('processTree.js')) return processTree;
      if (id.startsWith('./')) return load(path.resolve(path.dirname(filename), `${id}.ts`));
      return require(id);
    };
    new Function('module', 'exports', 'require', '__dirname', 'process', 'fetch', compiled)(mod, mod.exports, localRequire, path.dirname(filename), mockProcess, fetchImpl);
    return mod.exports;
  }
  load(path.join(sourceRoot, 'main.ts'));
  await tick(); await tick();
  const event = window => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  const login = async (email = 'alice@example.test') => {
    const window = windows.find(window => !window.destroyed);
    return handlers.get('pilotdeck:managed-auth')(event(window), 'login', { email, password: 'real-password' });
  };
  const logout = () => handlers.get('pilotdeck:managed-logout')(event(windows.find(window => !window.destroyed && window.options.webPreferences.partition?.startsWith('persist:'))));
  return { app, windows, handlers, events, spawns, directory, login, logout, event, failStop: value => { failStop = value; } };
}

test('managed main starts only a sandboxed login window before authentication and denies iframe IPC', async t => {
  const f = await fixture(t);
  assert.equal(f.spawns.length, 0);
  assert.equal(f.windows.length, 1);
  assert.equal(f.windows[0].options.webPreferences.sandbox, true);
  const event = f.event(f.windows[0]);
  await assert.rejects(f.handlers.get('pilotdeck:managed-auth')({ ...event, senderFrame: { url: event.senderFrame.url } }, 'login', {}), /sender/);
  assert.throws(() => f.handlers.get('pilotdeck:retry-runtime')(event), /No managed account/);
});

test('main bootstraps with scoped paths and local key before server launch; logout stops trees before swapping windows', async t => {
  const f = await fixture(t);
  const mode = {};
  f.handlers.get('pilotdeck:managed-mode')(mode);
  assert.equal(mode.returnValue, true);
  assert.deepEqual(await f.login(), { ok: true });
  assert.equal(f.spawns.length, 2);
  assert.ok(f.spawns[0].args[0].endsWith('managedBootstrap.js'));
  assert.equal(f.spawns[1].args[0], 'server/index.js');
  const env = f.spawns[0].options.env;
  assert.equal(env.PILOTDECK_MANAGED_USER_ID, 'alice');
  assert.equal(env.PILOTDECK_MANAGED_TOKEN, 'customer-session');
  assert.equal(env.PILOTDECK_MANAGED_OFFLINE, '0');
  assert.match(env.PILOTDECK_MANAGED_LOCAL_KEY, /^[a-f0-9]{64}$/);
  assert.equal(env.SERVER_PORT, '3001');
  assert.ok(env.PILOT_HOME.startsWith(path.join(f.directory, 'accounts')));
  assert.equal(env.DATABASE_PATH, path.join(env.PILOT_HOME, 'pilotdeck.db'));
  assert.equal(env.PILOTDECK_CONFIG_PATH, path.join(env.PILOT_HOME, 'pilotdeck.yaml'));
  assert.equal(f.spawns[1].options.env, env);
  const workbench = f.windows.find(window => !window.destroyed);
  assert.equal(new URL(workbench.webContents.mainFrame.url).pathname, '/account');
  assert.match(workbench.options.webPreferences.partition, /^persist:managed-/);
  assert.equal(workbench.webContents.session.name, workbench.options.webPreferences.partition);
  const before = f.events.length;
  await f.logout();
  const after = f.events.slice(before);
  assert.ok(after.indexOf('stop-tree') < after.indexOf('destroy-window'));
  assert.ok(after.indexOf('stop-tree') < after.indexOf('block-session'));
  assert.ok(!f.events.includes('quit'), 'window-all-closed during replacement must not quit');
  assert.equal(f.windows.filter(window => !window.destroyed).length, 1);
  assert.ok(f.windows.at(-1).options.webPreferences.partition.startsWith('managed-login-'));
  await f.login('bob@example.test');
  const other = f.windows.find(window => !window.destroyed);
  assert.notEqual(other.webContents.session, workbench.webContents.session);
  assert.notEqual(f.spawns.at(-1).options.env.PILOT_HOME, env.PILOT_HOME);
  assert.equal(f.spawns.at(-1).options.env.PILOTDECK_MANAGED_USER_ID, 'bob');
  await f.logout();
});

test('runtime retry rotates the local key and keeps the account origin; iframe logout is denied', async t => {
  const f = await fixture(t);
  await f.login();
  const window = f.windows.find(window => !window.destroyed);
  const previous = f.spawns[0].options.env;
  const event = f.event(window);
  await assert.rejects(f.handlers.get('pilotdeck:managed-logout')({ ...event, senderFrame: { url: event.senderFrame.url } }), /sender/);
  await f.handlers.get('pilotdeck:retry-runtime')(event);
  const next = f.spawns.at(-1).options.env;
  assert.equal(next.SERVER_PORT, previous.SERVER_PORT);
  assert.equal(next.PILOT_HOME, previous.PILOT_HOME);
  assert.notEqual(next.PILOTDECK_MANAGED_LOCAL_KEY, previous.PILOTDECK_MANAGED_LOCAL_KEY);
  await f.logout();
});
test('failed bootstrap reports a runtime error and never starts the server', async t => {
  const f = await fixture(t, { bootstrapFailure: true });
  await f.login();
  assert.equal(f.spawns.length, 1);
  assert.equal(fs.existsSync(path.join(f.spawns[0].options.env.PILOT_HOME, 'managed-session.bin')), false);
  assert.ok(f.events.some(item => item.channel === 'pilotdeck:runtime-status' && item.value.phase === 'error'));
  await f.logout();
});

test('failed descendant cleanup keeps the existing account window and reports logout error', async t => {
  const f = await fixture(t);
  await f.login();
  const workbench = f.windows.find(window => !window.destroyed);
  f.failStop(true);
  await assert.rejects(f.logout(), /Failed to stop/);
  assert.equal(workbench.destroyed, false);
  assert.equal(f.windows.filter(window => !window.destroyed).length, 1);
  f.failStop(false);
  await f.logout();
});

test('legacy mode still starts the runtime without a managed login or bootstrap', async t => {
  const f = await fixture(t, { managed: false });
  for (let i = 0; i < 10 && !f.spawns.length; i++) await tick();
  assert.equal(f.spawns.length, 1);
  assert.equal(f.spawns[0].args[0], 'server/index.js');
  assert.equal(f.windows[0].options.webPreferences.partition, undefined);
  // Stop through the real lifecycle hook so the test closes its log stream.
  await tick();
  f.app.emit('before-quit', { preventDefault() {} });
  f.app.emit('before-quit', { preventDefault() {} });
  for (let i = 0; i < 10 && !f.events.includes('quit'); i++) await tick();
  assert.ok(f.events.includes('stop-tree'));
});
