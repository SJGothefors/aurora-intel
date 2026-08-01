import * as mgrs from 'mgrs';
import type { ExtractedReport, IntelCase } from './types';

const NUMERIC_STANDARD_IDENTITY: Record<IntelCase['aktor'], string> = {
  Okänd: '1',
  'Misstänkt främmande': '6',
  Civil: '4',
  Egen: '3',
};

const LEGACY_AFFILIATION: Record<IntelCase['aktor'], string> = {
  Okänd: 'U',
  'Misstänkt främmande': 'H',
  Civil: 'N',
  Egen: 'F',
};

const DEFAULT_NUMERIC_SIDC = '10031000000000000000';

export function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function normalizeTags(value: string | string[]): string[] {
  const values = Array.isArray(value) ? value : value.split(',');
  return [...new Set(values.map((tag) => tag.trim()).filter(Boolean))];
}

export function formatDateTime(value: string | null | undefined, lang: string): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'sv-SE', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(parsed);
}

export function formatCoordinate(value: number | null | undefined): string {
  return isFiniteCoordinate(value) ? value.toFixed(5) : '—';
}

export function toMgrs(lat: number, lon: number): string | null {
  try {
    return mgrs.forward([lon, lat], 5).replace(/(.{5})(.{5})$/, '$1 $2');
  } catch {
    return null;
  }
}

export function fromMgrs(input: string): { lat: number; lon: number; mgrs: string } | null {
  try {
    const clean = input.trim().toUpperCase().replace(/\s+/g, '');
    const point = mgrs.toPoint(clean);
    if (!point || point.length < 2) return null;
    const [lon, lat] = point;
    if (!isFiniteCoordinate(lat) || !isFiniteCoordinate(lon)) return null;
    const normalized = mgrs.forward([lon, lat], 5).replace(/(.{5})(.{5})$/, '$1 $2');
    return { lat, lon, mgrs: normalized };
  } catch {
    return null;
  }
}

export function mgrsTenKilometerSquare(input: string | null | undefined): string | null {
  if (!input) return null;
  const compact = input.trim().toUpperCase().replace(/\s+/g, '');
  const match = compact.match(/^(\d{1,2}[C-HJ-NP-X])([A-HJ-NP-Z]{2})(\d{2,10})$/);
  if (!match || match[3].length % 2 !== 0) return null;
  const precision = match[3].length / 2;
  const easting = match[3].slice(0, precision);
  const northing = match[3].slice(precision);
  if (!easting || !northing) return null;
  return `${match[1]}${match[2]}${easting[0]}${northing[0]}`;
}

/**
 * Applies Aurora's actor classification without changing a SIDC's standard or
 * length. Numeric 2525D/E SIDCs store standard identity in the fourth digit;
 * legacy 15-character SIDCs store affiliation in the second character.
 */
export function sidcForActor(value: string | null | undefined, actor: IntelCase['aktor']): string {
  const sidc = value?.trim().toUpperCase().replace(/\s+/g, '') ?? '';

  if (/^\d{20}(?:\d{10})?$/.test(sidc)) {
    return `${sidc.slice(0, 3)}${NUMERIC_STANDARD_IDENTITY[actor]}${sidc.slice(4)}`;
  }

  // Accept legacy values only when they are already complete SIDCs. In
  // particular, never pad or truncate a numeric SIDC into the legacy format.
  if (/^[SGWIOE][PUAFNSHGWMDLJKO][A-Z0-9-][A-Z0-9-]{12}$/.test(sidc)) {
    return `${sidc[0]}${LEGACY_AFFILIATION[actor]}${sidc.slice(2)}`;
  }

  return `${DEFAULT_NUMERIC_SIDC.slice(0, 3)}${NUMERIC_STANDARD_IDENTITY[actor]}${DEFAULT_NUMERIC_SIDC.slice(4)}`;
}

export function caseFromExtraction(report: ExtractedReport, raw: string): Partial<IntelCase> {
  return {
    status: 'Ny',
    star: false,
    tags: [],
    begrepp: report.begrepp ?? [],
    aktor: 'Okänd',
    dtg_raw: report.stunden?.raw ?? null,
    time_utc: report.stunden?.iso_utc ?? null,
    time_uncertain: Boolean(report.stunden?.uncertain || report.fields_uncertain?.includes('stunden')),
    place_raw: report.stallet?.raw ?? null,
    place_name: report.stallet?.place_name ?? null,
    mgrs: report.stallet?.mgrs ?? null,
    lat: report.stallet?.lat ?? null,
    lon: report.stallet?.lon ?? null,
    position_missing: report.position_missing,
    styrka_raw: report.styrkan?.raw ?? null,
    count_min: report.styrkan?.count_min ?? null,
    count_max: report.styrkan?.count_max ?? null,
    slag: report.slaget ?? null,
    sysselsattning: report.sysselsattningen ?? null,
    symbol: report.symbolen ?? null,
    sagesman: report.sagesmannen ?? null,
    kallrapport_raw: raw,
    ai_json: report,
    bedomning: null,
    fields_uncertain: report.fields_uncertain ?? [],
  };
}

export function activeFilterCount(filters: object): number {
  return Object.values(filters as Record<string, unknown>).filter((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value),
  ).length;
}

export function extractCaseValue(item: IntelCase, groupBy: string): string[] {
  switch (groupBy) {
    case 'begrepp':
      return item.begrepp.length ? item.begrepp : ['—'];
    case 'status':
      return [item.status];
    case 'day':
      return [item.time_utc?.slice(0, 10) ?? '—'];
    case 'tag':
      return item.tags.length ? item.tags : ['—'];
    case 'mgrs': {
      return [mgrsTenKilometerSquare(item.mgrs) ?? '—'];
    }
    default:
      return [''];
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
