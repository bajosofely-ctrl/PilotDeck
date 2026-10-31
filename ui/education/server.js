import express from 'express';
import { existsSync, realpathSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCoachRouter } from './coach.js';
import { createClassroomRouter } from './classroom.js';
import { createManagedConfigRouter, createManagedLearning, managedModules } from './managed.js';

const directory = path.dirname(fileURLToPath(import.meta.url));

export function createEducationApp({
  siteRoot = path.join(directory, 'site'),
  frameAncestors = [],
  coach = false,
  moduleId = 'knowledge',
  env = {},
  request = fetch,
} = {}) {
  const root = realpathSync(siteRoot);
  const app = express();
  app.disable('x-powered-by');
  const parents = frameAncestors.map(value => new URL(value).origin).join(' ') || "'none'";
  const learningRuntime = moduleId === 'training-lab';
  const scriptRuntime = moduleId === 'training-lab' ? " 'wasm-unsafe-eval'" : '';
  const policy = [
    "default-src 'self'", `script-src 'self'${moduleId === 'training-lab' ? '' : " 'unsafe-inline'"}${scriptRuntime}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
    `connect-src 'self'${learningRuntime ? ' blob: data:' : ''}`,
    `worker-src 'self'${learningRuntime ? ' blob:' : ''}`, "object-src 'none'",
    "font-src 'self' data:", "media-src 'self' blob: data:",
    "base-uri 'self'", "form-action 'self'", `frame-ancestors ${parents}`,
  ].join('; ');
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': policy,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    next();
  });
  app.get('/_health', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok', service: 'pilotdeck-education' });
  });
  const managed = (coach || managedModules.has(moduleId)) ? createManagedLearning({ env, request }) : null;
  if (coach || managedModules.has(moduleId)) app.use('/api/managed', createManagedConfigRouter(managed));
  if (coach || managedModules.has(moduleId)) {
    app.get('/managed-settings.js', (_req, res) => {
      res.set('Cache-Control', 'no-cache').sendFile(path.join(directory, 'managed-settings.js'));
    });
  }
  if (coach) app.use('/api/coach', createCoachRouter({ request, managed }));
  if (moduleId === 'ai-classroom') app.use('/api/classroom', createClassroomRouter({ request, managed }));
  // express.static blocks traversal; this also excludes symlinks outside the
  // vendored site, so adding a local link cannot expose the parent repository.
  app.use(async (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return res.sendStatus(404);
    try {
      const pathname = decodeURIComponent(req.path);
      if (pathname.includes('\\') || pathname.includes('\0') ||
          pathname.split('/').some(segment => segment.startsWith('.'))) {
        return res.sendStatus(404);
      }
      let resolved = await realpath(path.resolve(root, `.${pathname}`));
      if ((await stat(resolved)).isDirectory()) {
        resolved = await realpath(path.join(resolved, 'index.html'));
      }
      const relative = path.relative(root, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return res.sendStatus(404);
      next();
    } catch {
      res.sendStatus(404);
    }
  });
  app.use(express.static(root, {
    dotfiles: 'deny',
    index: 'index.html',
    fallthrough: false,
    setHeaders(res) {
      // Stable filenames must revalidate after importing a new upstream snapshot.
      res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.use((_req, res) => res.sendStatus(404));
  app.use((error, _req, res, _next) => {
    res.sendStatus(error.status === 404 ? 404 : 500);
  });
  return app;
}

export async function runEducationServer(env = process.env) {
  const port = Number(env.PILOTDECK_EDUCATION_PORT || 3010);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid education port.');
  }
  const moduleId = env.PILOTDECK_EDUCATION_MODULE || 'knowledge';
  const roots = {
    knowledge: 'site', 'ai-literacy': 'ai-lessons', 'study-coach': 'study-coach',
    'training-lab': 'training-lab',
    'ai-classroom': 'ai-classroom',
  };
  if (!Object.hasOwn(roots, moduleId)) throw new Error('Unknown education module.');
  const siteRoot = path.join(directory, roots[moduleId]);
  if (!existsSync(path.join(siteRoot, 'index.html'))) {
    throw new Error('Education content is missing.');
  }
  const frameAncestors = (env.PILOTDECK_EDUCATION_FRAME_ANCESTORS || '').split(' ').filter(Boolean);
  const app = createEducationApp({ siteRoot, frameAncestors, coach: moduleId === 'study-coach', moduleId, env });
  const server = app.listen(port, '127.0.0.1');
  server.once('error', error => {
    process.send?.({ type: 'education:error', code: error.code || 'START_FAILED' });
    console.error(`[education] Could not listen on ${port}: ${error.code || error.message}`);
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  });
  server.once('listening', () => {
    console.log(`[education] Ready on http://localhost:${port}`);
    process.send?.({ type: 'education:ready', port });
  });
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    server.close(() => {
      if (process.connected) process.disconnect();
    });
    server.closeAllConnections();
  };
  process.once('disconnect', close);
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runEducationServer().catch(error => {
    console.error(`[education] ${error.message}`);
    process.send?.({ type: 'education:error', code: 'START_FAILED' });
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  });
}
