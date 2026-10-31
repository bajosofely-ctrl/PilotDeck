export function managedDistribution(env) {
  const localTest = env.PILOTDECK_DISTRIBUTION === 'managed-local-test';
  const url = env.PILOTDECK_MANAGED_URL;
  if (!url) {
    if (localTest || env.PILOTDECK_DISTRIBUTION === 'managed') {
      throw new Error('Managed desktop distribution requires PILOTDECK_MANAGED_URL.');
    }
    return null;
  }
  const service = new URL(url);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(service.hostname);
  const allowed = localTest
    ? loopback && ['http:', 'https:'].includes(service.protocol)
    : service.protocol === 'https:';
  if (!allowed || service.username || service.password || service.pathname !== '/' || service.search || service.hash) {
    throw new Error(localTest
      ? 'Local test packages require an HTTP(S) loopback origin.'
      : 'Packaged managed service must be an HTTPS origin.');
  }
  return { serviceOrigin: service.origin };
}
