'use strict';

const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const site = path.join(__dirname, '../site');
const source = (name) => readFileSync(path.join(site, name), 'utf8');

function storage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
  };
}

function profiles(localStorage) {
  const context = vm.createContext({ window: {}, localStorage });
  vm.runInContext(source('assets/children.js'), context);
  return context.window.CnmChildren;
}

test('profiles and per-subject history survive reload, correction, move and removal', () => {
  const local = storage();
  let children = profiles(local);
  const a = children.add({ name: 'Student A', grade: children.GRADES[0] }).child;
  const b = children.add({ name: 'Student B', grade: children.GRADES[1] }).child;
  assert.equal(children.current().id, a.id);
  assert.equal(children.setCurrent(b.id), true);
  for (const subject of ['math', 'chinese', 'english', 'physics']) {
    assert.equal(children.saveRecord(a.id, {
      key: subject, subject, weak: [subject + '-topic'], roots: [subject + '-topic'],
    }), true);
  }
  children = profiles(local);
  assert.equal(children.current().id, b.id);
  assert.equal(children.recordsOf(a.id).length, 4);
  assert.equal(children.latestStatus(a.id, 'math')['math-topic'].status, 'weak');
  assert.equal(children.latestStatus(a.id, 'math')['english-topic'], undefined);
  children.saveRecord(a.id, { key: 'math', subject: 'math', mastered: ['math-topic'] });
  assert.equal(children.recordsOf(a.id).length, 4);
  assert.equal(children.latestStatus(a.id, 'math')['math-topic'].status, 'mastered');
  children.moveRecord('math', a.id, b.id);
  assert.equal(children.hasRecord(a.id, 'math'), false);
  assert.equal(children.hasRecord(b.id, 'math'), true);
  children.removeRecord(a.id, 'english');
  assert.equal(children.hasRecord(a.id, 'english'), false);
  children.remove(b.id);
  assert.equal(profiles(local).recordsOf(b.id).length, 0);
  assert.equal(profiles(local).current().id, a.id);
});

test('disabled statistics emit no network requests or injected scripts', () => {
  const network = [];
  const context = vm.createContext({
    window: {
      navigator: {}, matchMedia: () => ({ matches: false }),
      addEventListener() {}, dispatchEvent() {},
    },
    document: {
      documentElement: { setAttribute() {} },
      createElement: () => { network.push('script'); return { setAttribute() {} }; },
      head: { appendChild() {} },
    },
    navigator: { sendBeacon: (...args) => network.push(args) },
    fetch: (...args) => { network.push(args); return Promise.resolve(); },
    location: { pathname: '/diagnose/' },
    localStorage: storage(), sessionStorage: storage(),
  });
  vm.runInContext(source('assets/stats-config.js'), context);
  vm.runInContext(source('assets/stats.js'), context);
  context.window.cnmTrack('diagnosis_complete', { subject: 'math' });
  assert.equal(context.window.CNM_STATS.endpoint, '');
  assert.equal(context.window.CNM_STATS.cloudflareToken, '');
  assert.deepEqual(network, []);
});

test('share canvas passes the local education URL to the vendored QR encoder', () => {
  for (const href of [
    'http://localhost:3010/diagnose/?subject=english&target=private#answer',
    'http://127.0.0.1:4010/diagnose/index.html?subject=math',
  ]) {
    const payloads = [];
    const canvasContext = new Proxy({
      createLinearGradient: () => ({ addColorStop() {} }),
    }, {
      get: (target, key) => target[key] || (key === 'measureText'
        ? (text) => ({ width: String(text).length * 10 }) : () => {}),
    });
    const canvas = { getContext: () => canvasContext };
    const context = vm.createContext({
      URL, location: { href }, document: { createElement: () => canvas },
    });
    vm.runInContext(source('assets/vendor/qrcode.js'), context);
    const make = context.qrcode;
    context.qrcode = (...args) => {
      const qr = make(...args);
      const addData = qr.addData;
      qr.addData = (data) => { payloads.push(data); addData(data); };
      return qr;
    };
    vm.runInContext(source('diagnose/share.js'), context);
    context.ShareCard.draw(canvas, { subject: 'math', label: 'Test', spots: [], roots: [] });
    assert.deepEqual(payloads, [new URL('/?from=share', href).href]);
    assert.equal(canvas.width, 1080);
    assert.equal(canvas.height, 1920);
  }
});

function worker() {
  const origin = 'http://localhost:3010';
  const handlers = {};
  const stores = new Map();
  const calls = [];
  let offline = false;
  let status = 200;
  const keyOf = (request) => typeof request === 'string' ? request : request.url;
  const response = (body) => {
    const result = new Response(body, { status });
    Object.defineProperty(result, 'type', { value: 'basic' });
    return result;
  };
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const data = stores.get(name);
      return {
        async put(request, result) { data.set(keyOf(request), result.clone()); },
        async match(request) { return data.get(keyOf(request))?.clone(); },
        async add(request) {
          const url = new URL(keyOf(request));
          let file = path.join(site, decodeURIComponent(url.pathname));
          if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
          assert.ok(existsSync(file), 'precache asset exists: ' + url.pathname);
          data.set(url.href, response(readFileSync(file)));
        },
        async addAll(requests) { for (const request of requests) await this.add(request); },
      };
    },
    async keys() { return Array.from(stores.keys()); },
    async delete(name) { return stores.delete(name); },
    async match(request, options = {}) {
      const requested = new URL(keyOf(request));
      for (const data of stores.values()) {
        for (const [key, result] of data) {
          const candidate = new URL(key);
          if (options.ignoreSearch) { candidate.search = ''; requested.search = ''; }
          if (candidate.href === requested.href) return result.clone();
        }
      }
    },
  };
  const context = vm.createContext({
    URL, Request, Response, caches, setTimeout, clearTimeout,
    self: {
      registration: { scope: origin + '/' }, location: { origin },
      clients: { claim: async () => {} }, skipWaiting: async () => {},
      addEventListener: (name, fn) => { handlers[name] = fn; },
    },
    fetch: async (request) => {
      calls.push(keyOf(request));
      if (offline) throw new Error('offline');
      return response('network');
    },
  });
  vm.runInContext(source('sw.js'), context);
  return {
    context, caches, stores, calls,
    setOffline(value) { offline = value; },
    setStatus(value) { status = value; },
    async lifecycle(name) {
      const pending = [];
      handlers[name]({ waitUntil: (promise) => pending.push(promise) });
      await Promise.all(pending);
    },
    async request(pathname, { mode = 'navigate', method = 'GET' } = {}) {
      const pending = [];
      let result;
      const url = new URL(pathname, origin).href;
      const request = new Request(url, { method });
      Object.defineProperty(request, 'mode', { value: mode });
      handlers.fetch({
        request,
        respondWith: (promise) => { result = promise; },
        waitUntil: (promise) => pending.push(promise),
      });
      const resolved = await result;
      await Promise.all(pending);
      return resolved;
    },
  };
}

test('worker installs existing assets and only cleans its own old cache versions', async () => {
  const w = worker();
  await w.caches.open('pilotdeck-education-v0');
  await w.caches.open('unrelated-app-v1');
  await w.lifecycle('install');
  await w.lifecycle('activate');
  const names = await w.caches.keys();
  assert.ok(names.includes('pilotdeck-education-v1'));
  assert.ok(names.includes('unrelated-app-v1'));
  assert.ok(!names.includes('pilotdeck-education-v0'));
  const cache = await w.caches.open('pilotdeck-education-v1');
  assert.ok(await cache.match('http://localhost:3010/assets/icons/icon-maskable-512.png'));
});

test('offline known pages retain their own document across query strings and index URLs', async () => {
  const w = worker();
  await w.lifecycle('install');
  w.setOffline(true);
  for (const page of ['explore/', 'diagnose/', 'children/', 'children/history.html',
    'explore/index.html', 'diagnose/index.html', 'children/index.html']) {
    const result = await w.request('/' + page + '?subject=english');
    const file = page.endsWith('/') ? page + 'index.html' : page;
    assert.ok(await result.text() === source(file), 'correct offline document: ' + page);
  }
});

test('worker bypasses unknown routes, probes, non-GET requests and other origins', async () => {
  const w = worker();
  await w.lifecycle('install');
  w.setOffline(true);
  for (const route of ['/api/config', '/api/config.json', '/missing', '/missing.png',
    '/sw.js', 'https://example.com/diagnose/']) {
    assert.ok(await w.request(route) === undefined, 'bypassed: ' + route);
  }
  assert.equal(await w.request('/diagnose/', { method: 'POST' }), undefined);
  assert.equal(w.calls.length, 0);
});

test('failed asset refresh never poisons the cached data', async () => {
  const w = worker();
  await w.lifecycle('install');
  w.setStatus(404);
  const cached = await w.request('/data/topics.json', { mode: 'cors' });
  assert.equal(cached.status, 200);
  w.setOffline(true);
  const offline = await w.request('/data/topics.json', { mode: 'cors' });
  assert.deepEqual(await offline.json(), JSON.parse(source('data/topics.json')));
});
