import { AppError, assert } from './errors.mjs';
import { boundedText } from './validation.mjs';

function iso(value) {
  const date = new Date(value);
  assert(!Number.isNaN(date.valueOf()), 'INVALID_WEATHER_TIME', 'Weather time is invalid.');
  return date.toISOString();
}

function numberOrNull(value, field, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  assert(Number.isFinite(number) && number >= min && number <= max, 'INVALID_WEATHER_VALUE', `${field} is outside its allowed range.`, { details: { field } });
  return number;
}

export function cleanupWeather(db, now = new Date()) {
  const cutoff = new Date(now.valueOf() - 2 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM weather_entries WHERE forecast_at < ?').run(cutoff);
}

export function listWeather(db, { now = new Date() } = {}) {
  cleanupWeather(db, now);
  return db.prepare('SELECT * FROM weather_entries ORDER BY forecast_at').all();
}

export function createWeather(db, input, { now = new Date() } = {}) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_WEATHER', 'Weather data must be an object.');
  cleanupWeather(db, now);
  const forecastAt = iso(input.forecast_at);
  const date = new Date(forecastAt);
  const earliest = new Date(now.valueOf() - 2 * 24 * 60 * 60 * 1000);
  const latest = new Date(now.valueOf() + 6 * 24 * 60 * 60 * 1000);
  assert(date >= earliest && date <= latest, 'WEATHER_OUTSIDE_WINDOW', 'Weather data must be within the two-day history and five-day forecast window.');
  const day = forecastAt.slice(0, 10);
  const count = Number(db.prepare("SELECT count(*) count FROM weather_entries WHERE substr(forecast_at, 1, 10) = ?").get(day).count);
  assert(count < 3, 'WEATHER_DAY_FULL', 'A day can contain at most three weather time points.', { status: 409 });
  const timestamp = now.toISOString();
  try {
    const result = db.prepare(`INSERT INTO weather_entries
      (forecast_at, temperature_c, rain_mm, humidity_pct, cloud_pct, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      forecastAt,
      numberOrNull(input.temperature_c, 'temperature_c', -80, 60),
      numberOrNull(input.rain_mm, 'rain_mm', 0, 1000),
      numberOrNull(input.humidity_pct, 'humidity_pct', 0, 100),
      numberOrNull(input.cloud_pct, 'cloud_pct', 0, 100),
      boundedText(input.note, 'weather_note', 1024), timestamp, timestamp,
    );
    return db.prepare('SELECT * FROM weather_entries WHERE id = ?').get(Number(result.lastInsertRowid));
  } catch (error) {
    if (String(error?.message).includes('UNIQUE')) throw new AppError('WEATHER_TIME_EXISTS', 'A weather entry already exists for that time.', { status: 409 });
    throw error;
  }
}

export function deleteWeather(db, id) {
  const numeric = Number(id);
  assert(Number.isSafeInteger(numeric) && numeric > 0, 'INVALID_ID', 'Weather id is invalid.');
  const existing = db.prepare('SELECT * FROM weather_entries WHERE id = ?').get(numeric);
  if (!existing) throw new AppError('WEATHER_NOT_FOUND', 'Weather entry was not found.', { status: 404 });
  db.prepare('DELETE FROM weather_entries WHERE id = ?').run(numeric);
  return existing;
}
