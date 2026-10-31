import fs from 'node:fs/promises';
import path from 'node:path';
import { platformRequest } from './managedBootstrap.js';

export function apiApplication(pathname) {
  if (/^\/(always-on|cron)(\/|$)/.test(pathname)) return 'automation';
  if (/^\/(skills|commands)(\/|$)/.test(pathname)) return 'skills';
  if (/^\/computer-use(\/|$)/.test(pathname)) return 'computer';
  if (/^\/mcp(?:-utils)?(\/|$)/.test(pathname)) return 'mcp';
  if (/^\/plugins(\/|$)/.test(pathname)) return 'plugins';
  if (/^\/(browse-filesystem|create-folder|uploads|office-preview)(\/|$)/.test(pathname) ||
      /^\/projects\/[^/]+\/(files?|download|preview)(\/|$)/.test(pathname)) return 'files';
  if (/^\/projects(\/|$)/.test(pathname)) return 'projects';
  return null;
}

export function createManagedAppGuard({ env = process.env, request = platformRequest } = {}) {
  let current;
  let checked = 0;
  let pending;
  async function account() {
    if (current && Date.now() - checked < 5000) return current;
    if (!pending) pending = (async () => {
      let user;
      let offline = false;
      try {
        const response = await request(env, '/me');
        if (!response.ok) throw Object.assign(new Error('登录状态已失效，请重新登录。'), { status: response.status });
        const data = await response.json();
        user = data.user || data;
      } catch (error) {
        if (error.status || !env.PILOT_HOME) throw error;
        user = JSON.parse(await fs.readFile(path.join(env.PILOT_HOME, 'managed-user.json'), 'utf8'));
        offline = true;
      }
      if (user.id !== env.PILOTDECK_MANAGED_USER_ID || user.status !== 'active' || !Array.isArray(user.apps)) {
        throw Object.assign(new Error('账户权限无效。'), { status: 403 });
      }
      checked = Date.now();
      current = { user, offline };
      return current;
    })().finally(() => { pending = null; });
    return pending;
  }
  return (application) => async (req, res, next) => {
    if (!env.PILOTDECK_MANAGED_URL || !application) return next();
    try {
      const { user, offline } = await account();
      if (!user.apps.includes(application)) return res.status(403).json({ error: '此应用未向当前账户开放。', code: 'APP_FORBIDDEN' });
      if (offline && !['GET', 'HEAD'].includes(req.method)) return res.status(503).json({ error: '当前离线，请联网后重试。' });
      next();
    } catch (error) {
      res.status(error.status || 503).json({ error: error.status ? error.message : '无法验证账户权限，请检查网络。' });
    }
  };
}
