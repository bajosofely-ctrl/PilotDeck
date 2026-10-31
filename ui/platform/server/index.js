import { createPlatformApp } from './app.js';

const port = Number(process.env.PLATFORM_PORT || 3100);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PLATFORM_PORT.');
if (process.env.PLATFORM_ENCRYPTION_KEY?.startsWith('replace-') || process.env.PLATFORM_ADMIN_PASSWORD?.startsWith('replace-')) {
  throw new Error('Replace the template secrets before starting the platform.');
}
const platform = await createPlatformApp({
  dbPath: process.env.PLATFORM_DATABASE || './platform-data/platform.sqlite',
  encryptionKey: process.env.PLATFORM_ENCRYPTION_KEY,
  ...(process.env.PLATFORM_ADMIN_EMAIL ? { bootstrapAdmin: { email: process.env.PLATFORM_ADMIN_EMAIL, password: process.env.PLATFORM_ADMIN_PASSWORD } } : {}),
  trustProxy: process.env.PLATFORM_TRUST_PROXY === 'loopback' ? 'loopback' : undefined,
});
const server = platform.app.listen(port, process.env.PLATFORM_HOST || '127.0.0.1', () => console.log(`PilotDeck platform listening on port ${port}`));
server.on('error', () => { console.error('Platform could not start. Check the configured port.'); platform.close(); process.exitCode = 1; });
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  server.close(() => { platform.close(); });
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
