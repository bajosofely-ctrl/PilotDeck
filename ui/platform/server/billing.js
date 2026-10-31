import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { getModel, listModels } from './modelStore.js';

// One unit is 10^-6 micro-RMB. TEXT stores arbitrary-precision integer units in
// SQLite; all arithmetic is BigInt, including token prices and fractional fees.
const SCALE = 1_000_000n;
const MAX_BALANCE = BigInt(Number.MAX_SAFE_INTEGER) * SCALE;
const PREFIX = '/api/platform';
const TIMEOUT_MS = 120_000;
const LEASE_MS = TIMEOUT_MS + 60_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_EVENT_BYTES = 1024 * 1024;
const PROTOCOLS = new Set(['openai', 'openai-responses', 'anthropic', 'google']);

function fail(status, code, message) {
  const error = new Error(message);
  Object.assign(error, { status, code, billingError: true });
  throw error;
}
function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(400, 'INVALID_ARGUMENT', `Invalid ${name}`);
  }
  return value;
}
function text(value, name, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail(400, 'INVALID_ARGUMENT', `Invalid ${name}`);
  }
  return value.trim();
}
function parseArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every(item => typeof item === 'string') ? parsed : [];
  } catch { return []; }
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const digest = value => createHash('sha256').update(value).digest('hex');
const micros = units => Number(BigInt(units) / SCALE);
const transaction = (db, work) => db.transaction(work).immediate();

export function initBilling(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS billing_signup (
      user_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS billing_lots (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT,
      original_units TEXT NOT NULL, balance_units TEXT NOT NULL, held_units TEXT NOT NULL,
      expires_at INTEGER, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS billing_lots_user ON billing_lots(user_id);
    CREATE TABLE IF NOT EXISTS billing_ledger (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, amount_units TEXT NOT NULL,
      request_key TEXT NOT NULL, fingerprint TEXT, call_id TEXT, actor_id TEXT, reason TEXT,
      reference TEXT, before_units TEXT NOT NULL, after_units TEXT NOT NULL, created_at INTEGER NOT NULL,
      UNIQUE(user_id, request_key)
    );
    CREATE TABLE IF NOT EXISTS billing_code_batches (
      request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, actor_id TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS billing_codes (
      id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, code_hash TEXT NOT NULL UNIQUE, sealed_code TEXT NOT NULL,
      amount_micros INTEGER NOT NULL, expires_at INTEGER, created_at INTEGER NOT NULL, actor_id TEXT NOT NULL,
      revoked_at INTEGER, revoked_by TEXT, redeemed_at INTEGER, redeemed_by TEXT, ledger_id TEXT
    );
    CREATE TABLE IF NOT EXISTS billing_calls (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
      app_id TEXT NOT NULL, model_id TEXT NOT NULL, status TEXT NOT NULL, active_until INTEGER,
      input_bound INTEGER NOT NULL, output_bound INTEGER NOT NULL,
      input_price_micros INTEGER NOT NULL, output_price_micros INTEGER NOT NULL,
      reserved_units TEXT NOT NULL, charged_units TEXT NOT NULL DEFAULT '0',
      input_tokens INTEGER, output_tokens INTEGER, reason TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(user_id, request_key)
    );
    CREATE INDEX IF NOT EXISTS billing_calls_user ON billing_calls(user_id, status, active_until);
    CREATE TABLE IF NOT EXISTS billing_allocations (
      call_id TEXT NOT NULL, lot_id TEXT NOT NULL, held_units TEXT NOT NULL, charged_units TEXT NOT NULL DEFAULT '0',
      position INTEGER NOT NULL, PRIMARY KEY(call_id,lot_id)
    );
    CREATE TABLE IF NOT EXISTS billing_reviews (
      request_id TEXT PRIMARY KEY, call_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
      actor_id TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, evidence TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS billing_refunds (
      id TEXT PRIMARY KEY, call_id TEXT NOT NULL, lot_id TEXT NOT NULL,
      units TEXT NOT NULL, request_key TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS billing_redeem_attempts (
      user_id TEXT PRIMARY KEY, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL
    );
  `);
}

function lots(db, userId) {
  return db.prepare(`SELECT * FROM billing_lots WHERE user_id=?
    ORDER BY CASE WHEN source='gift' THEN 0 ELSE 1 END,
      CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at, created_at, id`).all(userId);
}
function wallet(db, userId, now = Date.now()) {
  let available = 0n, held = 0n, gift = 0n, recharge = 0n, adjustment = 0n, expired = 0n;
  for (const lot of lots(db, userId)) {
    const balance = BigInt(lot.balance_units);
    const reserved = BigInt(lot.held_units);
    held += reserved;
    if (lot.expires_at !== null && lot.expires_at <= now) {
      expired += balance - reserved;
      continue;
    }
    available += balance - reserved;
    if (lot.source === 'gift') gift += balance - reserved;
    if (lot.source === 'recharge') recharge += balance - reserved;
    if (lot.source === 'adjustment') adjustment += balance - reserved;
  }
  return {
    availableMicros: micros(available), heldMicros: micros(held), giftMicros: micros(gift),
    rechargeMicros: micros(recharge), adjustmentMicros: micros(adjustment), expiredMicros: micros(expired),
    availableUnits: String(available), heldUnits: String(held), expiredUnits: String(expired),
    unitsPerMicro: Number(SCALE),
  };
}
function ledger(db, { userId, kind, amount, requestKey, fingerprint = null, callId = null,
  actorId = null, reason = null, reference = null, before, now = Date.now() }) {
  const id = randomUUID();
  db.prepare(`INSERT INTO billing_ledger VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, userId, kind, String(amount), requestKey, fingerprint, callId, actorId, reason, reference,
    String(before), wallet(db, userId, now).availableUnits, now,
  );
  return id;
}
function addLot(db, userId, source, sourceId, units, expiry, now) {
  const total = lots(db, userId).reduce((sum, lot) => sum + BigInt(lot.balance_units), 0n);
  if (units + total > MAX_BALANCE) fail(400, 'BALANCE_LIMIT', 'Account balance limit exceeded');
  const id = randomUUID();
  db.prepare('INSERT INTO billing_lots VALUES (?,?,?,?,?,?,?,?,?)').run(
    id, userId, source, sourceId, String(units), String(units), '0', expiry, now,
  );
  return id;
}

export function grantSignupGift(db, userId, settings) {
  return transaction(db, () => {
    const now = Date.now();
    // Record disabled gifts too: later settings must not retroactively grant one.
    if (!db.prepare('INSERT OR IGNORE INTO billing_signup VALUES (?,?)').run(userId, now).changes) return false;
    if (!settings.giftEnabled) return false;
    const amount = integer(settings.giftAmountMicros, 'giftAmountMicros');
    const days = settings.giftExpiryDays;
    const expiry = days == null || days === 0 ? null : now + integer(days, 'giftExpiryDays', 1, 36500) * 86400000;
    if (!amount) return false;
    const before = wallet(db, userId, now).availableUnits;
    const units = BigInt(amount) * SCALE;
    addLot(db, userId, 'gift', userId, units, expiry, now);
    ledger(db, { userId, kind: 'gift', amount: units, requestKey: 'signup', before, now });
    return true;
  });
}

function publicLedger(row) {
  return {
    id: row.id, userId: row.user_id, kind: row.kind, amountMicros: micros(row.amount_units),
    amountUnits: row.amount_units, callId: row.call_id, actorId: row.actor_id, reason: row.reason,
    reference: row.reference, beforeUnits: row.before_units, afterUnits: row.after_units,
    createdAt: row.created_at,
  };
}
function publicCall(row) {
  return {
    id: row.id, userId: row.user_id, appId: row.app_id, modelId: row.model_id, status: row.status,
    reservedMicros: micros(row.reserved_units), reservedUnits: row.reserved_units,
    chargedMicros: micros(row.charged_units), chargedUnits: row.charged_units,
    inputTokens: row.input_tokens, outputTokens: row.output_tokens,
    inputPriceMicros: row.input_price_micros, outputPriceMicros: row.output_price_micros,
    inputBound: row.input_bound, outputBound: row.output_bound, reason: row.reason,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function ledgerPage(db, rows) {
  const linked = rows.filter(row => row.call_id !== null);
  // The page limit bounds this lookup; ownership is checked even for stale links.
  const calls = linked.length ? db.prepare(`
    SELECT c.*, l.id AS ledger_id FROM billing_ledger l
    JOIN billing_calls c ON c.id=l.call_id AND c.user_id=l.user_id
    WHERE l.id IN (${linked.map(() => '?').join(',')})
  `).all(...linked.map(row => row.id)) : [];
  const byLedger = new Map(calls.map(call => [call.ledger_id, publicCall(call)]));
  return rows.map(row => ({ ...publicLedger(row), call: byLedger.get(row.id) ?? null }));
}
function getCall(db, id) { return db.prepare('SELECT * FROM billing_calls WHERE id=?').get(id); }
function sweep(db) {
  db.prepare(`UPDATE billing_calls SET status='pending',reason='lease_expired',active_until=NULL,updated_at=?
    WHERE status='active' AND active_until<=?`).run(Date.now(), Date.now());
}
function pending(db, id, reason) {
  db.prepare(`UPDATE billing_calls SET status='pending',reason=?,active_until=NULL,updated_at=?
    WHERE id=? AND status='active'`).run(reason, Date.now(), id);
}
function allocate(db, userId, units, callId, now) {
  if (BigInt(wallet(db, userId, now).availableUnits) < units) fail(402, 'INSUFFICIENT_BALANCE', 'Insufficient available balance');
  let remaining = units, position = 0;
  for (const lot of lots(db, userId)) {
    if (!remaining) break;
    if (lot.expires_at !== null && lot.expires_at <= now) continue;
    const available = BigInt(lot.balance_units) - BigInt(lot.held_units);
    const taken = available < remaining ? available : remaining;
    if (!taken) continue;
    if (callId) {
      db.prepare('UPDATE billing_lots SET held_units=? WHERE id=?').run(String(BigInt(lot.held_units) + taken), lot.id);
      db.prepare('INSERT INTO billing_allocations (call_id,lot_id,held_units,position) VALUES (?,?,?,?)')
        .run(callId, lot.id, String(taken), position++);
    } else {
      db.prepare('UPDATE billing_lots SET balance_units=? WHERE id=?').run(String(BigInt(lot.balance_units) - taken), lot.id);
    }
    remaining -= taken;
  }
}
function cost(input, output, inputPrice, outputPrice) {
  return BigInt(input) * BigInt(inputPrice) + BigInt(output) * BigInt(outputPrice);
}
function refund(db, userId, callId, units, requestId) {
  const call = getCall(db, callId);
  if (!call || call.user_id !== userId) fail(404, 'NOT_FOUND', 'Charged call not found');
  if (!['completed', 'cancelled'].includes(call.status) || units <= 0n) fail(409, 'INVALID_REFUND', 'Only settled charges may be refunded');
  const previous = db.prepare('SELECT * FROM billing_refunds WHERE call_id=?').all(callId);
  const refunded = previous.reduce((sum, row) => sum + BigInt(row.units), 0n);
  if (units + refunded > BigInt(call.charged_units)) fail(409, 'INVALID_REFUND', 'Refund exceeds the remaining original charge');
  const total = lots(db, userId).reduce((sum, lot) => sum + BigInt(lot.balance_units), 0n);
  if (units + total > MAX_BALANCE) fail(400, 'BALANCE_LIMIT', 'Account balance limit exceeded');
  let remaining = units;
  for (const allocation of db.prepare('SELECT * FROM billing_allocations WHERE call_id=? ORDER BY position').all(callId)) {
    if (!remaining) break;
    const already = previous.filter(row => row.lot_id === allocation.lot_id).reduce((sum, row) => sum + BigInt(row.units), 0n);
    const refundable = BigInt(allocation.charged_units) - already;
    const restored = remaining < refundable ? remaining : refundable;
    if (!restored) continue;
    const lot = db.prepare('SELECT * FROM billing_lots WHERE id=?').get(allocation.lot_id);
    db.prepare('UPDATE billing_lots SET balance_units=? WHERE id=?').run(String(BigInt(lot.balance_units) + restored), lot.id);
    db.prepare('INSERT INTO billing_refunds VALUES (?,?,?,?,?)').run(randomUUID(), callId, lot.id, String(restored), requestId);
    remaining -= restored;
  }
  if (remaining) fail(409, 'INVALID_REFUND', 'Original charge allocations require review');
}
function settle(db, id, counts, status, actorId = null, reason = null) {
  return transaction(db, () => {
    const call = getCall(db, id);
    if (!call || !['active', 'pending'].includes(call.status)) return call;
    const input = integer(counts.input, 'inputTokens', 0, call.input_bound);
    const output = integer(counts.output, 'outputTokens', 0, call.output_bound);
    const charge = cost(input, output, call.input_price_micros, call.output_price_micros);
    if (charge > BigInt(call.reserved_units)) fail(409, 'USAGE_EXCEEDS_HOLD', 'Verified usage exceeds reserved funds');
    const now = Date.now();
    const before = wallet(db, call.user_id, now).availableUnits;
    let remaining = charge;
    for (const allocation of db.prepare('SELECT * FROM billing_allocations WHERE call_id=? ORDER BY position').all(id)) {
      const held = BigInt(allocation.held_units);
      const taken = remaining < held ? remaining : held;
      const lot = db.prepare('SELECT * FROM billing_lots WHERE id=?').get(allocation.lot_id);
      db.prepare('UPDATE billing_lots SET balance_units=?,held_units=? WHERE id=?')
        .run(String(BigInt(lot.balance_units) - taken), String(BigInt(lot.held_units) - held), lot.id);
      db.prepare('UPDATE billing_allocations SET charged_units=?,held_units=? WHERE call_id=? AND lot_id=?')
        .run(String(taken), '0', id, lot.id);
      remaining -= taken;
    }
    if (remaining) fail(409, 'INVALID_HOLD', 'Reservation requires review');
    db.prepare(`UPDATE billing_calls SET status=?,active_until=NULL,charged_units=?,input_tokens=?,output_tokens=?,
      reason=?,updated_at=? WHERE id=?`).run(status, String(charge), input, output, reason, now, id);
    ledger(db, { userId: call.user_id, kind: status === 'released' ? 'release' : 'usage', amount: -charge,
      requestKey: `call:${id}`, callId: id, actorId, reason, before, now });
    return getCall(db, id);
  });
}

function authorized(db, userId, appId, modelId) {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!user || user.status !== 'active') fail(403, 'ACCOUNT_DISABLED', 'Account is unavailable');
  const app = db.prepare('SELECT * FROM apps WHERE id=?').get(appId);
  if (!app?.enabled || !parseArray(user.apps).includes(appId)) fail(403, 'APP_FORBIDDEN', 'Application is not authorized');
  if (modelId === undefined) return { user, app };
  if (!parseArray(app.model_ids).includes(modelId)) fail(403, 'MODEL_FORBIDDEN', 'Model is not authorized for this application');
  const model = getModel(db, modelId);
  if (!model?.enabled || !model.channel_enabled) fail(403, 'MODEL_FORBIDDEN', 'Model is unavailable');
  return { user, app, model };
}
function supported(model) {
  return PROTOCOLS.has(model.protocol);
}
function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    (allowed && Object.keys(value).some(key => !allowed.includes(key)))) {
    fail(400, 'UNSUPPORTED_CONTENT', 'Unsupported native request fields or content');
  }
  return value;
}
function list(value, max = 1024) {
  if (!Array.isArray(value) || value.length > max) fail(400, 'UNSUPPORTED_CONTENT', 'Invalid native content list');
  return value;
}
function string(value) {
  if (typeof value !== 'string') fail(400, 'UNSUPPORTED_CONTENT', 'Expected native text content');
}
function cacheControl(value) {
  if (value === undefined) return;
  object(value, ['type', 'ttl']);
  if (value.type !== 'ephemeral' || (value.ttl !== undefined && !['5m', '1h'].includes(value.ttl))) {
    fail(400, 'UNSUPPORTED_CONTENT', 'Unsupported cache control');
  }
}
function imageUrl(value) {
  string(value);
  if (value.length > 2 * 1024 * 1024) fail(400, 'INPUT_LIMIT', 'Image payload too large');
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/.test(value)) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || value.length > 8192) throw new Error();
  } catch { fail(400, 'UNSUPPORTED_CONTENT', 'Invalid image URL'); }
}
function inlineImage(mime, data) {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mime) || typeof data !== 'string') fail(400, 'UNSUPPORTED_CONTENT', 'Unsupported image format');
  imageUrl(`data:${mime};base64,${data}`);
}
function hasImages(request, protocol) {
  // Inspect native content slots only: schemas and tool arguments/results may
  // legitimately use image-shaped keys as ordinary application data.
  const pending = protocol === 'google' ? request.contents.map(item => item.parts)
    : protocol === 'openai-responses' ? (Array.isArray(request.input) ? request.input.flatMap(item =>
      item.type === 'function_call_output' ? [item.output]
        : item.type === 'reasoning' ? [item.summary, item.content] : [item.content]) : [])
      : [request.system, ...request.messages.map(item => item.content)];
  while (pending.length) {
    const parts = pending.pop();
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (protocol === 'google') {
        if (part.inlineData) return true;
        if (part.functionResponse?.parts) pending.push(part.functionResponse.parts);
      } else {
        if (['image', 'image_url', 'input_image'].includes(part.type)) return true;
        if (protocol === 'anthropic' && part.type === 'tool_result') pending.push(part.content);
      }
    }
  }
  return false;
}
function textParts(value, types = ['text']) {
  if (typeof value === 'string') return;
  for (const part of list(value)) {
    if (part?.type === 'image_url') {
      object(part, ['type', 'image_url']); object(part.image_url, ['url', 'detail']);
      imageUrl(part.image_url.url); continue;
    }
    if (part?.type === 'input_image') {
      object(part, ['type', 'image_url', 'detail']); imageUrl(part.image_url); continue;
    }
    object(part, ['type', 'text', 'cache_control', 'annotations']);
    if (!types.includes(part.type)) fail(400, 'UNSUPPORTED_CONTENT', 'Only native text parts are supported');
    string(part.text);
    cacheControl(part.cache_control);
    if (part.annotations !== undefined && list(part.annotations).length) fail(400, 'UNSUPPORTED_CONTENT', 'Unsupported annotations');
  }
}
function functionDefinition(fn, responses = false) {
  object(fn, responses ? ['type', 'name', 'description', 'parameters', 'strict'] : ['name', 'description', 'parameters', 'strict']);
  text(fn.name, 'function name');
  if (fn.description !== undefined) string(fn.description);
  if (fn.parameters !== undefined) object(fn.parameters);
}
function openaiMessages(messages) {
  if (!list(messages).length) fail(400, 'UNSUPPORTED_CONTENT', 'Messages are required');
  for (const message of messages) {
    object(message, ['role', 'content', 'name', 'tool_calls', 'tool_call_id', 'function_call', 'reasoning_content', 'refusal']);
    if (!['system', 'developer', 'user', 'assistant', 'tool', 'function'].includes(message.role)) {
      fail(400, 'UNSUPPORTED_CONTENT', 'Unsupported message role');
    }
    if (message.content != null) textParts(message.content);
    else if (message.role !== 'assistant') fail(400, 'UNSUPPORTED_CONTENT', 'Message content is required');
    if (message.reasoning_content !== undefined) string(message.reasoning_content);
    if (message.name !== undefined) string(message.name);
    if (message.tool_call_id !== undefined) string(message.tool_call_id);
    if (message.refusal != null) string(message.refusal);
    for (const call of message.tool_calls === undefined ? [] : list(message.tool_calls)) {
      object(call, ['id', 'type', 'function']);
      if (call.type !== 'function') fail(400, 'UNSUPPORTED_CONTENT', 'Only client function tools are supported');
      string(call.id);
      object(call.function, ['name', 'arguments']);
      string(call.function.name);
      string(call.function.arguments);
    }
    if (message.function_call !== undefined) {
      object(message.function_call, ['name', 'arguments']);
      string(message.function_call.name);
      string(message.function_call.arguments);
    }
  }
}
function responsesInput(input) {
  if (typeof input === 'string') return;
  if (!list(input).length) fail(400, 'UNSUPPORTED_CONTENT', 'Input is required');
  for (const item of input) {
    if (item?.type === 'function_call') {
      object(item, ['type', 'id', 'call_id', 'name', 'arguments', 'status']);
      string(item.call_id); string(item.name); string(item.arguments);
    } else if (item?.type === 'function_call_output') {
      object(item, ['type', 'id', 'call_id', 'output', 'status']);
      string(item.call_id);
      textParts(item.output, ['input_text']);
    } else if (item?.type === 'reasoning') {
      object(item, ['type', 'id', 'summary', 'content', 'encrypted_content', 'status']);
      textParts(item.summary, ['summary_text']);
      if (item.content !== undefined) textParts(item.content, ['reasoning_text']);
      if (item.encrypted_content != null) string(item.encrypted_content);
    } else {
      object(item, ['type', 'id', 'role', 'content', 'status']);
      if (item.type !== undefined && item.type !== 'message') fail(400, 'UNSUPPORTED_CONTENT', 'Unsupported Responses input item');
      if (!['system', 'developer', 'user', 'assistant'].includes(item.role)) fail(400, 'UNSUPPORTED_CONTENT', 'Unsupported input role');
      textParts(item.content, ['input_text', 'output_text']);
    }
  }
}
function anthropicContent(content) {
  if (typeof content === 'string') return;
  for (const part of list(content)) {
    if (part?.type === 'text') textParts([part]);
    else if (part?.type === 'tool_use') {
      object(part, ['type', 'id', 'name', 'input', 'cache_control']);
      string(part.id); string(part.name); object(part.input);
    } else if (part?.type === 'tool_result') {
      object(part, ['type', 'tool_use_id', 'content', 'is_error', 'cache_control']);
      string(part.tool_use_id);
      if (part.content !== undefined) anthropicContent(part.content);
    } else if (part?.type === 'image') {
      object(part, ['type', 'source', 'cache_control']);
      if (part.source?.type === 'base64') {
        object(part.source, ['type', 'media_type', 'data']); inlineImage(part.source.media_type, part.source.data);
      } else {
        object(part.source, ['type', 'url']);
        if (part.source.type !== 'url') fail(400, 'UNSUPPORTED_CONTENT', 'Unsupported image source');
        imageUrl(part.source.url);
      }
    } else if (part?.type === 'thinking') {
      object(part, ['type', 'thinking', 'signature']);
      string(part.thinking); string(part.signature);
    } else if (part?.type === 'redacted_thinking') {
      object(part, ['type', 'data']); string(part.data);
    } else fail(400, 'UNSUPPORTED_CONTENT', 'Unsupported Anthropic content block');
    cacheControl(part.cache_control);
  }
}
function googleParts(parts) {
  for (const part of list(parts)) {
    object(part, ['text', 'thought', 'thoughtSignature', 'functionCall', 'functionResponse', 'inlineData']);
    const kinds = ['text', 'functionCall', 'functionResponse', 'inlineData'].filter(key => part[key] !== undefined);
    if (kinds.length !== 1) fail(400, 'UNSUPPORTED_CONTENT', 'Unsupported Google content part');
    if (part.text !== undefined) string(part.text);
    if (part.inlineData !== undefined) {
      object(part.inlineData, ['mimeType', 'data']); inlineImage(part.inlineData.mimeType, part.inlineData.data);
    }
    if (part.thoughtSignature !== undefined) string(part.thoughtSignature);
    if (part.functionCall !== undefined) {
      object(part.functionCall, ['id', 'name', 'args']);
      string(part.functionCall.name); object(part.functionCall.args);
    }
    if (part.functionResponse !== undefined) {
      object(part.functionResponse, ['id', 'name', 'response', 'willContinue', 'scheduling', 'parts']);
      string(part.functionResponse.name); object(part.functionResponse.response);
      if (part.functionResponse.parts !== undefined) googleParts(part.functionResponse.parts);
    }
  }
}
function validateNative(protocol, request) {
  const common = ['model', 'stream', 'temperature', 'top_p', 'metadata'];
  if (protocol === 'openai') {
    object(request, [...common, 'messages', 'max_tokens', 'max_completion_tokens', 'n', 'stop', 'seed',
      'frequency_penalty', 'presence_penalty', 'stream_options', 'tools', 'tool_choice', 'functions',
      'function_call', 'parallel_tool_calls', 'response_format', 'reasoning', 'reasoning_effort',
      'thinking', 'enable_thinking', 'reasoning_split', 'chat_template_kwargs', 'logprobs', 'top_logprobs', 'service_tier']);
    openaiMessages(request.messages);
    for (const tool of request.tools === undefined ? [] : list(request.tools)) {
      object(tool, ['type', 'function']);
      if (tool.type !== 'function') fail(400, 'UNSUPPORTED_CONTENT', 'Only client function tools are supported');
      functionDefinition(tool.function);
    }
    for (const fn of request.functions === undefined ? [] : list(request.functions)) functionDefinition(fn);
    if (request.n !== undefined && request.n !== 1) fail(400, 'UNSUPPORTED_CONTENT', 'Only a single completion is supported');
    if (request.stream_options !== undefined) {
      object(request.stream_options, ['include_usage']);
      if (!request.stream || request.stream_options.include_usage !== true) fail(400, 'INVALID_ARGUMENT', 'Invalid stream_options');
    }
  } else if (protocol === 'openai-responses') {
    object(request, [...common, 'input', 'instructions', 'max_output_tokens', 'tools', 'tool_choice',
      'parallel_tool_calls', 'text', 'store', 'reasoning', 'truncation', 'include', 'background', 'service_tier']);
    responsesInput(request.input);
    if (request.background || request.store) fail(400, 'UNSUPPORTED_CONTENT', 'Background and stored responses are unsupported');
    for (const tool of request.tools === undefined ? [] : list(request.tools)) {
      if (tool?.type !== 'function') fail(400, 'UNSUPPORTED_CONTENT', 'Only client function tools are supported');
      functionDefinition(tool, true);
    }
    if (request.instructions !== undefined) string(request.instructions);
    request.store = false;
  } else if (protocol === 'anthropic') {
    object(request, [...common, 'messages', 'max_tokens', 'system', 'tools', 'tool_choice', 'thinking',
      'output_config', 'top_k', 'stop_sequences', 'cache_control', 'speed']);
    if (!list(request.messages).length) fail(400, 'UNSUPPORTED_CONTENT', 'Messages are required');
    for (const message of request.messages) {
      object(message, ['role', 'content']);
      if (!['user', 'assistant'].includes(message.role)) fail(400, 'UNSUPPORTED_CONTENT', 'Unsupported message role');
      anthropicContent(message.content);
    }
    if (request.system !== undefined) textParts(request.system);
    cacheControl(request.cache_control);
    for (const tool of request.tools === undefined ? [] : list(request.tools)) {
      object(tool, ['type', 'name', 'description', 'input_schema', 'cache_control', 'strict']);
      if (tool.type !== undefined && tool.type !== 'custom') fail(400, 'UNSUPPORTED_CONTENT', 'Only client function tools are supported');
      string(tool.name); object(tool.input_schema); cacheControl(tool.cache_control);
    }
  } else {
    object(request, ['contents', 'systemInstruction', 'tools', 'toolConfig', 'generationConfig', 'safetySettings']);
    if (!list(request.contents).length) fail(400, 'UNSUPPORTED_CONTENT', 'Contents are required');
    for (const content of request.contents) {
      object(content, ['role', 'parts']);
      if (content.role !== undefined && !['user', 'model'].includes(content.role)) fail(400, 'UNSUPPORTED_CONTENT', 'Unsupported content role');
      googleParts(content.parts);
    }
    if (request.systemInstruction !== undefined) {
      object(request.systemInstruction, ['role', 'parts']);
      for (const part of list(request.systemInstruction.parts)) { object(part, ['text']); string(part.text); }
    }
    for (const tool of request.tools === undefined ? [] : list(request.tools)) {
      object(tool, ['functionDeclarations']);
      for (const declaration of list(tool.functionDeclarations)) {
        object(declaration, ['name', 'description', 'parameters', 'parametersJsonSchema', 'response', 'responseJsonSchema', 'behavior']);
        string(declaration.name);
      }
    }
    if (request.toolConfig !== undefined) {
      object(request.toolConfig, ['functionCallingConfig']);
      object(request.toolConfig.functionCallingConfig, ['mode', 'allowedFunctionNames']);
    }
    if (request.generationConfig !== undefined) {
      object(request.generationConfig, ['maxOutputTokens', 'candidateCount', 'temperature', 'topP', 'topK',
        'stopSequences', 'responseMimeType', 'responseSchema', 'responseJsonSchema', 'thinkingConfig',
        'seed', 'responseLogprobs', 'logprobs', 'responseModalities']);
      if (request.generationConfig.candidateCount !== undefined && request.generationConfig.candidateCount !== 1) {
        fail(400, 'UNSUPPORTED_CONTENT', 'Only a single candidate is supported');
      }
      if (request.generationConfig.responseMimeType !== undefined &&
        !['text/plain', 'application/json', 'text/x.enum'].includes(request.generationConfig.responseMimeType)) {
        fail(400, 'UNSUPPORTED_CONTENT', 'Only text generation is supported');
      }
      if (request.generationConfig.responseModalities !== undefined &&
        canonical(request.generationConfig.responseModalities) !== '["TEXT"]') fail(400, 'UNSUPPORTED_CONTENT', 'Only text generation is supported');
    }
  }
}
export function prepareRequest(model, original, path) {
  if (!supported(model)) fail(422, 'UNSUPPORTED_BILLING_PROTOCOL', 'Unsupported native billing protocol');
  object(original);
  const normalizedPath = path.replace(/^v1\//, '');
  const endpoints = { openai: 'chat/completions', 'openai-responses': 'responses', anthropic: 'messages' };
  const googlePath = /^(?:(v1beta|v1)\/)?models\/([a-zA-Z0-9_.:-]+):(streamGenerateContent|generateContent)$/.exec(path);
  if (model.protocol === 'google' ? !googlePath : normalizedPath !== endpoints[model.protocol]) {
    fail(400, 'UNSUPPORTED_ENDPOINT', 'Unsupported relay endpoint');
  }
  if (original.model !== undefined && ![model.id, model.upstream_model].includes(original.model)) {
    fail(400, 'MODEL_MISMATCH', 'Request model does not match authorized model');
  }
  const request = structuredClone(original);
  validateNative(model.protocol, request);
  const images = hasImages(request, model.protocol);
  if (images && !parseArray(model.capabilities).includes('image')) fail(400, 'UNSUPPORTED_CONTENT', 'Model is not enabled for image input');
  const inputLimit = integer(model.max_input_tokens, 'configured maxInputTokens', 1);
  const outputLimit = integer(model.max_output_tokens, 'configured maxOutputTokens', 1);
  // Operator context caps are trusted limits. Byte validation only rejects
  // oversized requests; it is never treated as actual usage or a final charge.
  const inputBytes = Buffer.byteLength(JSON.stringify(request), 'utf8') + 256
    + 64 * (request.messages?.length ?? request.contents?.length ?? 1);
  if (inputBytes > (images ? 2 * 1024 * 1024 : Math.min(inputLimit, 2 * 1024 * 1024))) fail(400, 'INPUT_LIMIT', 'Request exceeds the configured conservative input limit');
  if (original.max_tokens !== undefined && original.max_completion_tokens !== undefined) {
    fail(400, 'INVALID_ARGUMENT', 'Supply only one output token limit');
  }
  const requestedOutput = original.max_completion_tokens ?? original.max_tokens ??
    original.max_output_tokens ?? original.generationConfig?.maxOutputTokens ?? outputLimit;
  const output = integer(requestedOutput, 'output token limit', 1, outputLimit);
  if (original.stream !== undefined && typeof original.stream !== 'boolean') fail(400, 'INVALID_ARGUMENT', 'Invalid stream');
  if (model.protocol === 'google') {
    request.generationConfig = { ...request.generationConfig, maxOutputTokens: output };
    if (request.generationConfig.thinkingConfig?.thinkingBudget !== undefined) {
      integer(request.generationConfig.thinkingConfig.thinkingBudget, 'thinkingBudget', -1, output);
    }
  } else {
    request.model = model.upstream_model;
    if (model.protocol === 'openai-responses') request.max_output_tokens = output;
    else if (model.protocol === 'openai' && (model.provider === 'openai' || original.max_completion_tokens !== undefined)) {
      request.max_completion_tokens = output;
      delete request.max_tokens;
    }
    else request.max_tokens = output;
    if (model.protocol === 'openai' && request.stream) request.stream_options = { include_usage: true };
    if (request.thinking?.budget_tokens !== undefined) integer(request.thinking.budget_tokens, 'thinking budget', 0, output);
  }
  let url;
  try {
    const base = new URL(model.base_url);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error();
    if (model.protocol === 'google') {
      const name = model.upstream_model.replace(/^models\//, '');
      if (!/^[a-zA-Z0-9_.:-]+$/.test(name)) throw new Error();
      const version = /\/(v1beta|v1)\/?$/.exec(base.pathname)?.[1] || googlePath[1] || 'v1beta';
      const root = base.href.replace(/\/$/, '').replace(/\/(?:v1beta|v1)$/, '');
      url = `${root}/${version}/models/${encodeURIComponent(name)}:${googlePath[3]}`;
      if (googlePath[3] === 'streamGenerateContent') url += '?alt=sse';
    } else {
      const root = base.href.replace(/\/$/, '');
      const needsVersion = base.pathname === '/' ||
        (model.protocol === 'anthropic' && !/\/v1\/?$/.test(base.pathname));
      url = `${root}${needsVersion ? '/v1' : ''}/${endpoints[model.protocol]}`;
    }
  } catch { fail(422, 'INVALID_MODEL_CONFIG', 'Invalid upstream base URL'); }
  integer(model.input_price_micros, 'inputPriceMicros');
  integer(model.output_price_micros, 'outputPriceMicros');
  return { request, url, input: inputLimit, output,
    stream: model.protocol === 'google' ? googlePath[3] === 'streamGenerateContent' : request.stream === true };
}

function reserve(db, userId, appId, modelId, key, fingerprint, original, path) {
  return transaction(db, () => {
    sweep(db);
    const { user, model } = authorized(db, userId, appId, modelId);
    const prior = db.prepare('SELECT * FROM billing_calls WHERE user_id=? AND request_key=?').get(userId, key);
    if (prior) {
      if (prior.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key already identifies another request');
      return { prior };
    }
    const prepared = prepareRequest(model, original, path);
    const active = db.prepare("SELECT COUNT(*) AS count FROM billing_calls WHERE user_id=? AND status='active'").get(userId).count;
    if (active >= integer(user.concurrency_limit, 'concurrencyLimit', 1, 1000)) fail(429, 'CONCURRENCY_LIMIT', 'Too many active model requests');
    const id = randomUUID(), now = Date.now();
    const amount = cost(prepared.input, prepared.output, model.input_price_micros, model.output_price_micros);
    allocate(db, userId, amount, id, now);
    db.prepare(`INSERT INTO billing_calls (id,user_id,request_key,fingerprint,app_id,model_id,status,active_until,
      input_bound,output_bound,input_price_micros,output_price_micros,reserved_units,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'active',?,?,?,?,?,?,?,?)`).run(
      id, userId, key, fingerprint, appId, modelId, now + LEASE_MS, prepared.input, prepared.output,
      model.input_price_micros, model.output_price_micros, String(amount), now, now,
    );
    return { id, model, ...prepared };
  });
}

const tokenCount = value => Number.isSafeInteger(value) && value >= 0;
function actualUsage(value, protocol = 'openai') {
  if (!value || typeof value !== 'object') return null;
  let input, output;
  if (protocol === 'anthropic') {
    const uncached = value.input_tokens, creation = value.cache_creation_input_tokens ?? 0, read = value.cache_read_input_tokens ?? 0;
    if (![uncached, creation, read, value.output_tokens].every(tokenCount)) return null;
    if (value.cache_creation != null) {
      const short = value.cache_creation.ephemeral_5m_input_tokens ?? 0;
      const long = value.cache_creation.ephemeral_1h_input_tokens ?? 0;
      if (![short, long].every(tokenCount) || short + long !== creation) return null;
    }
    // These are three disjoint input buckets. TTL breakdowns are subsets.
    input = uncached + creation + read;
    output = value.output_tokens;
    if (value.server_tool_use && Object.values(value.server_tool_use).some(count => count !== 0)) return null;
  } else if (protocol === 'google') {
    input = value.promptTokenCount;
    const candidates = value.candidatesTokenCount, thoughts = value.thoughtsTokenCount ?? 0;
    if (![input, candidates, thoughts, value.totalTokenCount].every(tokenCount)) return null;
    output = candidates + thoughts;
    // The native total includes thoughts. Cached tokens are already in prompt.
    if (value.totalTokenCount !== input + output || (value.toolUsePromptTokenCount ?? 0) !== 0) return null;
    const cached = value.cachedContentTokenCount ?? 0;
    if (!tokenCount(cached) || cached > input) return null;
  } else {
    input = protocol === 'openai-responses' ? value.input_tokens : value.prompt_tokens;
    output = protocol === 'openai-responses' ? value.output_tokens : value.completion_tokens;
    if (![input, output].every(tokenCount)) return null;
    if (value.total_tokens !== undefined && (!tokenCount(value.total_tokens) || value.total_tokens !== input + output)) return null;
  }
  if (![input, output].every(tokenCount)) return null;
  // OpenAI cache and reasoning details are subsets, never extra token charges.
  for (const [details, key, limit] of [
    [value.prompt_tokens_details ?? value.input_tokens_details, 'cached_tokens', input],
    [value.completion_tokens_details ?? value.output_tokens_details, 'reasoning_tokens', output],
  ]) {
    if (details?.[key] !== undefined && (!tokenCount(details[key]) || details[key] > limit)) return null;
    if (details?.audio_tokens) return null;
  }
  return { input, output };
}
export function responseUsage(payload, protocol) {
  if (!payload || payload.error) return null;
  if (protocol === 'openai-responses' && payload.status && !['completed', 'incomplete'].includes(payload.status)) return null;
  return actualUsage(protocol === 'google' ? payload.usageMetadata : payload.usage, protocol);
}
function usageReader(protocol) {
  const decoder = new StringDecoder('utf8');
  let buffer = '', counts = null, invalid = false, done = false;
  let anthropicUsage = null, finalDelta = false, googleFinished = false;
  function cumulative(next) {
    if (!next || (counts && (next.input < counts.input || next.output < counts.output))) invalid = true;
    else counts = next;
  }
  function event(raw) {
    const data = raw.split(/\r\n|\r|\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data) return;
    if (data === '[DONE]') {
      if (protocol === 'openai') done = true;
      else if (!done && protocol !== 'google') invalid = true;
      return;
    }
    if (done) { invalid = true; return; }
    try {
      const payload = JSON.parse(data);
      if (payload.error || payload.type === 'error' || payload.type === 'response.failed') invalid = true;
      if (protocol === 'openai') {
        if (payload.usage != null) cumulative(actualUsage(payload.usage, protocol));
      } else if (protocol === 'openai-responses') {
        if (['response.completed', 'response.incomplete'].includes(payload.type)) {
          cumulative(responseUsage(payload.response, protocol));
          done = true;
        }
      } else if (protocol === 'anthropic') {
        if (payload.type === 'message_start') {
          if (anthropicUsage) invalid = true;
          anthropicUsage = payload.message?.usage ?? null;
        } else if (payload.type === 'message_delta' && payload.usage) {
          if (!anthropicUsage || !tokenCount(payload.usage.output_tokens) ||
            payload.usage.output_tokens < (anthropicUsage?.output_tokens ?? 0)) invalid = true;
          // message_delta usage is cumulative; merge fields, never add it.
          anthropicUsage = { ...anthropicUsage, ...payload.usage };
          finalDelta = true;
        } else if (payload.type === 'message_stop') {
          if (!finalDelta) invalid = true;
          cumulative(actualUsage(anthropicUsage, protocol));
          done = true;
        }
      } else {
        if (payload.usageMetadata != null) cumulative(responseUsage(payload, protocol));
        if (Array.isArray(payload.candidates) && payload.candidates.length &&
          payload.candidates.every(candidate => typeof candidate.finishReason === 'string')) googleFinished = true;
      }
    } catch { invalid = true; }
  }
  function feed(value, end = false) {
    buffer += end ? decoder.end() : decoder.write(value);
    let match;
    while ((match = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
      const raw = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      if (Buffer.byteLength(raw) > MAX_EVENT_BYTES) throw new Error('event_limit');
      event(raw);
    }
    if (Buffer.byteLength(buffer) > MAX_EVENT_BYTES) throw new Error('event_limit');
    if (end && buffer.trim()) invalid = true;
  }
  return { feed, result: () => !invalid && (done || (protocol === 'google' && googleFinished)) ? counts : null };
}

function writable(res, signal) {
  if (res.destroyed || signal.aborted) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const clean = () => {
      res.removeListener('drain', finish);
      res.removeListener('close', finish);
      signal.removeEventListener('abort', abort);
    };
    const finish = () => { clean(); resolve(); };
    const abort = () => { clean(); reject(new Error('write_timeout')); };
    res.once('drain', finish);
    res.once('close', finish);
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function relay(req, res, context) {
  const { db, unseal, fetchImpl = globalThis.fetch } = context;
  const key = text(req.get('Idempotency-Key'), 'Idempotency-Key', 128);
  const { appId, modelId } = req.params;
  const path = req.params[0];
  if (Object.keys(req.query).some(name => name !== 'alt') ||
    (req.query.alt !== undefined && (req.query.alt !== 'sse' || !path.endsWith(':streamGenerateContent')))) {
    fail(400, 'UNSUPPORTED_ENDPOINT', 'Relay query parameters are unsupported');
  }
  const fingerprint = digest(canonical({ appId, modelId, path, body: req.body }));
  // Decrypt before reserving; configuration errors cannot strand a new hold.
  const { model } = authorized(db, req.platformUser.id, appId, modelId);
  let secret;
  try { secret = model.provider === 'ollama' && !model.secret ? '' : unseal(model.secret); }
  catch { fail(422, 'INVALID_MODEL_CONFIG', 'Upstream credentials unavailable'); }
  if (typeof secret !== 'string' || (!secret && model.provider !== 'ollama') || /[\r\n]/.test(secret)) {
    fail(422, 'INVALID_MODEL_CONFIG', 'Upstream credentials unavailable');
  }
  const call = reserve(db, req.platformUser.id, appId, modelId, key, fingerprint, req.body, path);
  if (call.prior) return res.status(409).json({ error: 'Request already submitted', code: 'IDEMPOTENCY_REPLAY', call: publicCall(call.prior) });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  timer.unref();
  let disconnected = false, submitted = false;
  const onClose = () => { if (!res.writableEnded) disconnected = true; };
  res.on('close', onClose);
  res.setHeader('X-Billing-Call-Id', call.id);
  try {
    if (res.destroyed) {
      settle(db, call.id, { input: 0, output: 0 }, 'released', null, 'not_submitted');
      return;
    }
    submitted = true;
    const headers = { 'content-type': 'application/json' };
    if (call.model.protocol === 'anthropic') {
      headers['x-api-key'] = secret;
      headers['anthropic-version'] = '2023-06-01';
    } else if (call.model.protocol === 'google') headers['x-goog-api-key'] = secret;
    else if (secret) headers.authorization = `Bearer ${secret}`;
    const response = await fetchImpl(call.url, {
      method: 'POST', headers,
      body: JSON.stringify(call.request), signal: controller.signal, redirect: 'manual',
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      pending(db, call.id, 'upstream_rejected');
      if (!res.destroyed) res.status(502).json({ error: 'Upstream request failed; hold requires review', code: 'UPSTREAM_ERROR', callId: call.id });
      return;
    }
    const isStream = call.stream;
    const contentType = response.headers.get('content-type') || '';
    if (!(isStream ? contentType.includes('text/event-stream') : contentType.includes('application/json'))) {
      await response.body.cancel();
      throw new Error('content_type');
    }
    let counts;
    if (isStream) {
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Accel-Buffering', 'no');
      const reader = usageReader(call.model.protocol);
      for await (const chunk of response.body) {
        const bytes = Buffer.from(chunk);
        reader.feed(bytes);
        if (!disconnected && !res.destroyed && !res.write(bytes)) {
          // Abort bounds slow downstream readers too; a disconnected customer
          // does not stop draining upstream final usage.
          try { await writable(res, controller.signal); }
          catch { if (!disconnected) throw new Error('write_timeout'); }
        }
      }
      reader.feed(null, true);
      counts = reader.result();
    } else {
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) throw new Error('response_limit');
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      let parsed;
      try { parsed = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('invalid_json'); }
      counts = responseUsage(parsed, call.model.protocol);
      if (!res.destroyed) {
        res.status(200).setHeader('Content-Type', 'application/json');
        // Settlement happens before the nonstream response becomes observable.
        res.locals.billingResponse = bytes;
      }
    }
    if (counts && counts.input <= call.input && counts.output <= call.output) {
      settle(db, call.id, counts, disconnected ? 'cancelled' : 'completed');
    } else pending(db, call.id, counts ? 'usage_exceeds_bound' : 'missing_or_invalid_usage');
    if (!res.destroyed) {
      if (res.locals.billingResponse) res.end(res.locals.billingResponse);
      else res.end();
    }
  } catch {
    controller.abort();
    if (submitted) pending(db, call.id, 'transport_or_protocol_error');
    else settle(db, call.id, { input: 0, output: 0 }, 'released', null, 'not_submitted');
    if (!res.destroyed) {
      if (!res.headersSent) res.status(502).json({ error: 'Upstream request incomplete; hold requires review', code: 'UPSTREAM_ERROR', callId: call.id });
      else res.end();
    }
  } finally {
    clearTimeout(timer);
    res.removeListener('close', onClose);
    delete res.locals.billingResponse;
  }
}

function codeView(row, now, reveal, unseal) {
  return {
    id: row.id, batchId: row.batch_id, amountMicros: row.amount_micros, expiresAt: row.expires_at,
    status: row.redeemed_at !== null ? 'redeemed' : row.revoked_at !== null ? 'revoked' :
      row.expires_at !== null && row.expires_at <= now ? 'expired' : 'unused',
    redeemedBy: row.redeemed_by, redeemedAt: row.redeemed_at, ledgerId: row.ledger_id,
    createdAt: row.created_at, ...(reveal ? { code: unseal(row.sealed_code) } : {}),
  };
}
function limit(req) { return integer(Number(req.query.limit ?? 100), 'limit', 1, 500); }
function offset(req) { return integer(Number(req.query.offset ?? 0), 'offset', 0, 10000000); }

export function mountBilling(app, context) {
  const { db, requireUser, requireAdmin, seal, unseal } = context;
  const route = (method, path, auth, handler) => app[method](`${PREFIX}${path}`, auth, async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (res.headersSent) { res.end(); return; }
      res.status(error.billingError ? error.status : 500).json({
        error: error.billingError ? error.message : 'Billing operation failed',
        code: error.billingError ? error.code : 'BILLING_ERROR',
      });
    }
  });
  route('get', '/wallet', requireUser, (req, res) => {
    sweep(db);
    res.json(wallet(db, req.platformUser.id));
  });
  route('get', '/ledger', requireUser, (req, res) => {
    const rows = db.prepare('SELECT * FROM billing_ledger WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?')
      .all(req.platformUser.id, limit(req), offset(req));
    res.json({ ledger: ledgerPage(db, rows) });
  });
  route('get', '/billing/calls/:id', requireUser, (req, res) => {
    sweep(db);
    const call = getCall(db, req.params.id);
    if (!call || call.user_id !== req.platformUser.id) fail(404, 'NOT_FOUND', 'Call not found');
    res.json({ call: publicCall(call) });
  });
  route('get', '/admin/ledger', requireAdmin, (req, res) => {
    const userId = req.query.userId;
    const rows = userId ? db.prepare('SELECT * FROM billing_ledger WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?').all(text(userId, 'userId'), limit(req), offset(req))
      : db.prepare('SELECT * FROM billing_ledger ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?').all(limit(req), offset(req));
    res.json({ ledger: ledgerPage(db, rows) });
  });
  route('get', '/admin/users/:id/wallet', requireAdmin, (req, res) => res.json(wallet(db, req.params.id)));
  route('post', '/admin/users/:id/adjustments', requireAdmin, (req, res) => {
    object(req.body, ['amountMicros', 'reason', 'requestId', 'reference', 'callId']);
    const amount = integer(req.body?.amountMicros, 'amountMicros', -Number.MAX_SAFE_INTEGER);
    if (!amount) fail(400, 'INVALID_ARGUMENT', 'Adjustment must be nonzero');
    const reason = text(req.body.reason, 'reason', 500), requestId = text(req.body.requestId, 'requestId', 128);
    const reference = req.body.reference == null ? null : text(req.body.reference, 'reference', 200);
    const callId = req.body.callId == null ? null : text(req.body.callId, 'callId');
    const userId = req.params.id, fingerprint = digest(canonical({ amount, reason, reference, callId }));
    const result = transaction(db, () => {
      if (!db.prepare('SELECT id FROM users WHERE id=?').get(userId)) fail(404, 'NOT_FOUND', 'User not found');
      const prior = db.prepare('SELECT * FROM billing_ledger WHERE user_id=? AND request_key=?').get(userId, `adjust:${requestId}`);
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', 'Adjustment request differs');
        return prior;
      }
      const now = Date.now(), before = wallet(db, userId, now).availableUnits, units = BigInt(amount) * SCALE;
      if (callId) refund(db, userId, callId, units, requestId);
      else if (units > 0n) addLot(db, userId, 'adjustment', requestId, units, null, now);
      else allocate(db, userId, -units, null, now);
      const id = ledger(db, { userId, kind: 'adjustment', amount: units, requestKey: `adjust:${requestId}`,
        fingerprint, actorId: req.platformUser.id, reason, reference, callId, before, now });
      return db.prepare('SELECT * FROM billing_ledger WHERE id=?').get(id);
    });
    res.json({ entry: publicLedger(result), wallet: wallet(db, userId) });
  });
  route('post', '/admin/codes', requireAdmin, (req, res) => {
    const count = integer(req.body?.count, 'count', 1, 1000);
    const amount = integer(req.body.amountMicros, 'amountMicros', 1);
    const requestId = text(req.body.requestId, 'requestId', 128);
    const expiry = req.body.expiresAt == null ? null : integer(req.body.expiresAt, 'expiresAt', 1);
    const fingerprint = digest(canonical({ count, amount, expiry }));
    const result = transaction(db, () => {
      const previous = db.prepare('SELECT * FROM billing_code_batches WHERE request_id=?').get(requestId);
      if (previous && previous.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', 'Code batch request differs');
      if (!previous) {
        const now = Date.now();
        if (expiry !== null && expiry <= now) fail(400, 'INVALID_ARGUMENT', 'Code expiry must be in the future');
        db.prepare('INSERT INTO billing_code_batches VALUES (?,?,?,?)').run(requestId, fingerprint, req.platformUser.id, now);
        for (let i = 0; i < count; i++) {
          const code = randomBytes(24).toString('hex').toUpperCase();
          db.prepare(`INSERT INTO billing_codes (id,batch_id,code_hash,sealed_code,amount_micros,expires_at,created_at,actor_id)
            VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(), requestId, digest(code), seal(code), amount, expiry, now, req.platformUser.id);
        }
      }
      return db.prepare('SELECT * FROM billing_codes WHERE batch_id=? ORDER BY rowid').all(requestId);
    });
    res.status(201).json({ codes: result.map(row => codeView(row, Date.now(), true, unseal)) });
  });
  route('get', '/admin/codes', requireAdmin, (req, res) => {
    const rows = req.query.batchId
      ? db.prepare('SELECT * FROM billing_codes WHERE batch_id=? ORDER BY rowid DESC LIMIT ? OFFSET ?').all(text(req.query.batchId, 'batchId', 128), limit(req), offset(req))
      : db.prepare('SELECT * FROM billing_codes ORDER BY rowid DESC LIMIT ? OFFSET ?').all(limit(req), offset(req));
    res.json({ codes: rows.map(row => codeView(row, Date.now(), req.query.export === 'true', unseal)),
      nextOffset: rows.length === limit(req) ? offset(req) + rows.length : null });
  });
  route('post', '/admin/codes/:id/revoke', requireAdmin, (req, res) => {
    transaction(db, () => {
      const row = db.prepare('SELECT * FROM billing_codes WHERE id=?').get(req.params.id);
      if (!row) fail(404, 'NOT_FOUND', 'Code not found');
      if (row.redeemed_at !== null) fail(409, 'CODE_UNAVAILABLE', 'Code already redeemed');
      db.prepare('UPDATE billing_codes SET revoked_at=COALESCE(revoked_at,?),revoked_by=COALESCE(revoked_by,?) WHERE id=?')
        .run(Date.now(), req.platformUser.id, row.id);
    });
    res.json({ ok: true });
  });
  route('post', '/redeem', requireUser, (req, res) => {
    const userId = req.platformUser.id;
    // This transaction deliberately commits before validating a code so failed
    // attempts cannot roll their rate-limit counter back.
    transaction(db, () => {
      const now = Date.now(), row = db.prepare('SELECT * FROM billing_redeem_attempts WHERE user_id=?').get(userId);
      if (row && now - row.window_start < 60000 && row.attempts >= 20) fail(429, 'REDEMPTION_RATE_LIMIT', 'Too many redemption attempts');
      const fresh = !row || now - row.window_start >= 60000;
      db.prepare('INSERT OR REPLACE INTO billing_redeem_attempts VALUES (?,?,?)').run(userId, fresh ? now : row.window_start, fresh ? 1 : row.attempts + 1);
    });
    const code = text(req.body?.code, 'code', 128).toUpperCase();
    const entry = transaction(db, () => {
      const now = Date.now(), row = db.prepare('SELECT * FROM billing_codes WHERE code_hash=?').get(digest(code));
      if (!row || row.redeemed_at !== null || row.revoked_at !== null || (row.expires_at !== null && row.expires_at <= now)) {
        fail(409, 'CODE_UNAVAILABLE', 'Code is invalid or unavailable');
      }
      const before = wallet(db, userId, now).availableUnits, units = BigInt(row.amount_micros) * SCALE;
      addLot(db, userId, 'recharge', row.id, units, null, now);
      const id = ledger(db, { userId, kind: 'redemption', amount: units, requestKey: `redeem:${row.id}`, before, now });
      db.prepare('UPDATE billing_codes SET redeemed_at=?,redeemed_by=?,ledger_id=? WHERE id=?').run(now, userId, id, row.id);
      return id;
    });
    res.json({ ledgerId: entry, wallet: wallet(db, userId) });
  });
  route('get', '/models', requireUser, (req, res) => {
    const { app: application } = authorized(db, req.platformUser.id, text(req.query.appId ?? 'chat', 'appId'));
    const ids = parseArray(application.model_ids);
    const models = listModels(db)
      .filter(model => model.enabled && model.channel_enabled && ids.includes(model.id) &&
        (!req.query.capability || parseArray(model.capabilities).includes(req.query.capability)));
    res.json({ defaultModelId: models.some(model => model.id === application.default_model_id) ? application.default_model_id : null, models: models.map(model => ({
      id: model.id, name: model.name, provider: model.provider, protocol: model.protocol,
      inputPriceMicros: model.input_price_micros, outputPriceMicros: model.output_price_micros,
      maxInputTokens: model.max_input_tokens, maxOutputTokens: model.max_output_tokens,
      capabilities: parseArray(model.capabilities), relaySupported: supported(model),
      relayCapabilities: supported(model) ? ['text', 'tools', 'streaming', ...(parseArray(model.capabilities).includes('image') ? ['image'] : [])] : [],
      billingInputReservationTokens: supported(model) ? model.max_input_tokens : null,
    })) });
  });
  route('get', '/admin/billing/pending', requireAdmin, (req, res) => {
    sweep(db);
    const rows = db.prepare("SELECT * FROM billing_calls WHERE status='pending' ORDER BY created_at,id LIMIT ? OFFSET ?").all(limit(req), offset(req));
    res.json({ calls: rows.map(publicCall) });
  });
  route('post', '/admin/billing/calls/:id/review', requireAdmin, (req, res) => {
    const requestId = text(req.body?.requestId, 'requestId', 128);
    const reason = text(req.body.reason, 'reason', 500), evidence = text(req.body.evidence, 'evidence', 500);
    const action = req.body.action;
    if (!['release', 'settle'].includes(action)) fail(400, 'INVALID_ARGUMENT', 'Review action must be release or settle');
    const counts = action === 'release' ? { input: 0, output: 0 } : {
      input: integer(req.body.inputTokens, 'inputTokens'), output: integer(req.body.outputTokens, 'outputTokens'),
    };
    const fingerprint = digest(canonical({ id: req.params.id, action, counts, reason, evidence }));
    const call = transaction(db, () => {
      sweep(db);
      const prior = db.prepare('SELECT * FROM billing_reviews WHERE request_id=?').get(requestId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', 'Review request differs');
        return getCall(db, prior.call_id);
      }
      const row = getCall(db, req.params.id);
      if (!row) fail(404, 'NOT_FOUND', 'Call not found');
      if (row.status !== 'pending') fail(409, 'CALL_NOT_PENDING', 'Only pending calls may be reviewed');
      const result = settle(db, row.id, counts, action === 'release' ? 'released' : 'completed', req.platformUser.id, reason);
      db.prepare('INSERT INTO billing_reviews VALUES (?,?,?,?,?,?,?,?)')
        .run(requestId, row.id, fingerprint, req.platformUser.id, action, reason, evidence, Date.now());
      return result;
    });
    res.json({ call: publicCall(call) });
  });
  route('post', '/relay/:appId/:modelId/*', requireUser, (req, res) => relay(req, res, context));
}
