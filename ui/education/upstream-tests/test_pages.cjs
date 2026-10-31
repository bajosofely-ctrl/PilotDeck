'use strict';

const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require(require.resolve('jsdom', { paths: [path.join(__dirname, '../..')] }));
const site = path.join(__dirname, '../site');
const source = (name) => readFileSync(path.join(site, name), 'utf8');
const topics = JSON.parse(source('data/topics.json'));
const subjects = { math: 'cnm_', chinese: 'cnc_', english: 'cne_', physics: 'cnp_' };

function page(file, query = '') {
  const dom = new JSDOM(source(file), {
    url: 'http://localhost:3010/' + file + query,
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.scrollTo = () => {};
  // Layout is checked by the host's browser journey; these tests exercise DOM behavior.
  window.requestAnimationFrame = () => 0;
  window.fetch = async (relative) => {
    const url = new URL(relative, window.location.href);
    assert.equal(url.origin, window.location.origin, 'data requests stay on education origin');
    assert.ok(url.pathname.startsWith('/data/'), 'only learning data is requested');
    return new Response(source(url.pathname.slice(1)));
  };
  window.Blob = Blob;
  return dom;
}

async function ready(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('page did not reach expected state');
}

function checkLinks(document) {
  for (const anchor of document.querySelectorAll('a[href]')) {
    const url = new URL(anchor.href);
    if (url.origin !== 'http://localhost:3010') {
      assert.equal(url.hostname, 'github.com', anchor.href);
      assert.ok(url.pathname.startsWith('/xiaoyang111222/cn-math-taxonomy'), anchor.href);
    } else {
      let file = path.join(site, decodeURIComponent(url.pathname));
      if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
      assert.ok(existsSync(file), 'local link resolves: ' + url.pathname);
    }
  }
  assert.ok(document.querySelector('.site-footer').textContent.includes('AI'));
  assert.ok(document.querySelector('.site-footer a[href$="LICENSE"]'));
}

test('all five pages expose attribution and have only learning or source links', () => {
  for (const file of ['index.html', 'explore/index.html', 'diagnose/index.html',
    'children/index.html', 'children/history.html']) {
    const dom = page(file);
    try {
      checkLinks(dom.window.document);
      for (const element of dom.window.document.querySelectorAll('script[src], link[href]')) {
        const value = element.getAttribute('src') || element.getAttribute('href');
        const url = new URL(value, dom.window.location.href);
        if (url.protocol === 'data:') continue;
        assert.equal(url.origin, dom.window.location.origin);
        assert.ok(existsSync(path.join(site, url.pathname)), 'asset resolves: ' + url.pathname);
      }
    } finally { dom.window.close(); }
  }
});

for (const [subject, prefix] of Object.entries(subjects)) {
  test(subject + ' home renders real subject totals and working grade links', async () => {
    const dom = page('index.html', '?subject=' + subject);
    try {
      dom.window.eval(source('assets/home.js'));
      await ready(() => dom.window.document.querySelectorAll('a.grade-card').length > 0);
      const document = dom.window.document;
      assert.equal(document.querySelector('.subject-link.on').dataset.subject, subject);
      assert.equal(Number(document.querySelector('#n-topics').textContent),
        topics.filter((topic) => topic.id.startsWith(prefix)).length);
      checkLinks(document);
    } finally { dom.window.close(); }
  });

  test(subject + ' answers render a result, save history, export JSON and print', async () => {
    const topic = topics.find((entry) => entry.id.startsWith(prefix) && !entry.external);
    const dom = page('diagnose/index.html',
      '?subject=' + subject + '&target=' + topic.id + '&limit=2&seed=education-test');
    try {
      const { window } = dom;
      const { document } = window;
      let exported;
      let downloaded;
      let printed = false;
      window.URL.createObjectURL = (blob) => { exported = blob; return 'blob:education-test'; };
      window.URL.revokeObjectURL = () => {};
      window.HTMLAnchorElement.prototype.click = function () { downloaded = this.download; };
      window.print = () => {
        window.dispatchEvent(new window.Event('beforeprint'));
        assert.equal(document.querySelectorAll('details:not([open])').length, 0);
        window.dispatchEvent(new window.Event('afterprint'));
        printed = true;
      };
      window.eval(source('diagnose/engine.js'));
      window.eval(source('assets/children.js'));
      const child = window.CnmChildren.add({
        name: 'Test student', grade: window.CnmChildren.GRADES[0],
      }).child;
      window.eval(source('diagnose/app.js'));
      await ready(() => document.querySelector('#btn-skip'));
      for (let i = 0; i < 2 && !document.querySelector('#btn-export'); i++) {
        document.querySelector('#btn-skip').click();
        document.querySelector('#btn-next').click();
      }
      assert.ok(document.querySelector('#btn-export'), 'answer flow reaches result');
      assert.ok(document.querySelector('#btn-share'));
      assert.equal(document.querySelector('#iq-line'), null);
      checkLinks(document);
      assert.equal(window.CnmChildren.recordsOf(child.id).length, 1);
      assert.equal(window.CnmChildren.recordsOf(child.id)[0].subject, subject);
      document.querySelector('#btn-export').click();
      const output = JSON.parse(await exported.text());
      assert.equal(output.tool, 'cn-math-taxonomy/diagnose');
      assert.equal(output.targets[0].id, topic.id);
      assert.ok(output.answers.length > 0);
      assert.ok(downloaded.endsWith('.json'));
      document.querySelector('#btn-print').click();
      assert.equal(printed, true);
    } finally { dom.window.close(); }
  });
}
