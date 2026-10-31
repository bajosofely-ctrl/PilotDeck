// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { createEducationApp } from './server.js';

const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function serveSite(prepare) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pilotdeck-education-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const siteRoot = path.join(directory, 'site');
  await mkdir(path.join(siteRoot, 'data'), { recursive: true });
  await writeFile(path.join(siteRoot, 'index.html'), '<h1>Education fixture</h1>');
  await writeFile(path.join(siteRoot, 'data', 'topics.json'), '{"topics":[{"id":"sample"}]}');
  await writeFile(path.join(directory, 'private.txt'), 'not public');
  await prepare?.({ directory, siteRoot });
  const app = createEducationApp({
    siteRoot,
    frameAncestors: ['http://localhost:3001'],
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanups.push(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

describe('isolated education HTTP service', () => {
  it('serves education content with an explicit network and embedding boundary', async () => {
    const origin = await serveSite();
    const page = await fetch(origin);
    expect(await page.text()).toContain('Education fixture');
    const csp = page.headers.get('content-security-policy');
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain('frame-ancestors http://localhost:3001');
    expect(page.headers.get('access-control-allow-origin')).toBeNull();
    const data = await fetch(`${origin}/data/topics.json`);
    expect(await data.json()).toEqual({ topics: [{ id: 'sample' }] });
  });

  it('does not serve host APIs, repository files or traversal paths', async () => {
    const origin = await serveSite();
    for (const pathname of ['/api/config', '/.git/config', '/%2e%2e%2fprivate.txt', '/missing/']) {
      const response = await fetch(origin + pathname);
      expect(response.status, pathname).toBe(404);
      expect(await response.text()).not.toContain('not public');
    }
    expect((await fetch(origin, { method: 'POST', body: 'ignored' })).status).toBe(404);
  });

  it('exposes only service readiness at the health endpoint', async () => {
    const origin = await serveSite();
    const response = await fetch(`${origin}/_health`);
    expect(await response.json()).toEqual({ status: 'ok', service: 'pilotdeck-education' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects an index symlink pointing outside the public site', async (context) => {
    let origin;
    try {
      origin = await serveSite(async ({ directory, siteRoot }) => {
        await mkdir(path.join(siteRoot, 'linked'));
        await symlink(path.join(directory, 'private.txt'), path.join(siteRoot, 'linked', 'index.html'), 'file');
      });
    } catch (error) {
      if (error.code === 'EPERM') {
        context.skip('Creating file symlinks requires Windows Developer Mode or administrator rights.');
        return;
      }
      throw error;
    }
    const response = await fetch(`${origin}/linked/`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('not public');
  });
});
