// @vitest-environment node
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../database/db.js', () => ({
  userDb: {}, apiKeysDb: {}, githubTokensDb: { getActiveGithubToken: () => null },
}));
vi.mock('../projects.js', () => ({ addProjectManually: async directory => ({ path: directory }) }));
vi.mock('../pilotdeck-bridge.js', () => ({ runChatViaGateway: async () => {} }));
vi.mock('../constants/config.js', () => ({ IS_PLATFORM: false }));
vi.mock('@octokit/rest', () => ({ Octokit: class {} }));
vi.mock('child_process', () => ({
  spawn: vi.fn((_command, args) => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    setImmediate(async () => {
      if (args[0] === 'clone') await fs.mkdir(args.at(-1), { recursive: true });
      child.emit('close', 0);
    });
    return child;
  }),
}));

let root;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pilotdeck-agent-accounts-'));
  vi.spyOn(os, 'homedir').mockReturnValue(path.join(root, 'os-home'));
  syncBuiltinESMExports();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
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
  return import('./agent.js');
}

async function clone(route, projectPath) {
  const handler = route.default.stack.find(layer => layer.route?.path === '/' && layer.route.methods.post).route.stack.at(-1).handle;
  const response = {
    statusCode: 200, status(value) { this.statusCode = value; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler({
    user: { id: 1 },
    body: { githubUrl: 'https://github.com/example/repo', projectPath, message: 'inspect', cleanup: false, stream: false },
  }, response);
  expect(response.statusCode).toBe(200);
  return response.body.projectPath;
}

async function marker(directory) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'keep.txt'), 'keep');
}

it('defaults generated clones to the selected account while retaining explicit filesystem destinations', async () => {
  const aliceHome = path.join(root, 'accounts', 'alice');
  const bobHome = path.join(root, 'accounts', 'bob');
  const alice = await load(aliceHome);
  const first = await clone(alice);
  expect(path.dirname(first)).toBe(path.join(aliceHome, 'external-projects'));
  const bob = await load(bobHome);
  const second = await clone(bob);
  expect(path.dirname(second)).toBe(path.join(bobHome, 'external-projects'));
  expect(second).not.toBe(first);
  const explicit = path.join(root, 'user-picked', 'project');
  expect(await clone(bob, explicit)).toBe(explicit);
  await fs.access(first);
  await fs.access(second);
});

it('preserves the legacy default clone location when PILOT_HOME is absent', async () => {
  const route = await load(undefined);
  expect(path.dirname(await clone(route))).toBe(path.join(os.homedir(), '.pilotdeck', 'external-projects'));
});

it('cleans only its own generated project and session, retaining account ownership after another module loads', async () => {
  const aliceHome = path.join(root, 'accounts', 'alice');
  const bobHome = path.join(root, 'accounts', 'bob');
  const aliceProject = path.join(aliceHome, 'external-projects', 'repo');
  const bobProject = path.join(bobHome, 'external-projects', 'repo');
  const aliceSession = path.join(aliceHome, 'sessions', 'same-session');
  const bobSession = path.join(bobHome, 'sessions', 'same-session');
  for (const directory of [aliceProject, bobProject, aliceSession, bobSession]) await marker(directory);
  const alice = await load(aliceHome);
  await load(bobHome);
  await alice.cleanupProject(aliceProject, 'same-session');
  await expect(fs.stat(aliceProject)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.stat(aliceSession)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(path.join(bobProject, 'keep.txt'), 'utf8')).toBe('keep');
  expect(await fs.readFile(path.join(bobSession, 'keep.txt'), 'utf8')).toBe('keep');
});

it('automatic cleanup rejects sibling accounts, misleading prefixes, and the external-projects root itself', async () => {
  const home = path.join(root, 'accounts', 'alice');
  const route = await load(home);
  const directories = [
    path.join(root, 'accounts', 'bob', '.pilotdeck', 'external-projects', 'repo'),
    path.join(root, 'user-picked', '.pilotdeck', 'external-projects', 'repo'),
    path.join(home, 'external-projects-extra', 'repo'),
    path.join(home, 'external-projects'),
  ];
  for (const directory of directories) {
    await marker(directory);
    await route.cleanupProject(directory);
    expect(await fs.readFile(path.join(directory, 'keep.txt'), 'utf8')).toBe('keep');
  }
});

it('automatic session cleanup cannot traverse out of the account session directory', async () => {
  const home = path.join(root, 'accounts', 'alice');
  const route = await load(home);
  const project = path.join(home, 'external-projects', 'repo');
  const sibling = path.join(root, 'accounts', 'bob', 'sessions', 'session');
  await marker(project);
  await marker(path.join(home, 'sessions'));
  await marker(sibling);
  await route.cleanupProject(project, '../../bob/sessions/session');
  await expect(fs.stat(project)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(path.join(sibling, 'keep.txt'), 'utf8')).toBe('keep');
});

it('automatic cleanup cannot follow a linked external-projects root into another account', async () => {
  const home = path.join(root, 'accounts', 'alice');
  const sibling = path.join(root, 'accounts', 'bob', 'external-projects');
  await fs.mkdir(home, { recursive: true });
  await marker(path.join(sibling, 'repo'));
  await fs.symlink(sibling, path.join(home, 'external-projects'), process.platform === 'win32' ? 'junction' : 'dir');
  const route = await load(home);
  await route.cleanupProject(path.join(home, 'external-projects', 'repo'));
  expect(await fs.readFile(path.join(sibling, 'repo', 'keep.txt'), 'utf8')).toBe('keep');
});
