import express from 'express';
import Database from 'better-sqlite3';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initSchema } from './schema.js';
import { bootstrapAdministrator, createAuthContext, mountAuth } from './auth.js';
import { initBilling, grantSignupGift, mountBilling } from './billing.js';
import { mountConfig } from './config.js';
import { createMailService, mountMail } from './mail.js';

export async function createPlatformApp(options = {}) {
  if (typeof options.encryptionKey !== 'string' || options.encryptionKey.length < 32) throw new Error('A private encryption key of at least 32 characters is required.');
  const dbPath = options.dbPath || path.resolve('platform-data/platform.sqlite');
  if (dbPath !== ':memory:') mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  try {
    initSchema(db); initBilling(db);
    const key = createHash('sha256').update(options.encryptionKey).digest();
    const seal = value => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const content = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), content].map(buffer => buffer.toString('base64url')).join('.');
    };
    const unseal = value => {
      const [iv, tag, content] = value.split('.').map(part => Buffer.from(part, 'base64url'));
      const cipher = createDecipheriv('aes-256-gcm', key, iv); cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(content), cipher.final()]).toString('utf8');
    };
    const marker = db.prepare("SELECT value FROM platform_meta WHERE key='encryption-check'").get();
    if (marker) {
      if (unseal(marker.value) !== 'pilotdeck-platform-v1') throw new Error('Encryption key does not match database.');
    } else db.prepare("INSERT INTO platform_meta(key,value) VALUES('encryption-check',?)").run(seal('pilotdeck-platform-v1'));
    const getSettings = () => Object.fromEntries(db.prepare('SELECT * FROM settings').all().map(row => [row.key, JSON.parse(row.value)]));
    const auth = createAuthContext(db, { codeKey: key });
    await bootstrapAdministrator(db, options.bootstrapAdmin, getSettings);
    const app = express();
    app.disable('x-powered-by');
    // Proxy trust is disabled unless explicitly configured for a known deployment.
    if (options.trustProxy) app.set('trust proxy', options.trustProxy);
    app.use((_req, res, next) => {
      res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      next();
    });
    app.use(express.json({ limit: '4mb' }));
    app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'pilotdeck-platform' }));
    const mail = createMailService({ db, seal, unseal, env: options.mailEnv,
      createTransport: options.createMailTransport, request: options.mailFetch });
    const ctx = { db, ...auth, getSettings, seal, unseal, grantSignupGift, fetchImpl: options.fetchImpl || fetch,
      mail, sendCode: options.sendCode || mail.sendCode };
    mountAuth(app, ctx); mountConfig(app, ctx); mountBilling(app, ctx); mountMail(app, ctx);
    app.use('/api', (_req, res) => res.status(404).json({ error: 'API not found.', code: 'NOT_FOUND' }));
    const adminRoot = options.adminRoot || fileURLToPath(new URL('../admin/dist', import.meta.url));
    app.use(express.static(adminRoot, { dotfiles: 'deny' }));
    app.get('*', (_req, res) => res.sendFile(path.join(adminRoot, 'index.html')));
    app.use((error, _req, res, _next) => {
      if (res.headersSent) return res.end();
      const exposed = error.public || error.billingError;
      const status = exposed ? error.status : error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
      res.status(status || 500).json({ error: exposed ? error.message : 'Request could not be processed.', code: exposed ? error.code : 'REQUEST_FAILED' });
    });
    return { app, db, close: () => db.close() };
  } catch (error) { db.close(); throw error; }
}
