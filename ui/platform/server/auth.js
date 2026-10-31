import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcrypt';
import {
  asyncRoute, audit, httpError, integer, objectBody, onlyFields, pagination, stringList, text,
} from './schema.js';

const PREFIX = '/api/platform';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_MS = 10 * 60 * 1000;
const hashToken = (value) => createHash('sha256').update(value).digest('hex');

export function normalizeEmail(value) {
  const email = text(value, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'INVALID_INPUT', 'Invalid email.');
  return email;
}

export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 12 || Buffer.byteLength(value, 'utf8') > 72 || value.includes('\0')) {
    throw httpError(400, 'INVALID_PASSWORD', 'Password must contain at least 12 characters and at most 72 UTF-8 bytes.');
  }
  return value;
}

export function publicUser(row) {
  return {
    id: row.id, email: row.email, role: row.role, status: row.status,
    deviceLimit: row.role === 'admin' ? 1 : row.device_limit, concurrencyLimit: row.concurrency_limit,
    apps: JSON.parse(row.apps), createdAt: row.created_at,
  };
}

export function checkApps(db, value) {
  const apps = stringList(value, 'apps');
  const exists = db.prepare('SELECT id FROM apps WHERE id = ?');
  if (apps.some((id) => !exists.get(id))) throw httpError(400, 'INVALID_APP', 'Unknown application.');
  return apps;
}

export function createAuthContext(db, { codeKey }) {
  // Upgrade legacy administrator sessions while preserving the latest valid login.
  db.transaction(() => {
    const now = Date.now();
    for (const admin of db.prepare("SELECT id FROM users WHERE role='admin'").all()) {
      const latest = db.prepare(`SELECT id FROM sessions WHERE user_id=? AND expires_at>?
        ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(admin.id, now);
      db.prepare('DELETE FROM sessions WHERE user_id=? AND id<>?').run(admin.id, latest?.id ?? '');
      db.prepare('UPDATE users SET device_limit=1 WHERE id=?').run(admin.id);
    }
  }).immediate();
  const keyedHash = (value) => createHmac('sha256', codeKey).update(value).digest('hex');
  const consumeRate = db.transaction((scope, value, limit, windowMs) => {
    const now = Date.now();
    db.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').run(now);
    const key = keyedHash(`${scope}:${value}`);
    const row = db.prepare('SELECT * FROM rate_limits WHERE key = ?').get(key);
    if (row && row.count >= limit) {
      const error = httpError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
      error.retryAfter = Math.max(1, Math.ceil((row.expires_at - now) / 1000));
      return error;
    }
    db.prepare(`INSERT INTO rate_limits(key,count,expires_at) VALUES (?,1,?)
      ON CONFLICT(key) DO UPDATE SET count = count + 1`).run(key, now + windowMs);
    return null;
  });
  const rateLimit = (scope, value, limit, windowMs) => {
    const error = consumeRate(scope, value, limit, windowMs);
    if (error) throw error;
  };
  const requireUser = (req, res, next) => {
    try {
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
      if (!match) throw httpError(401, 'UNAUTHORIZED', 'Sign in required.');
      const session = db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?').get(hashToken(match[1]), Date.now());
      const user = session && db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
      if (!user || user.status !== 'active') throw httpError(401, 'UNAUTHORIZED', 'Session is no longer valid.');
      req.platformUser = user;
      req.platformSession = session;
      if (session.last_seen_at < Date.now() - 60000) db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(Date.now(), session.id);
      next();
    } catch (error) { next(error); }
  };
  const requireAdmin = (req, res, next) => requireUser(req, res, (error) => {
    if (error) return next(error);
    if (req.platformUser.role !== 'admin') return next(httpError(403, 'FORBIDDEN', 'Administrator access required.'));
    next();
  });
  return { requireUser, requireAdmin, rateLimit, keyedHash };
}

function createSession(db, user, device) {
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  if (user.role === 'admin') {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  } else {
    const existing = db.prepare('SELECT id FROM sessions WHERE user_id = ? AND device_id = ?').get(user.id, device.id);
    const count = db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(user.id).count;
    if (!existing && count >= user.device_limit) throw httpError(409, 'DEVICE_LIMIT', 'Device limit reached. Sign out an existing device first.');
    if (existing) db.prepare('DELETE FROM sessions WHERE id = ?').run(existing.id);
  }
  const token = randomBytes(32).toString('base64url');
  db.prepare(`INSERT INTO sessions(id,user_id,token_hash,device_id,device_name,created_at,last_seen_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(), user.id, hashToken(token), device.id, device.name, now, now, now + SESSION_MS);
  return { token, user: publicUser(user) };
}

const readDevice = (body) => ({ id: text(body.deviceId, 'device ID', 128), name: text(body.deviceName ?? 'Unnamed device', 'device name', 100) });

function insertUser(db, email, passwordHash, settings, overrides = {}) {
  const user = {
    id: randomUUID(), email, password_hash: passwordHash, role: 'user', status: 'active',
    device_limit: settings.deviceLimit, concurrency_limit: settings.concurrencyLimit,
    apps: JSON.stringify(settings.defaultApps), created_at: Date.now(), ...overrides,
  };
  db.prepare(`INSERT INTO users(id,email,password_hash,role,status,device_limit,concurrency_limit,apps,created_at)
    VALUES (@id,@email,@password_hash,@role,@status,@device_limit,@concurrency_limit,@apps,@created_at)`).run(user);
  return user;
}

export async function bootstrapAdministrator(db, bootstrapAdmin, getSettings) {
  if (!bootstrapAdmin) return;
  const email = normalizeEmail(bootstrapAdmin.email);
  const password = validatePassword(bootstrapAdmin.password);
  const existing = db.prepare("SELECT * FROM users WHERE role = 'admin'").get();
  if (existing) {
    if (existing.email !== email) throw new Error('Bootstrap administrator differs from the existing administrator.');
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  db.transaction(() => {
    if (db.prepare("SELECT id FROM users WHERE role = 'admin'").get()) return;
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw new Error('Bootstrap email already belongs to a customer.');
    const user = insertUser(db, email, passwordHash, getSettings(), { role: 'admin', device_limit: 1 });
    audit(db, user.id, 'admin.bootstrap', user.id);
  })();
}

export function mountAuth(app, ctx) {
  const { db, requireUser, requireAdmin, getSettings, sendCode, grantSignupGift, rateLimit, keyedHash } = ctx;
  const route = (method, path, ...handlers) => app[method](`${PREFIX}${path}`, ...handlers.map(asyncRoute));
  const codeHash = (email, purpose, code) => keyedHash(`${email}:${purpose}:${code}`);
  // Failed attempts commit independently so throwing in the registration transaction cannot undo them.
  const verifyCode = (email, purpose, code) => {
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw httpError(400, 'INVALID_CODE', 'Invalid or expired verification code.');
    const row = db.prepare('SELECT * FROM email_codes WHERE email = ? AND purpose = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(email, purpose);
    if (!row || row.used_at !== null || row.expires_at <= Date.now() || row.attempts >= 5) throw httpError(400, 'INVALID_CODE', 'Invalid or expired verification code.');
    db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    if (!timingSafeEqual(Buffer.from(row.code_hash, 'hex'), Buffer.from(codeHash(email, purpose, code), 'hex'))) {
      throw httpError(400, 'INVALID_CODE', 'Invalid or expired verification code.');
    }
    return row.id;
  };
  const consumeCode = (id) => {
    const updated = db.prepare('UPDATE email_codes SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?').run(Date.now(), id, Date.now());
    if (updated.changes !== 1) throw httpError(400, 'INVALID_CODE', 'Invalid or expired verification code.');
  };
  const userById = (id) => {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!row) throw httpError(404, 'NOT_FOUND', 'User not found.');
    return row;
  };
  const listDevices = (userId, currentId) => db.prepare(`SELECT id,device_id,device_name,created_at,last_seen_at,expires_at
    FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC`).all(userId, Date.now()).map((row) => ({
    id: row.id, deviceId: row.device_id, deviceName: row.device_name, createdAt: row.created_at,
    lastSeenAt: row.last_seen_at, expiresAt: row.expires_at, current: row.id === currentId,
  }));

  route('post', '/auth/code', async (req, res) => {
    onlyFields(req.body, ['email', 'purpose']);
    const email = normalizeEmail(req.body.email);
    const purpose = req.body.purpose;
    if (!['register', 'reset-password'].includes(purpose)) throw httpError(400, 'INVALID_INPUT', 'Invalid verification purpose.');
    rateLimit('code-ip', req.ip, 10, 15 * 60000);
    rateLimit('code-email', email, 1, 60000);
    rateLimit('code-email-day', email, 10, 24 * 60 * 60000);
    if (purpose === 'register' && !getSettings().registrationEnabled) throw httpError(403, 'REGISTRATION_DISABLED', 'Registration is disabled.');
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if ((purpose === 'register' && existing) || (purpose === 'reset-password' && !existing)) return res.json({ ok: true });
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const id = randomUUID();
    db.transaction(() => {
      db.prepare('DELETE FROM email_codes WHERE expires_at < ?').run(Date.now() - 24 * 60 * 60000);
      db.prepare('UPDATE email_codes SET used_at = ? WHERE email = ? AND purpose = ? AND used_at IS NULL').run(Date.now(), email, purpose);
      db.prepare('INSERT INTO email_codes(id,email,purpose,code_hash,created_at,expires_at) VALUES (?,?,?,?,?,?)')
        .run(id, email, purpose, codeHash(email, purpose, code), Date.now(), Date.now() + CODE_MS);
    })();
    try { await sendCode({ email, purpose, code, expiresInMinutes: 10 }); }
    catch {
      db.prepare('UPDATE email_codes SET used_at = ? WHERE id = ?').run(Date.now(), id);
      throw httpError(503, 'MAIL_UNAVAILABLE', 'Verification email could not be sent. Try again later.');
    }
    res.json({ ok: true });
  });

  route('post', '/auth/register', async (req, res) => {
    onlyFields(req.body, ['email', 'password', 'code', 'deviceId', 'deviceName']);
    rateLimit('register-ip', req.ip, 15, 15 * 60000);
    const email = normalizeEmail(req.body.email);
    const password = validatePassword(req.body.password);
    const device = readDevice(req.body);
    if (!getSettings().registrationEnabled) throw httpError(403, 'REGISTRATION_DISABLED', 'Registration is disabled.');
    const codeId = verifyCode(email, 'register', req.body.code);
    const passwordHash = await bcrypt.hash(password, 12);
    const result = db.transaction(() => {
      const settings = getSettings();
      if (!settings.registrationEnabled) throw httpError(403, 'REGISTRATION_DISABLED', 'Registration is disabled.');
      consumeCode(codeId);
      if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw httpError(400, 'REGISTRATION_FAILED', 'Registration could not be completed.');
      const user = insertUser(db, email, passwordHash, settings);
      grantSignupGift(db, user.id, settings);
      return createSession(db, user, device);
    })();
    res.status(201).json(result);
  });

  // A fixed hash keeps unknown-email login on the same bcrypt path as a known user.
  const dummyHash = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxJfvOjPXoHM6hAEfFoWpFS5rLu';
  route('post', '/auth/login', async (req, res) => {
    onlyFields(req.body, ['email', 'password', 'deviceId', 'deviceName']);
    rateLimit('login-ip', req.ip, 60, 15 * 60000);
    const email = normalizeEmail(req.body.email);
    rateLimit('login-email', email, 15, 15 * 60000);
    const device = readDevice(req.body);
    const candidate = typeof req.body.password === 'string' && Buffer.byteLength(req.body.password) <= 72 ? req.body.password : '';
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const matched = await bcrypt.compare(candidate, user?.password_hash ?? dummyHash);
    if (!user || !matched || user.status !== 'active') throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    const result = db.transaction(() => {
      const current = userById(user.id);
      if (current.status !== 'active' || current.password_hash !== user.password_hash) throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
      return createSession(db, current, device);
    })();
    res.json(result);
  });

  route('post', '/auth/reset-password', async (req, res) => {
    onlyFields(req.body, ['email', 'code', 'password', 'newPassword']);
    rateLimit('reset-ip', req.ip, 15, 15 * 60000);
    const email = normalizeEmail(req.body.email);
    const password = validatePassword(req.body.newPassword ?? req.body.password);
    const codeId = verifyCode(email, 'reset-password', req.body.code);
    const passwordHash = await bcrypt.hash(password, 12);
    db.transaction(() => {
      consumeCode(codeId);
      const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (!user) throw httpError(400, 'INVALID_CODE', 'Invalid or expired verification code.');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      db.prepare('UPDATE email_codes SET used_at = ? WHERE email = ? AND used_at IS NULL').run(Date.now(), email);
      audit(db, user.id, 'password.reset', user.id);
    })();
    res.json({ ok: true });
  });

  route('get', '/me', requireUser, (req, res) => res.json({ user: publicUser(req.platformUser) }));
  route('post', '/auth/logout', requireUser, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.platformSession.id);
    res.json({ ok: true });
  });
  route('post', '/auth/change-password', requireUser, async (req, res) => {
    onlyFields(req.body, ['currentPassword', 'newPassword']);
    rateLimit('change-password', req.platformUser.id, 10, 15 * 60000);
    const password = validatePassword(req.body.newPassword);
    const current = typeof req.body.currentPassword === 'string' && Buffer.byteLength(req.body.currentPassword) <= 72 ? req.body.currentPassword : '';
    if (!await bcrypt.compare(current, req.platformUser.password_hash)) throw httpError(400, 'INVALID_PASSWORD', 'Current password is incorrect.');
    const passwordHash = await bcrypt.hash(password, 12);
    db.transaction(() => {
      const changed = db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ? AND status = ?')
        .run(passwordHash, req.platformUser.id, req.platformUser.password_hash, 'active');
      if (changed.changes !== 1 || !db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.platformSession.id)) {
        throw httpError(401, 'UNAUTHORIZED', 'Session is no longer valid.');
      }
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.platformUser.id);
      db.prepare('UPDATE email_codes SET used_at = ? WHERE email = ? AND used_at IS NULL').run(Date.now(), req.platformUser.email);
      audit(db, req.platformUser.id, 'password.change', req.platformUser.id);
    })();
    res.json({ ok: true });
  });
  route('get', '/devices', requireUser, (req, res) => res.json({ devices: listDevices(req.platformUser.id, req.platformSession.id) }));
  route('delete', '/devices/:id', requireUser, (req, res) => {
    const deleted = db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(req.params.id, req.platformUser.id);
    if (!deleted.changes) throw httpError(404, 'NOT_FOUND', 'Device not found.');
    res.json({ ok: true });
  });
  route('get', '/admin/users', requireAdmin, (req, res) => {
    const { limit, offset } = pagination(req.query);
    const search = req.query.q === undefined ? '' : text(req.query.q, 'search', 254, 0);
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    const users = db.prepare("SELECT * FROM users WHERE email LIKE ? ESCAPE '\\' ORDER BY created_at DESC,id LIMIT ? OFFSET ?").all(pattern, limit, offset);
    const total = db.prepare("SELECT count(*) AS total FROM users WHERE email LIKE ? ESCAPE '\\'").get(pattern).total;
    res.json({ users: users.map(publicUser), total });
  });
  route('get', '/admin/users/:id', requireAdmin, (req, res) => res.json({ user: publicUser(userById(req.params.id)) }));
  route('post', '/admin/users', requireAdmin, async (req, res) => {
    onlyFields(req.body, ['email', 'password', 'deviceLimit', 'concurrencyLimit', 'apps']);
    rateLimit('admin-create', req.platformUser.id, 30, 60000);
    const email = normalizeEmail(req.body.email);
    const passwordHash = await bcrypt.hash(validatePassword(req.body.password), 12);
    const settings = getSettings();
    const overrides = {};
    if (req.body.deviceLimit !== undefined) overrides.device_limit = integer(req.body.deviceLimit, 'device limit', 1, 100);
    if (req.body.concurrencyLimit !== undefined) overrides.concurrency_limit = integer(req.body.concurrencyLimit, 'concurrency limit', 1, 100);
    if (req.body.apps !== undefined) overrides.apps = JSON.stringify(checkApps(db, req.body.apps));
    const user = db.transaction(() => {
      if (!db.prepare("SELECT id FROM sessions WHERE id = ?").get(req.platformSession.id)) throw httpError(401, 'UNAUTHORIZED', 'Session is no longer valid.');
      if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw httpError(409, 'EMAIL_EXISTS', 'Email is already registered.');
      const created = insertUser(db, email, passwordHash, settings, overrides);
      audit(db, req.platformUser.id, 'user.create', created.id);
      return created;
    })();
    res.status(201).json({ user: publicUser(user) });
  });
  route('patch', '/admin/users/:id', requireAdmin, (req, res) => {
    onlyFields(req.body, ['status', 'deviceLimit', 'concurrencyLimit', 'apps']);
    const user = userById(req.params.id);
    if (user.role === 'admin') throw httpError(400, 'ADMIN_PROTECTED', 'Administrator account cannot be changed through customer management.');
    const status = req.body.status ?? user.status;
    if (!['active', 'disabled'].includes(status)) throw httpError(400, 'INVALID_INPUT', 'Invalid status.');
    const deviceLimit = req.body.deviceLimit === undefined ? user.device_limit : integer(req.body.deviceLimit, 'device limit', 1, 100);
    const concurrencyLimit = req.body.concurrencyLimit === undefined ? user.concurrency_limit : integer(req.body.concurrencyLimit, 'concurrency limit', 1, 100);
    const apps = req.body.apps === undefined ? user.apps : JSON.stringify(checkApps(db, req.body.apps));
    db.transaction(() => {
      db.prepare('UPDATE users SET status = ?, device_limit = ?, concurrency_limit = ?, apps = ? WHERE id = ?')
        .run(status, deviceLimit, concurrencyLimit, apps, user.id);
      if (status === 'disabled') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      audit(db, req.platformUser.id, 'user.update', user.id);
    })();
    res.json({ user: publicUser(userById(user.id)) });
  });
  route('post', '/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
    onlyFields(req.body, ['password', 'newPassword']);
    rateLimit('admin-reset', req.platformUser.id, 15, 60000);
    const user = userById(req.params.id);
    if (user.role === 'admin') throw httpError(400, 'ADMIN_PROTECTED', 'Use the administrator password change flow.');
    const passwordHash = await bcrypt.hash(validatePassword(req.body.newPassword ?? req.body.password), 12);
    db.transaction(() => {
      if (!db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.platformSession.id)) throw httpError(401, 'UNAUTHORIZED', 'Session is no longer valid.');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      db.prepare('UPDATE email_codes SET used_at = ? WHERE email = ? AND used_at IS NULL').run(Date.now(), user.email);
      audit(db, req.platformUser.id, 'user.password-reset', user.id);
    })();
    res.json({ ok: true });
  });
  route('get', '/admin/users/:id/devices', requireAdmin, (req, res) => {
    userById(req.params.id);
    res.json({ devices: listDevices(req.params.id, req.platformSession.id) });
  });
  route('delete', '/admin/users/:id/devices/:deviceId?', requireAdmin, (req, res) => {
    const user = userById(req.params.id);
    db.transaction(() => {
      const deleted = req.params.deviceId
        ? db.prepare('DELETE FROM sessions WHERE user_id = ? AND id = ?').run(user.id, req.params.deviceId)
        : db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
      if (req.params.deviceId && !deleted.changes) throw httpError(404, 'NOT_FOUND', 'Device not found.');
      audit(db, req.platformUser.id, 'user.sessions-revoke', user.id);
    })();
    res.json({ ok: true });
  });
}
