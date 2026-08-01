import { AppError } from './errors.mjs';

const MONTHS = new Map(Object.entries({
  JAN: 0, JANUARI: 0,
  FEB: 1, FEBRUARI: 1,
  MAR: 2, MARS: 2,
  APR: 3, APRIL: 3,
  MAJ: 4, MAY: 4,
  JUN: 5, JUNI: 5,
  JUL: 6, JULI: 6,
  AUG: 7, AUGUSTI: 7,
  SEP: 8, SEPT: 8, SEPTEMBER: 8,
  OKT: 9, OKTOBER: 9, OCT: 9, OCTOBER: 9,
  NOV: 10, NOVEMBER: 10,
  DEC: 11, DECEMBER: 11,
}));

const ZONE_OFFSETS = Object.freeze({
  Z: 0,
  A: 60, B: 120, C: 180, D: 240, E: 300, F: 360,
  G: 420, H: 480, I: 540, K: 600, L: 660, M: 720,
  N: -60, O: -120, P: -180, Q: -240, R: -300, S: -360,
  T: -420, U: -480, V: -540, W: -600, X: -660, Y: -720,
});

function validUtcParts(year, month, day, hour, minute) {
  const date = new Date(Date.UTC(year, month, day, hour, minute));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute;
}

function isoAtOffset(year, month, day, hour, minute, offsetMinutes) {
  if (!validUtcParts(year, month, day, hour, minute)) return null;
  return new Date(Date.UTC(year, month, day, hour, minute) - offsetMinutes * 60_000).toISOString();
}

function normalizeYear(value) {
  const year = Number(value);
  if (value.length === 4) return year;
  return year >= 70 ? 1900 + year : 2000 + year;
}

function parseMilitary(raw) {
  const normalized = raw.trim().toUpperCase().replace(/[,]+/g, ' ').replace(/\s+/g, ' ');
  const match = normalized.match(/^(\d{2})(\d{2})(\d{2})([A-IK-Z])\s+([A-ZÅÄÖ]{3,10})\s+(\d{2}|\d{4})$/u);
  if (!match) return null;
  const [, dayText, hourText, minuteText, zone, monthText, yearText] = match;
  const month = MONTHS.get(monthText);
  const offsetMinutes = ZONE_OFFSETS[zone];
  if (month === undefined || offsetMinutes === undefined) return null;
  const year = normalizeYear(yearText);
  const isoUtc = isoAtOffset(year, month, Number(dayText), Number(hourText), Number(minuteText), offsetMinutes);
  if (!isoUtc) return null;
  return { raw, isoUtc, uncertain: false, kind: 'military', zone, offsetMinutes };
}

function parseIso(raw) {
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/i.test(raw.trim())) return null;
  const date = new Date(raw.trim());
  if (Number.isNaN(date.valueOf())) return null;
  return { raw, isoUtc: date.toISOString(), uncertain: false, kind: 'iso', offsetMinutes: null };
}

function parseWrittenDate(raw, localOffsetMinutes) {
  const text = raw.trim().toLocaleLowerCase('sv-SE');
  const match = text.match(/\b(\d{1,2})\s+([a-zåäö]{3,10})\s+(\d{2}|\d{4})(?:\s+(?:kl\.?\s*)?(\d{1,2})[:.]?(\d{2}))?\b/u);
  if (!match) return null;
  const month = MONTHS.get(match[2].toLocaleUpperCase('sv-SE'));
  if (month === undefined) return null;
  const hour = match[4] === undefined ? 12 : Number(match[4]);
  const minute = match[5] === undefined ? 0 : Number(match[5]);
  const isoUtc = isoAtOffset(normalizeYear(match[3]), month, Number(match[1]), hour, minute, localOffsetMinutes);
  if (!isoUtc) return null;
  return {
    raw,
    isoUtc,
    uncertain: match[4] === undefined || /\b(?:ca|cirka|ungefär)\b/u.test(text),
    kind: 'written',
    offsetMinutes: localOffsetMinutes,
  };
}

function localPartsAt(referenceDate, offsetMinutes) {
  const shifted = new Date(referenceDate.valueOf() + offsetMinutes * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
  };
}

function shiftCalendarDay(parts, amount) {
  const shifted = new Date(Date.UTC(parts.year, parts.month, parts.day + amount));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() };
}

function parseRelativeSwedish(raw, referenceDate, localOffsetMinutes) {
  const text = raw.trim().toLocaleLowerCase('sv-SE');
  const yesterday = /\b(?:igår|i går|igar)\b/u.test(text);
  const today = /\b(?:idag|i dag|i morse|i natt|ikväll|i kväll)\b/u.test(text);
  if (!yesterday && !today) return null;

  const timeMatch = text.match(/\b([01]?\d|2[0-3])[:.]?([0-5]\d)\b/u);
  let hour;
  let minute;
  if (timeMatch) {
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
  } else if (/\b(?:morse|morgon)\b/u.test(text)) {
    hour = 7;
    minute = 0;
  } else if (/\b(?:kväll|kvallen)\b/u.test(text)) {
    hour = 20;
    minute = 0;
  } else if (/\bnatt\b/u.test(text)) {
    hour = 2;
    minute = 0;
  } else {
    hour = 12;
    minute = 0;
  }

  const base = localPartsAt(referenceDate, localOffsetMinutes);
  const parts = yesterday ? shiftCalendarDay(base, -1) : base;
  const isoUtc = isoAtOffset(parts.year, parts.month, parts.day, hour, minute, localOffsetMinutes);
  return { raw, isoUtc, uncertain: true, kind: 'relative', offsetMinutes: localOffsetMinutes };
}

/**
 * Parse a military DTG, ISO timestamp, written Swedish date, or a small set of
 * deliberately conservative Swedish relative-time expressions.
 */
export function parseDTG(raw, options = {}) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const text = String(raw);
  const referenceDate = options.referenceDate instanceof Date
    ? options.referenceDate
    : new Date(options.referenceDate ?? Date.now());
  if (Number.isNaN(referenceDate.valueOf())) {
    throw new AppError('INVALID_REFERENCE_TIME', 'The report entry time is invalid.');
  }
  const localOffsetMinutes = Number.isFinite(options.localOffsetMinutes)
    ? Number(options.localOffsetMinutes)
    : -referenceDate.getTimezoneOffset();
  return parseMilitary(text)
    ?? parseIso(text)
    ?? parseWrittenDate(text, localOffsetMinutes)
    ?? parseRelativeSwedish(text, referenceDate, localOffsetMinutes);
}

export function requireDTG(raw, options) {
  const parsed = parseDTG(raw, options);
  if (!parsed) throw new AppError('INVALID_DTG', 'The date-time value could not be parsed.', { details: { raw } });
  return parsed;
}

export const militaryZoneOffsets = ZONE_OFFSETS;
