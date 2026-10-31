// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let root;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pilotdeck-session-accounts-'));
  vi.spyOn(os, 'homedir').mockReturnValue(path.join(root, 'os-home'));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
  await fs.rm(root, { recursive: true, force: true });
});

async function seed(directory, content) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'same-session.json'), JSON.stringify({
    id: 'same-session', projectPath: '/explicit/shared/project',
    createdAt: new Date(), lastActivity: new Date(),
    messages: [{ role: 'user', content, timestamp: new Date() }],
  }));
}

async function load(home, managed = true) {
  vi.stubEnv('PILOT_HOME', home);
  vi.stubEnv('PILOTDECK_MANAGED_URL', managed ? 'https://operator.example.test' : undefined);
  vi.resetModules();
  const manager = (await import('./sessionManager.js')).default;
  await manager.ready;
  return manager;
}

it('managed legacy-session reads, writes and deletes stay within the selected account, even for the same project/id', async () => {
  const aliceHome = path.join(root, 'accounts', 'alice');
  const bobHome = path.join(root, 'accounts', 'bob');
  const aliceDirectory = path.join(aliceHome, 'gemini', 'sessions');
  const bobDirectory = path.join(bobHome, 'gemini', 'sessions');
  const legacyDirectory = path.join(os.homedir(), '.gemini', 'sessions');
  await seed(aliceDirectory, 'alice history');
  await seed(bobDirectory, 'bob history');
  await seed(legacyDirectory, 'legacy history');
  const alice = await load(aliceHome);
  expect(alice.getSession('same-session').messages[0].content).toBe('alice history');
  const bob = await load(bobHome);
  expect(bob.getSession('same-session').messages[0].content).toBe('bob history');
  alice.getSession('same-session').messages[0].content = 'updated alice history';
  await alice.saveSession('same-session');
  expect(JSON.parse(await fs.readFile(path.join(aliceDirectory, 'same-session.json'), 'utf8')).messages[0].content).toBe('updated alice history');
  expect(JSON.parse(await fs.readFile(path.join(bobDirectory, 'same-session.json'), 'utf8')).messages[0].content).toBe('bob history');
  await alice.deleteSession('same-session');
  await expect(fs.stat(path.join(aliceDirectory, 'same-session.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(JSON.parse(await fs.readFile(path.join(bobDirectory, 'same-session.json'), 'utf8')).messages[0].content).toBe('bob history');
  expect(JSON.parse(await fs.readFile(path.join(legacyDirectory, 'same-session.json'), 'utf8')).messages[0].content).toBe('legacy history');
  const restored = await load(bobHome);
  expect(restored.getSession('same-session').messages[0].content).toBe('bob history');
});

it('unmanaged mode keeps its existing Gemini history directory, including with an explicit PILOT_HOME', async () => {
  const legacyDirectory = path.join(os.homedir(), '.gemini', 'sessions');
  await seed(legacyDirectory, 'existing history');
  const manager = await load(path.join(root, 'custom-pilot-home'), false);
  expect(manager.sessionsDir).toBe(legacyDirectory);
  expect(manager.getSession('same-session').messages[0].content).toBe('existing history');
});
