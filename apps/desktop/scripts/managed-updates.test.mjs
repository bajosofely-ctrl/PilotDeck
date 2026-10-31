import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(name, overrides = {}) {
  const source = fs.readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', compiled)(mod, mod.exports, id => overrides[id] || (id.startsWith('./') ? load(id.slice(2), overrides) : require(id)));
  return mod.exports;
}
const { createManagedUpdates, managedRelease, compareManagedVersions } = load('managedUpdates');
const content = Buffer.from('fixture-installer-never-executed');
const release = { id: 'r', version: '2.0.0', notes: '', downloadUrl: 'https://download.example.test/app.exe',
  sha256: createHash('sha256').update(content).digest('hex'), sizeBytes: content.length, platform: 'win32-x64', createdAt: Date.now() };

test('managed release metadata rejects insecure downloads and unsupported architectures', () => {
  assert.equal(managedRelease(release).version, '2.0.0');
  for (const bad of [{ downloadUrl: 'http://example.test/a.exe' }, { sha256: '' }, { sizeBytes: -1 }, { platform: 'darwin-arm64' }]) {
    assert.throws(() => managedRelease({ ...release, ...bad }));
  }
  assert.equal(compareManagedVersions('2.10.0', '2.9.0'), 1);
});

for (const scenario of ['success', 'bad-hash', 'declined', 'account-changed']) {
  test(`managed update ${scenario} validates bytes and requires final confirmation`, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-update-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    let installed = false;
    let confirmation = false;
    let current = true;
    const update = createManagedUpdates({
      version: '1.0.0', directory, packaged: true, releases: async () => [release],
      stillCurrent: () => current,
      request: async (_url, options) => {
        assert.equal(options.headers.Authorization, undefined);
        if (scenario === 'account-changed') current = false;
        return new Response(scenario === 'bad-hash' ? Buffer.alloc(content.length) : content);
      },
      confirmInstall: async () => { confirmation = true; return scenario !== 'declined'; },
      install: async file => { assert.deepEqual(fs.readFileSync(file), content); installed = true; },
    });
    assert.equal((await update.check()).hasUpdate, true);
    update.start(); await update.wait();
    assert.equal(installed, scenario === 'success');
    assert.equal(confirmation, ['success', 'declined'].includes(scenario));
    if (scenario !== 'success') assert.deepEqual(fs.readdirSync(directory), []);
  });
}

test('development mode cannot download an installer', async t => {
  let downloaded = false;
  const update = createManagedUpdates({
    version: '1.0.0', directory: os.tmpdir(), packaged: false, releases: async () => [release],
    request: async () => { downloaded = true; return new Response(content); },
    confirmInstall: async () => true, install: async () => { throw new Error('must not install'); },
  });
  assert.equal((await update.check()).canDownload, false);
  update.start(); await update.wait();
  assert.equal(downloaded, false);
});

for (const action of ['resume', 'cancel']) {
  test(`pause at final file write waits for ${action} before installation`, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-update-pause-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    let update;
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    const pausedModule = load('managedUpdates', {
      'node:fs': { ...fs, createWriteStream(...args) {
        const output = fs.createWriteStream(...args);
        output.once('finish', () => { update.pause(); finish(); });
        return output;
      } },
    });
    let confirmed = false;
    let installed = false;
    update = pausedModule.createManagedUpdates({
      version: '1.0.0', directory, packaged: true, releases: async () => [release],
      request: async () => new Response(content),
      confirmInstall: async () => { confirmed = true; return true; },
      install: async () => { installed = true; },
    });
    update.start();
    await finished;
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(update.status().state, 'paused');
    assert.equal(confirmed, false);
    assert.equal(installed, false);
    update[action]();
    await update.wait();
    assert.equal(installed, action === 'resume');
    if (action === 'cancel') assert.deepEqual(fs.readdirSync(directory), []);
  });
}
