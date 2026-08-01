import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDTG } from '../../server/dtg.mjs';

test('military DTG normalizes A, B and Z zones to UTC', () => {
  assert.equal(parseDTG('010632B AUG 26').isoUtc, '2026-08-01T04:32:00.000Z');
  assert.equal(parseDTG('010632A AUG 26').isoUtc, '2026-08-01T05:32:00.000Z');
  assert.equal(parseDTG('010632Z AUG 26').isoUtc, '2026-08-01T06:32:00.000Z');
  assert.equal(parseDTG('010632B AUG 26').uncertain, false);
});

test('DTG parser accepts Swedish month names and ISO 8601', () => {
  assert.equal(parseDTG('1 augusti 2026 kl 06:32', { localOffsetMinutes: 120 }).isoUtc, '2026-08-01T04:32:00.000Z');
  assert.equal(parseDTG('2026-08-01T06:32:00+02:00').isoUtc, '2026-08-01T04:32:00.000Z');
});

test('relative Swedish time resolves against entry time and remains uncertain', () => {
  const result = parseDTG('ca 2130 igår kväll', {
    referenceDate: new Date('2026-08-01T10:00:00.000Z'),
    localOffsetMinutes: 120,
  });
  assert.equal(result.isoUtc, '2026-07-31T19:30:00.000Z');
  assert.equal(result.uncertain, true);
  assert.equal(result.kind, 'relative');
});

test('invalid dates and unrelated prose are rejected conservatively', () => {
  assert.equal(parseDTG('320632B AUG 26'), null);
  assert.equal(parseDTG('någon gång senare'), null);
});
