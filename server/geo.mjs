import mgrsModule from 'mgrs';
import { AppError } from './errors.mjs';

const mgrs = mgrsModule?.default ?? mgrsModule;

export function compactMgrs(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function formatMgrs(value) {
  const compact = compactMgrs(value);
  const match = compact.match(/^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z]{2})(\d{0,10})$/);
  if (!match || match[4].length % 2 !== 0) {
    throw new AppError('INVALID_MGRS', 'The MGRS value is invalid.', { details: { value } });
  }
  const precision = match[4].length / 2;
  const east = match[4].slice(0, precision);
  const north = match[4].slice(precision);
  return `${match[1]}${match[2]}${match[3]}${precision ? ` ${east} ${north}` : ''}`;
}

export function mgrsToWgs84(value) {
  const formatted = formatMgrs(value);
  try {
    const point = mgrs.toPoint(compactMgrs(formatted));
    const [lon, lat] = point.map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Non-finite coordinate');
    return { mgrs: formatted, lat, lon };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('INVALID_MGRS', 'The MGRS value is invalid.', { details: { value }, cause: error });
  }
}

export function wgs84ToMgrs(latValue, lonValue, precision = 5) {
  const lat = Number(latValue);
  const lon = Number(lonValue);
  if (!Number.isFinite(lat) || lat < -80 || lat > 84 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new AppError('INVALID_COORDINATES', 'The WGS84 coordinates are invalid.', {
      details: { lat: latValue, lon: lonValue },
    });
  }
  const safePrecision = Math.max(0, Math.min(5, Number(precision) || 5));
  try {
    return { mgrs: formatMgrs(mgrs.forward([lon, lat], safePrecision)), lat, lon };
  } catch (error) {
    throw new AppError('INVALID_COORDINATES', 'The coordinates cannot be represented as MGRS.', {
      details: { lat, lon }, cause: error,
    });
  }
}

export function normalizePosition({ mgrs: mgrsValue, lat: latValue, lon: lonValue } = {}, { strict = true } = {}) {
  try {
    if (mgrsValue !== null && mgrsValue !== undefined && String(mgrsValue).trim() !== '') {
      return { ...mgrsToWgs84(mgrsValue), position_missing: false };
    }
    const hasLat = latValue !== null && latValue !== undefined && String(latValue).trim() !== '';
    const hasLon = lonValue !== null && lonValue !== undefined && String(lonValue).trim() !== '';
    if (hasLat || hasLon) {
      if (!hasLat || !hasLon) throw new AppError('INCOMPLETE_COORDINATES', 'Both latitude and longitude are required.');
      return { ...wgs84ToMgrs(latValue, lonValue), position_missing: false };
    }
    return { mgrs: null, lat: null, lon: null, position_missing: true };
  } catch (error) {
    if (strict) throw error;
    return { mgrs: null, lat: null, lon: null, position_missing: true, error };
  }
}
