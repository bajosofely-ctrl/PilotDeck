/* 离线缓存：站点壳（页面、脚本、样式、图标）和图谱数据。
 * 页面和脚本：网络优先，断网时用缓存；数据和图标：先用缓存，同时后台更新。
 * 改了 SHELL 或 DATA 列表、或数据结构变了，就把 VERSION 加一。 */
'use strict';

var VERSION = 'v1';
var CACHE_PREFIX = 'pilotdeck-education-';
var CACHE = CACHE_PREFIX + VERSION;
var SCOPE = self.registration.scope;

var SHELL = [
  './',
  'index.html',
  'explore/',
  'explore/index.html',
  'explore/app.js',
  'diagnose/',
  'diagnose/index.html',
  'diagnose/app.js',
  'diagnose/engine.js',
  'diagnose/share.js',
  'diagnose/style.css',
  'children/',
  'children/index.html',
  'children/history.html',
  'children/children.css',
  'children/page.js',
  'children/history.js',
  'assets/site.css',
  'assets/explore.css',
  'assets/home.js',
  'assets/stats-config.js',
  'assets/stats.js',
  'assets/children.js',
  'assets/pwa.js',
  'assets/pwa.css',
  'assets/vendor/cytoscape.min.js',
  'assets/vendor/cytoscape-dagre.js',
  'assets/vendor/dagre.min.js',
  'assets/vendor/qrcode.js',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/icon-maskable-512.png',
  'assets/icons/apple-touch-icon.png',
  'manifest.webmanifest',
  'LICENSE'
];

var DATA = [
  'data/topics.json',
  'data/dependencies.json',
  'data/cn-curriculum-standards.json',
  'data/questions.json',
  'data/id-aliases.json'
];

function abs(path) { return new URL(path, SCOPE).href; }

function fresh(path) { return new Request(abs(path), { cache: 'reload' }); }

// Only declared static resources belong in this application's offline cache.
var RESOURCES = new Set(SHELL.concat(DATA).map(abs));

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    var cache = await caches.open(CACHE);
    // 壳必须齐全；数据尽量缓存，失败不挡安装（之后第一次访问时会补上）
    await cache.addAll(SHELL.map(fresh));
    await Promise.all(DATA.map(function (p) { return cache.add(fresh(p)).catch(function () { /* 稍后运行时再缓存 */ }); }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var names = await caches.keys();
    await Promise.all(names.filter(function (n) { return n.indexOf(CACHE_PREFIX) === 0 && n !== CACHE; }).map(function (n) { return caches.delete(n); }));
    await self.clients.claim();
  })());
});

function cacheable(res) {
  return res && res.status === 200 && res.type === 'basic' && !res.redirected;
}

async function put(req, res) {
  if (!cacheable(res)) return;
  try {
    var cache = await caches.open(CACHE);
    await cache.put(req, res.clone());
  } catch (e) { /* 空间不足等 */ }
}

async function timedFetch(req) {
  var timer;
  try {
    return await Promise.race([
      fetch(req),
      new Promise(function (_, reject) {
        timer = setTimeout(function () { reject(new Error('timeout')); }, 5000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function networkFirst(req, cacheKey) {
  try {
    var res = await timedFetch(req);
    await put(cacheKey, res);
    return res;
  } catch (e) {
    var cache = await caches.open(CACHE);
    var hit = await cache.match(cacheKey);
    if (hit) return hit;
    throw e;
  }
}

async function staleWhileRevalidate(cacheKey, update) {
  var cache = await caches.open(CACHE);
  var hit = await cache.match(cacheKey);
  return hit || update;
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  url.search = '';
  url.hash = '';
  if (!RESOURCES.has(url.href)) return;
  var cacheKey = url.href;
  if (/\.(?:json|png|svg|ico|webmanifest)$/.test(url.pathname)) {
    var update = fetch(req).then(async function (res) {
      await put(cacheKey, res);
      return res;
    });
    event.waitUntil(update.catch(function () { /* 断网 */ }));
    event.respondWith(staleWhileRevalidate(cacheKey, update));
    return;
  }
  event.respondWith(networkFirst(req, cacheKey));
});
