import test from 'node:test';
import assert from 'node:assert/strict';
import { fromMicros, money, toMicros } from '../src/api.js';

test('RMB input retains every micro without floating point rounding', () => {
  assert.equal(toMicros('0.000001'), 1);
  assert.equal(toMicros('3.123456'), 3123456);
  assert.equal(toMicros('-0.123456'), -123456);
  assert.equal(toMicros('9007199254.740991'), Number.MAX_SAFE_INTEGER);
  assert.equal(fromMicros(10000000), '10');
  assert.equal(fromMicros(3123456), '3.123456');
  for (const invalid of ['', '1e6', '0.0000001', 'NaN', '9007199254.740992']) {
    assert.throws(() => toMicros(invalid));
  }
});

test('sub-micro actual charges remain visible instead of displaying zero', () => {
  assert.equal(money(-0.000001), '¥-0.000000000001');
  assert.equal(money(null), '—');
  assert.equal(money(0), '¥0.00');
});
