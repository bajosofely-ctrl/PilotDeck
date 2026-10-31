import Database from 'better-sqlite3';
import { access, mkdir, link, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export async function backupDatabase(source, destination) {
  const input = path.resolve(source);
  const output = path.resolve(destination);
  if (input === output) throw new Error('Backup destination must differ from source.');
  await access(input);
  try { await access(output); throw new Error('Destination already exists; choose a new backup file.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.${randomUUID()}.partial`;
  const database = new Database(input, { readonly: true, fileMustExist: true });
  try {
    // SQLite's backup API includes committed WAL pages in one consistent snapshot.
    await database.backup(temporary);
    const restored = new Database(temporary, { readonly: true, fileMustExist: true });
    try {
      if (restored.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Backup integrity check failed.');
      if (restored.pragma('foreign_key_check').length) throw new Error('Backup foreign-key check failed.');
    } finally { restored.close(); }
    // Exclusive publication also prevents concurrent backup jobs overwriting one another.
    await link(temporary, output);
    return output;
  } finally {
    database.close();
    await rm(temporary, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) {
    console.error('Usage: node ui/platform/backup.mjs <database.sqlite> <new-backup.sqlite>');
    process.exitCode = 1;
  } else {
    backupDatabase(source, destination).then(output => console.log(`Verified backup: ${output}`))
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
