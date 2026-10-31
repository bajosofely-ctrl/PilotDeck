import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import Database from 'better-sqlite3';
import { backupDatabase } from '../../backup.mjs';

const [sourceDirectory, outputDirectory] = process.argv.slice(2);
if (!sourceDirectory || !outputDirectory) throw new Error('Supply source and new output directories.');
const source = path.resolve(sourceDirectory);
const output = path.resolve(outputDirectory);
await mkdir(output, { recursive: true });
const env = parseEnv(await readFile(path.join(source, 'platform.env'), 'utf8'));
if (!env.PLATFORM_ENCRYPTION_KEY || env.PLATFORM_ENCRYPTION_KEY.length < 32) throw new Error('Missing encryption key.');
const snapshot = path.join(output, 'platform.sqlite');
await backupDatabase(path.join(source, 'platform.sqlite'), snapshot);
const db = new Database(snapshot, { readonly: true, fileMustExist: true });
try {
  if (db.prepare("SELECT count(*) AS n FROM billing_calls WHERE status = 'active'").get().n) {
    throw new Error('Active model calls exist. Wait for them to finish before migration.');
  }
  const counts = {};
  for (const table of ['users', 'channels', 'models', 'apps', 'billing_lots', 'billing_ledger', 'billing_codes']) {
    counts[table] = db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
  }
  const values = {
    PLATFORM_ENCRYPTION_KEY: env.PLATFORM_ENCRYPTION_KEY,
    PLATFORM_HOST: '127.0.0.1',
    PLATFORM_PORT: '3100',
    PLATFORM_DATABASE: '/data/platform.sqlite',
    PLATFORM_TRUST_PROXY: 'loopback',
  };
  for (const key of ['PLATFORM_MAIL_URL', 'PLATFORM_MAIL_TOKEN', 'PLATFORM_MAIL_FROM']) {
    if (env[key]) values[key] = env[key];
  }
  if (Object.values(values).some(value => /[\r\n"]/.test(value))) throw new Error('Unsupported environment value.');
  await writeFile(path.join(output, 'platform.env'),
    Object.entries(values).map(([key, value]) => `${key}="${value}"`).join('\n') + '\n',
    { mode: 0o600, flag: 'wx' });
  await writeFile(path.join(output, 'summary.json'), JSON.stringify({
    createdAt: new Date().toISOString(), counts,
    emailConfigured: Boolean(values.PLATFORM_MAIL_URL && values.PLATFORM_MAIL_TOKEN && values.PLATFORM_MAIL_FROM),
  }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ counts, emailConfigured: Boolean(values.PLATFORM_MAIL_URL && values.PLATFORM_MAIL_TOKEN && values.PLATFORM_MAIL_FROM) }));
} finally {
  db.close();
}
