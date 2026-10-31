import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { backupDatabase } from './backup.mjs';

test('live WAL backup restores exact funds and foreign keys; existing destination is not overwritten', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pilot-backup-'));
  const source = path.join(root, 'live.sqlite');
  const destination = path.join(root, 'backup.sqlite');
  const original = new Database(source);
  t.after(async () => { original.close(); await rm(root, { recursive: true, force: true }); });
  original.pragma('journal_mode = WAL');
  original.pragma('wal_autocheckpoint = 0');
  original.exec('CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE funds(user_id TEXT REFERENCES users(id), amount TEXT);');
  original.transaction(() => {
    original.prepare('INSERT INTO users VALUES (?)').run('customer');
    original.prepare('INSERT INTO funds VALUES (?,?)').run('customer', '9007199254740991999999');
  })();
  await backupDatabase(source, destination);
  const restored = new Database(destination);
  assert.deepEqual(restored.prepare('SELECT * FROM funds').all(), original.prepare('SELECT * FROM funds').all());
  assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok');
  restored.close();
  await assert.rejects(backupDatabase(source, destination), /already exists/);
  await assert.rejects(backupDatabase(source, source), /differ/);
});
