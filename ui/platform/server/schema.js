import { randomUUID } from 'node:crypto';

export const DEFAULT_APPS = [
  ['chat', 'Chat'], ['automation', 'Automation'], ['skills', 'Skills'],
  ['learning', 'Learning'], ['projects', 'Projects'], ['files', 'Files'],
  ['terminal', 'Terminal'], ['computer', 'Computer'], ['plugins', 'Plugins'], ['mcp', 'MCP'],
];

export const DEFAULT_SETTINGS = {
  registrationEnabled: true, deviceLimit: 3, concurrencyLimit: 3,
  defaultApps: DEFAULT_APPS.map(([id]) => id),
  giftEnabled: false, giftAmountMicros: 0, giftExpiryDays: null,
};

export const MAX_APP_MODELS = 5000;

export function initSchema(db) {
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','user')),
      status TEXT NOT NULL CHECK(status IN ('active','disabled')),
      device_limit INTEGER NOT NULL CHECK(device_limit BETWEEN 1 AND 100),
      concurrency_limit INTEGER NOT NULL CHECK(concurrency_limit BETWEEN 1 AND 100),
      apps TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS single_platform_admin ON users(role) WHERE role = 'admin';
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL UNIQUE, device_id TEXT NOT NULL, device_name TEXT NOT NULL,
      created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      UNIQUE(user_id, device_id)
    );
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS email_codes (
      id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE, purpose TEXT NOT NULL,
      code_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS email_codes_lookup ON email_codes(email,purpose,created_at);
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits(expires_at);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS platform_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL,
      protocol TEXT NOT NULL CHECK(protocol IN ('openai','openai-responses','anthropic','google')),
      base_url TEXT NOT NULL, upstream_model TEXT NOT NULL, secret TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
      input_price_micros INTEGER NOT NULL CHECK(input_price_micros >= 0),
      output_price_micros INTEGER NOT NULL CHECK(output_price_micros >= 0),
      max_input_tokens INTEGER NOT NULL CHECK(max_input_tokens > 0),
      max_output_tokens INTEGER NOT NULL CHECK(max_output_tokens > 0),
      capabilities TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
      default_model_id TEXT REFERENCES models(id), model_ids TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS releases (
      id TEXT PRIMARY KEY, version TEXT NOT NULL UNIQUE, notes TEXT NOT NULL,
      download_url TEXT NOT NULL, sha256 TEXT NOT NULL, size_bytes INTEGER NOT NULL,
      platform TEXT NOT NULL, created_at INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT REFERENCES users(id),
      action TEXT NOT NULL, target_id TEXT, created_at INTEGER NOT NULL
    );
  `);
  initChannels(db);
  db.transaction(() => {
    const setting = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) setting.run(key, JSON.stringify(value));
    const app = db.prepare('INSERT OR IGNORE INTO apps(id,name,enabled,default_model_id,model_ids) VALUES (?,?,1,NULL,?)');
    for (const [id, name] of DEFAULT_APPS) app.run(id, name, '[]');
  })();
}

export function initChannels(db) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL,
      protocol TEXT NOT NULL CHECK(protocol IN ('openai','openai-responses','anthropic','google')),
      base_url TEXT NOT NULL, secret TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
    )`);
    if (!db.pragma('table_info(models)').some(column => column.name === 'channel_id')) {
      db.exec('ALTER TABLE models ADD COLUMN channel_id TEXT REFERENCES channels(id)');
    }
    const insert = db.prepare('INSERT INTO channels(id,name,provider,protocol,base_url,secret,enabled) VALUES (?,?,?,?,?,?,1)');
    const migrate = db.prepare("UPDATE models SET channel_id=?,provider='',protocol='openai',base_url='',secret='' WHERE id=?");
    // Keep ciphertext byte-for-byte and isolate every legacy connection, including disabled models.
    for (const model of db.prepare('SELECT * FROM models WHERE channel_id IS NULL').all()) {
      const channelId = randomUUID();
      insert.run(channelId, model.name, model.provider, model.protocol, model.base_url, model.secret);
      migrate.run(channelId, model.id);
    }
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS models_channel_upstream ON models(channel_id,upstream_model);
      CREATE TRIGGER IF NOT EXISTS models_channel_required_insert BEFORE INSERT ON models
        WHEN NEW.channel_id IS NULL BEGIN SELECT RAISE(ABORT,'Model requires a channel'); END;
      CREATE TRIGGER IF NOT EXISTS models_channel_required_update BEFORE UPDATE OF channel_id ON models
        WHEN NEW.channel_id IS NULL BEGIN SELECT RAISE(ABORT,'Model requires a channel'); END;
    `);
  }).immediate();
}

export function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code, public: true });
}

export function objectBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError(400, 'INVALID_INPUT', 'Expected a JSON object.');
  return value;
}

export function onlyFields(body, allowed) {
  objectBody(body);
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw httpError(400, 'INVALID_INPUT', 'Unsupported field.');
}

export function text(value, label, max = 200, min = 1) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw httpError(400, 'INVALID_INPUT', `Invalid ${label}.`);
  }
  return value.trim();
}

export function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(value)) throw httpError(400, 'INVALID_INPUT', 'Invalid identifier.');
  return value;
}

export function integer(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw httpError(400, 'INVALID_INPUT', `Invalid ${label}.`);
  return value;
}

export function boolean(value, label) {
  if (typeof value !== 'boolean') throw httpError(400, 'INVALID_INPUT', `Invalid ${label}.`);
  return value;
}

export function stringList(value, label, max = 100) {
  if (!Array.isArray(value) || value.length > max) throw httpError(400, 'INVALID_INPUT', `Invalid ${label}.`);
  const result = value.map(identifier);
  if (new Set(result).size !== result.length) throw httpError(400, 'INVALID_INPUT', `Duplicate ${label}.`);
  return result;
}

export function audit(db, actor, action, target = null) {
  db.prepare('INSERT INTO audit_log(actor_id,action,target_id,created_at) VALUES (?,?,?,?)')
    .run(actor, action, target, Date.now());
}

export const asyncRoute = (handler) => (req, res, next) => Promise.resolve().then(() => handler(req, res, next)).catch(next);

export function pagination(query) {
  const parse = (value, fallback, max) => value === undefined ? fallback :
    typeof value === 'string' && /^\d{1,9}$/.test(value) ? integer(Number(value), 'pagination', 0, max) :
      (() => { throw httpError(400, 'INVALID_INPUT', 'Invalid pagination.'); })();
  return { limit: Math.max(1, parse(query.limit, 100, 500)), offset: parse(query.offset, 0, 10000000) };
}
