// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let root;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pilotdeck-plugin-accounts-'));
  vi.spyOn(os, 'homedir').mockReturnValue(path.join(root, 'os-home'));
  syncBuiltinESMExports();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  vi.resetModules();
  await fs.rm(root, { recursive: true, force: true });
});

async function load(home) {
  vi.stubEnv('PILOT_HOME', home);
  vi.resetModules();
  return import('./plugin-loader.js');
}

async function installFixture(loader, contents) {
  const directory = path.join(loader.getPluginsDir(), 'example');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({
    name: 'example', displayName: 'Example', entry: 'index.js',
  }));
  await fs.writeFile(path.join(directory, 'index.js'), contents);
}

it('isolates plugin files, credentials, enabled state, assets and uninstall between accounts', async () => {
  const aliceHome = path.join(root, 'accounts', 'alice');
  const bobHome = path.join(root, 'accounts', 'bob');
  const alice = await load(aliceHome);
  expect(alice.getPluginsDir()).toBe(path.join(aliceHome, 'plugins'));
  await installFixture(alice, 'alice code');
  alice.savePluginsConfig({ example: { enabled: false, token: 'alice-plugin-secret' } });

  const bob = await load(bobHome);
  expect(bob.scanPlugins()).toEqual([]);
  expect(bob.getPluginsConfig()).toEqual({});
  expect(bob.resolvePluginAssetPath('example', 'index.js')).toBeNull();
  await installFixture(bob, 'bob code');
  bob.savePluginsConfig({ example: { enabled: true, token: 'bob-plugin-secret' } });
  expect(bob.scanPlugins()[0].enabled).toBe(true);
  expect(await fs.readFile(bob.resolvePluginAssetPath('example', 'index.js'), 'utf8')).toBe('bob code');

  const restored = await load(aliceHome);
  expect(restored.getPluginsConfig().example.token).toBe('alice-plugin-secret');
  expect(restored.scanPlugins()[0].enabled).toBe(false);
  await restored.uninstallPlugin('example');
  expect(restored.scanPlugins()).toEqual([]);
  expect(bob.scanPlugins()[0].enabled).toBe(true);
  expect(await fs.readFile(path.join(bobHome, 'plugins', 'example', 'index.js'), 'utf8')).toBe('bob code');
});

it('keeps ~/.pilotdeck plugin defaults when PILOT_HOME is absent', async () => {
  const loader = await load(undefined);
  expect(loader.getPluginsDir()).toBe(path.join(os.homedir(), '.pilotdeck', 'plugins'));
  loader.savePluginsConfig({ legacy: { enabled: false } });
  expect(JSON.parse(await fs.readFile(path.join(os.homedir(), '.pilotdeck', 'plugins.json'), 'utf8')))
    .toEqual({ legacy: { enabled: false } });
});
