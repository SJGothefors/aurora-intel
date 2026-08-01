import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMgrs, mgrsToWgs84, normalizePosition, wgs84ToMgrs } from '../../server/geo.mjs';

test('fixture MGRS is library-validated and derives WGS84 coordinates', () => {
  const result = mgrsToWgs84('33VWE 12345 67890');
  assert.equal(result.mgrs, '33VWE 12345 67890');
  assert.ok(result.lat >= -80 && result.lat <= 84);
  assert.ok(result.lon >= -180 && result.lon <= 180);

  const reverse = wgs84ToMgrs(result.lat, result.lon);
  const original = formatMgrs('33VWE 12345 67890').replaceAll(' ', '');
  const converted = reverse.mgrs.replaceAll(' ', '');
  assert.equal(converted.slice(0, 5), original.slice(0, 5));
  assert.ok(Math.abs(Number(converted.slice(5, 10)) - Number(original.slice(5, 10))) <= 1);
  assert.ok(Math.abs(Number(converted.slice(10, 15)) - Number(original.slice(10, 15))) <= 1);
});

test('lat/lon input stores both coordinate systems and missing input stays missing', () => {
  const result = normalizePosition({ lat: 57.6348, lon: 18.2948 });
  assert.equal(result.position_missing, false);
  assert.match(result.mgrs, /^34V/);
  assert.equal(normalizePosition({}).position_missing, true);
  assert.throws(() => normalizePosition({ lat: 95, lon: 18 }), { code: 'INVALID_COORDINATES' });
});
