import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const args = process.argv.slice(2);
const local = args.includes('--local');
const emailIndex = args.indexOf('--email');
const email = emailIndex >= 0 ? args[emailIndex + 1] : local ? 'admin@pilotdeck.local' : null;
const outputIndex = args.indexOf('--directory');
const root = path.resolve(outputIndex >= 0 ? args[outputIndex + 1] : fileURLToPath(new URL('../../.pilotdeck/platform/', import.meta.url)));
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Supply --email admin@example.com (or --local for local development only).');
await mkdir(root, { recursive: true });
const envPath = path.join(root, 'platform.env');
try {
  await access(envPath);
  console.log(`Existing configuration preserved: ${envPath}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const password = randomBytes(24).toString('base64url');
  const values = {
    PLATFORM_HOST: '127.0.0.1', PLATFORM_PORT: '3100',
    PLATFORM_DATABASE: path.join(root, 'platform.sqlite').replaceAll('\\', '/'),
    PLATFORM_ENCRYPTION_KEY: randomBytes(48).toString('base64url'),
    PLATFORM_ADMIN_EMAIL: email, PLATFORM_ADMIN_PASSWORD: password,
  };
  await writeFile(envPath, Object.entries(values).map(([key, value]) => `${key}="${value}"`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(root, 'administrator.txt'), [
    local ? 'Local development administrator; not a production account.' : 'Initial administrator credentials.',
    `Email: ${email}`, `Password: ${password}`,
    'Keep this file private. Do not commit it or copy it into the desktop package.',
  ].join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  console.log(`Created configuration: ${envPath}`);
  console.log(`Administrator credentials: ${path.join(root, 'administrator.txt')}`);
}
