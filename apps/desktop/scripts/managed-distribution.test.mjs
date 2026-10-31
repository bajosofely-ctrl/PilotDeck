import assert from 'node:assert/strict';
import { test } from 'node:test';
import { managedDistribution } from './managed-distribution.mjs';

test('production managed packages require an HTTPS origin', () => {
  assert.equal(managedDistribution({}), null);
  assert.throws(() => managedDistribution({ PILOTDECK_DISTRIBUTION: 'managed' }));
  for (const url of ['http://127.0.0.1:3100', 'http://example.com', 'https://user:pass@example.com', 'https://example.com/api', 'https://example.com/?key=secret', 'https://example.com/#x']) {
    assert.throws(() => managedDistribution({ PILOTDECK_MANAGED_URL: url }), url);
  }
  assert.deepEqual(managedDistribution({ PILOTDECK_DISTRIBUTION: 'managed', PILOTDECK_MANAGED_URL: 'https://example.com/' }), { serviceOrigin: 'https://example.com' });
});

test('local test packages require an explicit loopback origin', () => {
  const env = { PILOTDECK_DISTRIBUTION: 'managed-local-test' };
  assert.throws(() => managedDistribution(env));
  for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
    assert.deepEqual(managedDistribution({ ...env, PILOTDECK_MANAGED_URL: `http://${host}:3100` }), { serviceOrigin: `http://${host}:3100` });
  }
  for (const url of ['http://example.com', 'https://example.com', 'http://localhost.example.com', 'http://127.0.0.1:3100/api', 'http://user:pass@localhost:3100', 'file:///tmp/test', 'http://localhost:3100/?key=secret']) {
    assert.throws(() => managedDistribution({ ...env, PILOTDECK_MANAGED_URL: url }), url);
  }
});
