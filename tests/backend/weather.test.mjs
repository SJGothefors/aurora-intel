import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeather, deleteWeather, listWeather } from '../../server/weather.mjs';
import { temporaryDatabase } from './helpers.mjs';

test('manual weather enforces its local window, daily cap, nullable fields, and retention', (t) => {
  const { db } = temporaryDatabase(t);
  const now = new Date('2026-08-09T10:00:00.000Z');
  const first = createWeather(db, { forecast_at: '2026-08-10T06:00:00Z', temperature_c: 12, rain_mm: null }, { now });
  createWeather(db, { forecast_at: '2026-08-10T12:00:00Z', humidity_pct: 70 }, { now });
  createWeather(db, { forecast_at: '2026-08-10T18:00:00Z', cloud_pct: 80 }, { now });
  assert.equal(listWeather(db, { now }).length, 3);
  assert.throws(() => createWeather(db, { forecast_at: '2026-08-10T21:00:00Z' }, { now }), /at most three/i);
  assert.throws(() => createWeather(db, { forecast_at: '2026-08-20T10:00:00Z' }, { now }), /five-day forecast/i);
  assert.equal(deleteWeather(db, first.id).id, first.id);
  assert.equal(listWeather(db, { now }).length, 2);
  assert.equal(listWeather(db, { now: new Date('2026-08-13T19:00:00Z') }).length, 0);
});
