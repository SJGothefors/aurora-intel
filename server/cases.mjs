import { AppError, assert } from './errors.mjs';
import { normalizePosition } from './geo.mjs';
import { parseDTG } from './dtg.mjs';
import { vocabularyNames } from './vocabulary.mjs';
import { withTransaction } from './db.mjs';
import { boundedStringArray, boundedText, encodeBoundedJson, INPUT_LIMITS } from './validation.mjs';

export const CASE_COLUMNS = Object.freeze([
  'id', 'lopnr', 'created_at', 'updated_at', 'created_by', 'status', 'star',
  'tags', 'begrepp', 'aktor', 'source_report_id', 'source_assessment', 'dtg_raw', 'time_utc', 'time_uncertain',
  'place_raw', 'place_name', 'mgrs', 'lat', 'lon', 'position_missing',
  'styrka_raw', 'count_min', 'count_max', 'slag', 'sysselsattning',
  'symbol', 'sagesman', 'activity_summary', 'traits_summary', 'kallrapport_raw', 'ai_json', 'bedomning',
  'fields_uncertain',
]);

const MUTABLE_COLUMNS = CASE_COLUMNS.filter((column) => !['id', 'lopnr', 'created_at', 'updated_at'].includes(column));
const JSON_ARRAY_COLUMNS = new Set(['tags', 'begrepp', 'fields_uncertain']);
const BOOLEAN_COLUMNS = new Set(['star', 'time_uncertain', 'position_missing']);
const STATUSES = new Set(['Ny', 'Under bearbetning', 'Uppföljning', 'Avslutad']);
const ACTORS = new Set(['Okänd', 'Misstänkt främmande', 'Civil', 'Egen']);
const SOURCE_ASSESSMENTS = new Set(['Okänd', 'Låg', 'Medel', 'Hög']);

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function text(value, { field, maxBytes, emptyAsNull = true } = {}) {
  return boundedText(value, field, maxBytes, { emptyAsNull });
}

function integerOrNull(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const candidate = typeof value === 'string' ? boundedText(value, field, 64, { required: true }) : value;
  const number = Number(candidate);
  assert(Number.isSafeInteger(number) && number >= 0 && number <= 1_000_000_000, 'INVALID_INTEGER', `${field} must be a non-negative integer no greater than 1000000000.`, {
    details: { field, value },
  });
  return number;
}

function boundedNumericInput(value, field) {
  return typeof value === 'string' ? boundedText(value, field, 64, { required: true }) : value;
}

export function parseArray(value, { separators = false, field = 'value', maxItems = 10_000, maxItemBytes = 4_096 } = {}) {
  if (value === null || value === undefined || value === '') return [];
  let array = value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      array = Array.isArray(parsed) ? parsed : [value];
    } catch {
      array = separators ? value.split(/[;,]/u) : [value];
    }
  }
  assert(Array.isArray(array), 'INVALID_ARRAY', 'The value must be an array.');
  return boundedStringArray(array, field, { maxItems, maxItemBytes }).filter(Boolean);
}

function normalizeVocabulary(db, value, { activeOnly = false } = {}) {
  const supplied = parseArray(value, { separators: true, field: 'begrepp', maxItems: 128, maxItemBytes: 256 });
  const allowed = vocabularyNames(db, { activeOnly });
  const canonical = new Map([...allowed].map((name) => [name.toLocaleUpperCase('sv-SE'), name]));
  const invalid = [];
  const normalized = [];
  for (const name of supplied) {
    const match = canonical.get(name.toLocaleUpperCase('sv-SE'));
    if (!match) invalid.push(name);
    else if (!normalized.includes(match)) normalized.push(match);
  }
  if (invalid.length) {
    throw new AppError('INVALID_BEGREPP', 'One or more controlled-vocabulary values are invalid.', {
      details: { invalid, allowed: [...allowed] },
    });
  }
  return normalized;
}

function normalizeIso(value, field = 'time_utc') {
  if (value === null || value === undefined || value === '') return null;
  const normalized = boundedText(value, field, 128, { required: true });
  const date = new Date(normalized);
  assert(!Number.isNaN(date.valueOf()), 'INVALID_TIME', 'The UTC timestamp is invalid.', { details: { field } });
  return date.toISOString();
}

function aliases(input) {
  const result = { ...input };
  if (input.stunden && typeof input.stunden === 'object') {
    if (!own(result, 'dtg_raw')) result.dtg_raw = input.stunden.raw;
    if (!own(result, 'time_utc')) result.time_utc = input.stunden.iso_utc;
    if (!own(result, 'time_uncertain')) result.time_uncertain = input.stunden.uncertain;
  }
  if (input.stallet && typeof input.stallet === 'object') {
    if (!own(result, 'place_raw')) result.place_raw = input.stallet.raw;
    for (const field of ['place_name', 'mgrs', 'lat', 'lon']) {
      if (!own(result, field)) result[field] = input.stallet[field];
    }
  }
  if (input.styrkan && typeof input.styrkan === 'object') {
    if (!own(result, 'styrka_raw')) result.styrka_raw = input.styrkan.raw;
    if (!own(result, 'count_min')) result.count_min = input.styrkan.count_min;
    if (!own(result, 'count_max')) result.count_max = input.styrkan.count_max;
  }
  if (own(input, 'sysselsattningen') && !own(result, 'sysselsattning')) result.sysselsattning = input.sysselsattningen;
  if (own(input, 'symbolen') && !own(result, 'symbol')) result.symbol = input.symbolen;
  if (own(input, 'sagesmannen') && !own(result, 'sagesman')) result.sagesman = input.sagesmannen;
  return result;
}

export function deserializeCase(row) {
  if (!row) return null;
  const result = { ...row };
  for (const column of JSON_ARRAY_COLUMNS) {
    try { result[column] = JSON.parse(result[column] ?? '[]'); } catch { result[column] = []; }
  }
  if (typeof result.ai_json === 'string') {
    try { result.ai_json = JSON.parse(result.ai_json); } catch { /* Preserve legacy text. */ }
  }
  for (const column of BOOLEAN_COLUMNS) result[column] = Boolean(result[column]);
  return result;
}

function attachCaseNotes(db, rows) {
  if (!rows.length) return rows;
  const ids = rows.map((row) => Number(row.id));
  const notes = [];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const chunk = ids.slice(offset, offset + 500);
    notes.push(...db.prepare(`SELECT * FROM notes WHERE entity_type = 'case' AND entity_id IN (${chunk.map(() => '?').join(', ')}) ORDER BY ts, id`)
      .all(...chunk));
  }
  notes.sort((left, right) => left.ts.localeCompare(right.ts) || Number(left.id) - Number(right.id));
  const grouped = new Map(ids.map((id) => [id, []]));
  for (const note of notes) grouped.get(Number(note.entity_id))?.push(note);
  return rows.map((row) => ({ ...row, notes: grouped.get(Number(row.id)) ?? [] }));
}

export function normalizeCase(db, rawInput, options = {}) {
  assert(rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput), 'INVALID_CASE', 'The case payload must be an object.');
  const input = aliases(rawInput);
  const existing = options.existing ?? {};
  const merged = { ...existing, ...input };

  const status = text(merged.status, { field: 'status', maxBytes: 64, emptyAsNull: false }) || 'Ny';
  const aktor = text(merged.aktor, { field: 'aktor', maxBytes: 64, emptyAsNull: false }) || 'Okänd';
  const sourceAssessment = text(merged.source_assessment, { field: 'source_assessment', maxBytes: 64, emptyAsNull: false }) || 'Okänd';
  assert(STATUSES.has(status), 'INVALID_STATUS', 'The case status is invalid.', { details: { status } });
  assert(ACTORS.has(aktor), 'INVALID_ACTOR', 'The actor classification is invalid.', { details: { aktor } });
  assert(SOURCE_ASSESSMENTS.has(sourceAssessment), 'INVALID_SOURCE_ASSESSMENT', 'The source assessment is invalid.');

  const tags = parseArray(merged.tags, { separators: true, field: 'tags', maxItems: 64, maxItemBytes: 128 });
  const begrepp = normalizeVocabulary(db, merged.begrepp, { activeOnly: !options.allowInactiveVocabulary });
  const fieldsUncertain = parseArray(merged.fields_uncertain, { separators: true, field: 'fields_uncertain', maxItems: 64, maxItemBytes: 128 });

  const dtgRaw = text(merged.dtg_raw, { field: 'dtg_raw', maxBytes: INPUT_LIMITS.case.dtg_raw });
  let parsedTime = null;
  if (dtgRaw) {
    const referenceDate = options.referenceDate instanceof Date || options.referenceDate === undefined
      ? options.referenceDate
      : boundedText(options.referenceDate, 'entry_time', 128, { required: true });
    parsedTime = parseDTG(dtgRaw, {
      referenceDate,
      localOffsetMinutes: options.localOffsetMinutes,
    });
  }
  const timeUtc = parsedTime?.isoUtc ?? normalizeIso(merged.time_utc);
  const timeUncertain = Boolean(parsedTime?.uncertain ?? merged.time_uncertain);

  let position;
  const positionWasPatched = own(input, 'mgrs') || own(input, 'lat') || own(input, 'lon');
  if (positionWasPatched || !options.existing) {
    const positionInput = own(input, 'mgrs')
      ? { mgrs: boundedText(input.mgrs, 'mgrs', INPUT_LIMITS.case.mgrs), lat: boundedNumericInput(input.lat, 'lat'), lon: boundedNumericInput(input.lon, 'lon') }
      : own(input, 'lat') || own(input, 'lon')
        ? { mgrs: null, lat: boundedNumericInput(input.lat, 'lat'), lon: boundedNumericInput(input.lon, 'lon') }
        : { mgrs: boundedText(merged.mgrs, 'mgrs', INPUT_LIMITS.case.mgrs), lat: boundedNumericInput(merged.lat, 'lat'), lon: boundedNumericInput(merged.lon, 'lon') };
    position = normalizePosition(positionInput);
  } else {
    position = {
      mgrs: existing.mgrs ?? null,
      lat: existing.lat ?? null,
      lon: existing.lon ?? null,
      position_missing: Boolean(existing.position_missing),
    };
  }

  const countMin = integerOrNull(merged.count_min, 'count_min');
  const countMax = integerOrNull(merged.count_max, 'count_max');
  assert(countMin === null || countMax === null || countMin <= countMax,
    'INVALID_COUNT_RANGE', 'count_min cannot exceed count_max.');

  let aiJson = null;
  if (merged.ai_json !== null && merged.ai_json !== undefined && merged.ai_json !== '') {
    if (typeof merged.ai_json === 'string') {
      const encoded = boundedText(merged.ai_json, 'ai_json', INPUT_LIMITS.case.ai_json, { required: true, trim: false });
      try { aiJson = JSON.parse(encoded); }
      catch (error) { throw new AppError('INVALID_AI_JSON', 'ai_json must contain valid JSON.', { cause: error }); }
    } else aiJson = merged.ai_json;
    encodeBoundedJson(aiJson, 'ai_json', { maxBytes: INPUT_LIMITS.case.ai_json });
  }

  const normalized = {
    created_by: text(merged.created_by, { field: 'created_by', maxBytes: INPUT_LIMITS.case.created_by, emptyAsNull: false }) ?? '',
    status,
    star: Boolean(merged.star),
    tags,
    begrepp,
    aktor,
    source_assessment: sourceAssessment,
    source_report_id: text(merged.source_report_id, { field: 'source_report_id', maxBytes: INPUT_LIMITS.case.source_report_id }),
    dtg_raw: dtgRaw,
    time_utc: timeUtc,
    time_uncertain: timeUncertain,
    place_raw: text(merged.place_raw, { field: 'place_raw', maxBytes: INPUT_LIMITS.case.place_raw }),
    place_name: text(merged.place_name, { field: 'place_name', maxBytes: INPUT_LIMITS.case.place_name }),
    ...position,
    styrka_raw: text(merged.styrka_raw, { field: 'styrka_raw', maxBytes: INPUT_LIMITS.case.styrka_raw }),
    count_min: countMin,
    count_max: countMax,
    slag: text(merged.slag, { field: 'slag', maxBytes: INPUT_LIMITS.case.slag }),
    sysselsattning: text(merged.sysselsattning, { field: 'sysselsattning', maxBytes: INPUT_LIMITS.case.sysselsattning }),
    symbol: text(merged.symbol, { field: 'symbol', maxBytes: INPUT_LIMITS.case.symbol }),
    sagesman: text(merged.sagesman, { field: 'sagesman', maxBytes: INPUT_LIMITS.case.sagesman }),
    activity_summary: text(merged.activity_summary, { field: 'activity_summary', maxBytes: INPUT_LIMITS.case.activity_summary }),
    traits_summary: text(merged.traits_summary, { field: 'traits_summary', maxBytes: INPUT_LIMITS.case.traits_summary }),
    kallrapport_raw: text(merged.kallrapport_raw, { field: 'kallrapport_raw', maxBytes: INPUT_LIMITS.case.kallrapport_raw }),
    ai_json: aiJson,
    bedomning: text(merged.bedomning, { field: 'bedomning', maxBytes: INPUT_LIMITS.case.bedomning }),
    fields_uncertain: fieldsUncertain,
  };
  if (!timeUtc && dtgRaw && !normalized.fields_uncertain.includes('stunden')) normalized.fields_uncertain.push('stunden');
  if (position.position_missing && !normalized.fields_uncertain.includes('stallet') && (merged.place_raw || merged.place_name)) {
    normalized.fields_uncertain.push('stallet');
  }
  return normalized;
}

function dbValue(column, value) {
  if (JSON_ARRAY_COLUMNS.has(column)) return JSON.stringify(value ?? []);
  if (column === 'ai_json') return value === null ? null : encodeBoundedJson(value, 'ai_json', { maxBytes: INPUT_LIMITS.case.ai_json });
  if (BOOLEAN_COLUMNS.has(column)) return value ? 1 : 0;
  return value;
}

export function getCase(db, id) {
  const numericId = Number(id);
  assert(Number.isSafeInteger(numericId) && numericId > 0, 'INVALID_ID', 'The case id is invalid.');
  const row = db.prepare('SELECT * FROM cases WHERE id = ?').get(numericId);
  if (!row) throw new AppError('CASE_NOT_FOUND', 'The case was not found.', { status: 404 });
  return attachCaseNotes(db, [deserializeCase(row)])[0];
}

export function createCase(db, input, options = {}) {
  const normalized = normalizeCase(db, input, options);
  const now = options.now ? normalizeIso(options.now, 'timestamp') : new Date().toISOString();
  const insert = () => {
    const lopnr = Number(options.lopnr ?? db.prepare('SELECT coalesce(max(lopnr), 0) + 1 AS value FROM cases').get().value);
    assert(Number.isSafeInteger(lopnr) && lopnr > 0, 'INVALID_LOPNR', 'The ledger sequence number is invalid.');
    const columns = ['lopnr', 'created_at', 'updated_at', ...MUTABLE_COLUMNS];
    const values = [lopnr,
      options.createdAt ? normalizeIso(options.createdAt, 'created_at') : now,
      options.updatedAt ? normalizeIso(options.updatedAt, 'updated_at') : now,
      ...MUTABLE_COLUMNS.map((column) => dbValue(column, normalized[column]))];
    let result;
    if (options.id !== undefined) {
      const id = Number(options.id);
      assert(Number.isSafeInteger(id) && id > 0, 'INVALID_ID', 'The case id is invalid.');
      columns.unshift('id');
      values.unshift(id);
    }
    result = db.prepare(`INSERT INTO cases (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...values);
    return getCase(db, options.id ?? Number(result.lastInsertRowid));
  };
  return options.transaction === false ? insert() : withTransaction(db, insert);
}

export function updateCase(db, id, patch, options = {}) {
  const existing = getCase(db, id);
  const normalized = normalizeCase(db, patch, { ...options, existing, allowInactiveVocabulary: true });
  const updatedAt = options.now ? normalizeIso(options.now, 'updated_at') : new Date().toISOString();
  const assignments = MUTABLE_COLUMNS.map((column) => `${column} = ?`);
  const values = MUTABLE_COLUMNS.map((column) => dbValue(column, normalized[column]));
  db.prepare(`UPDATE cases SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...values, updatedAt, existing.id);
  return getCase(db, existing.id);
}

export function deleteCase(db, id) {
  const existing = getCase(db, id);
  withTransaction(db, () => {
    db.prepare("DELETE FROM notes WHERE entity_type = 'case' AND entity_id = ?").run(existing.id);
    const questions = db.prepare('SELECT id, linked_case_ids FROM spaningsfragor').all();
    const update = db.prepare('UPDATE spaningsfragor SET linked_case_ids = ?, updated_at = ? WHERE id = ?');
    const now = new Date().toISOString();
    for (const question of questions) {
      const ids = parseArray(question.linked_case_ids).map(Number).filter((caseId) => caseId !== existing.id);
      update.run(JSON.stringify(ids), now, question.id);
    }
    db.prepare('DELETE FROM cases WHERE id = ?').run(existing.id);
  });
  return existing;
}

export function buildFtsQuery(query) {
  const tokens = String(query ?? '').normalize('NFKC').match(/[\p{L}\p{N}_/-]+/gu) ?? [];
  return tokens.slice(0, 20).map((token) => `"${token.replaceAll('"', '""')}"*`).join(' AND ');
}

function arrayFilterSql(column, values, clauses, params) {
  const normalized = parseArray(values, { separators: true });
  if (!normalized.length) return;
  clauses.push(`EXISTS (SELECT 1 FROM json_each(c.${column}) item WHERE item.value IN (${normalized.map(() => '?').join(', ')}))`);
  params.push(...normalized);
}

function listWhere(filters = {}) {
  const clauses = [];
  const params = [];
  const fts = buildFtsQuery(filters.q ?? filters.search);
  if (fts) {
    clauses.push('c.id IN (SELECT rowid FROM cases_fts WHERE cases_fts MATCH ?)');
    params.push(fts);
  }
  if (filters.from) { clauses.push('c.time_utc >= ?'); params.push(normalizeIso(filters.from)); }
  if (filters.to) { clauses.push('c.time_utc <= ?'); params.push(normalizeIso(filters.to)); }
  if (filters.status) {
    const values = parseArray(filters.status, { separators: true });
    clauses.push(`c.status IN (${values.map(() => '?').join(', ')})`);
    params.push(...values);
  }
  if (filters.aktor) {
    const values = parseArray(filters.aktor, { separators: true });
    clauses.push(`c.aktor IN (${values.map(() => '?').join(', ')})`);
    params.push(...values);
  }
  arrayFilterSql('begrepp', filters.begrepp, clauses, params);
  arrayFilterSql('tags', filters.tags ?? filters.tag, clauses, params);
  if (filters.star !== undefined && filters.star !== '') { clauses.push('c.star = ?'); params.push(toBoolean(filters.star) ? 1 : 0); }
  if (filters.position_missing !== undefined && filters.position_missing !== '') {
    clauses.push('c.position_missing = ?'); params.push(toBoolean(filters.position_missing) ? 1 : 0);
  }
  if (filters.bbox) {
    const bounds = (Array.isArray(filters.bbox) ? filters.bbox : String(filters.bbox).split(',')).map(Number);
    assert(bounds.length === 4 && bounds.every(Number.isFinite), 'INVALID_BBOX', 'The map extent is invalid.');
    const [minLon, minLat, maxLon, maxLat] = bounds;
    clauses.push('c.lon BETWEEN ? AND ? AND c.lat BETWEEN ? AND ?');
    params.push(minLon, maxLon, minLat, maxLat);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function toBoolean(value) {
  return value === true || value === 1 || ['true', '1', 'yes'].includes(String(value).toLowerCase());
}

export function listCases(db, filters = {}) {
  const { where, params } = listWhere(filters);
  const limit = Math.max(1, Math.min(50_000, Number(filters.limit) || 200));
  const offset = Math.max(0, Number(filters.offset) || 0);
  const sortColumns = new Set(['lopnr', 'created_at', 'updated_at', 'time_utc', 'status', 'star', 'aktor', 'slag', 'place_name']);
  const sort = sortColumns.has(filters.sort) ? filters.sort : 'lopnr';
  const direction = String(filters.direction).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const rows = attachCaseNotes(db, db.prepare(`SELECT c.* FROM cases c ${where} ORDER BY c.${sort} ${direction}, c.id ${direction} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset).map(deserializeCase));
  const total = Number(db.prepare(`SELECT count(*) AS count FROM cases c ${where}`).get(...params).count);
  const result = { rows, total, limit, offset };
  if (filters.group_by) {
    const groupedRows = total === rows.length && offset === 0
      ? rows
      : db.prepare(`SELECT c.* FROM cases c ${where} ORDER BY c.${sort} ${direction}, c.id ${direction}`)
        .all(...params).map(deserializeCase);
    result.groups = groupCases(groupedRows, filters.group_by);
  }
  return result;
}

export function groupCases(rows, groupBy) {
  const groups = new Map();
  for (const row of rows) {
    let keys;
    if (groupBy === 'begrepp') keys = row.begrepp.length ? row.begrepp : [''];
    else if (groupBy === 'tag') keys = row.tags.length ? row.tags : [''];
    else if (groupBy === 'status') keys = [row.status];
    else if (groupBy === 'day') keys = [row.time_utc?.slice(0, 10) ?? ''];
    else if (groupBy === 'mgrs10km') {
      const compact = String(row.mgrs ?? '').replaceAll(' ', '');
      keys = [compact.length >= 7 ? `${compact.slice(0, 5)} ${compact[5]} ${compact[10] ?? compact[6]}` : ''];
    } else throw new AppError('INVALID_GROUP', 'The grouping field is invalid.');
    for (const key of keys) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row.id);
    }
  }
  return [...groups].map(([key, caseIds]) => ({ key, count: caseIds.length, case_ids: caseIds }));
}

export function distinctTags(db, query = '') {
  const normalized = String(query).toLocaleLowerCase('sv-SE');
  return db.prepare('SELECT DISTINCT value AS tag FROM cases, json_each(cases.tags) ORDER BY value').all()
    .map((row) => row.tag)
    .filter((tag) => tag.toLocaleLowerCase('sv-SE').includes(normalized));
}

export function findDuplicates(db, candidate, { excludingId } = {}) {
  const normalized = normalizeCase(db, candidate, { allowInactiveVocabulary: true });
  const clauses = ['time_utc IS ?', 'mgrs IS ?', 'lower(coalesce(slag, \'\')) = lower(coalesce(?, \'\'))'];
  const params = [normalized.time_utc, normalized.mgrs, normalized.slag];
  if (excludingId) { clauses.push('id != ?'); params.push(Number(excludingId)); }
  return db.prepare(`SELECT id, lopnr, time_utc, mgrs, slag FROM cases WHERE ${clauses.join(' AND ')}`).all(...params);
}
