import { AppError, assert } from './errors.mjs';
import { parseArray } from './cases.mjs';
import { withTransaction } from './db.mjs';
import { boundedText, encodeBoundedJson, INPUT_LIMITS } from './validation.mjs';

const LEGACY_LIKELIHOOD_SCALE = Object.freeze(['mycket osannolikt', 'osannolikt', 'möjligt', 'sannolikt', 'mycket sannolikt']);
const R_UND_LIKELIHOOD_SCALE = Object.freeze(['tveksam', 'möjligen', 'troligen', 'sannolik']);
const DEFAULT_SIDC = '10031000000000000000';

function isLegacyLikelihoodScale(value) {
  return Array.isArray(value) && value.length === LEGACY_LIKELIHOOD_SCALE.length
    && value.every((item, index) => String(item).toLocaleLowerCase('sv-SE') === LEGACY_LIKELIHOOD_SCALE[index]);
}

function nowIso(now) {
  if (!now) return new Date().toISOString();
  const candidate = now instanceof Date ? now : boundedText(now, 'timestamp', 128, { required: true });
  const date = new Date(candidate);
  assert(!Number.isNaN(date.valueOf()), 'INVALID_TIME', 'The timestamp is invalid.');
  return date.toISOString();
}

function requiredText(value, field, maxBytes) {
  return boundedText(value, field, maxBytes, { required: true });
}

function bool(value) {
  return value === true || value === 1 || String(value).toLowerCase() === 'true';
}

export function normalizeVocabularyEntry(input, options = {}) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_VOCABULARY', 'The vocabulary payload must be an object.');
  const sort = input.sort === undefined || input.sort === null || input.sort === ''
    ? Number(options.defaultSort ?? 0)
    : Number(input.sort);
  assert(Number.isSafeInteger(sort) && sort >= 0 && sort <= 1_000_000, 'INVALID_SORT', 'The vocabulary sort value is invalid.');
  return {
    name_sv: requiredText(input.name_sv, 'name_sv', INPUT_LIMITS.vocabulary_name),
    name_en: requiredText(input.name_en, 'name_en', INPUT_LIMITS.vocabulary_name),
    definition: boundedText(input.definition ?? '', 'definition', INPUT_LIMITS.vocabulary_definition, { emptyAsNull: false }) ?? '',
    active: input.active === undefined ? true : bool(input.active),
    sidc: boundedText(String(input.sidc ?? '').trim() || DEFAULT_SIDC, 'sidc', INPUT_LIMITS.sidc, { required: true }),
    sort,
  };
}

export function createVocabularyEntry(db, input, options = {}) {
  const defaultSort = Number(db.prepare('SELECT coalesce(max(sort), -1) + 1 value FROM begrepp').get().value);
  const value = normalizeVocabularyEntry(input, { defaultSort });
  const columns = ['name_sv', 'name_en', 'definition', 'active', 'sidc', 'sort'];
  const values = [value.name_sv, value.name_en, value.definition, value.active ? 1 : 0, value.sidc, value.sort];
  if (options.id !== undefined) {
    const id = Number(options.id);
    assert(Number.isSafeInteger(id) && id > 0, 'INVALID_ID', 'The vocabulary id is invalid.');
    columns.unshift('id');
    values.unshift(id);
  }
  const result = db.prepare(`
    INSERT INTO begrepp (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})
  `).run(...values);
  return getVocabularyEntry(db, options.id ?? Number(result.lastInsertRowid));
}

export function getVocabularyEntry(db, id) {
  const row = db.prepare('SELECT * FROM begrepp WHERE id = ?').get(Number(id));
  if (!row) throw new AppError('BEGREPP_NOT_FOUND', 'The vocabulary entry was not found.', { status: 404 });
  return { ...row, active: Boolean(row.active) };
}

export function updateVocabularyEntry(db, id, patch) {
  const existing = getVocabularyEntry(db, id);
  const value = normalizeVocabularyEntry({ ...existing, ...patch });
  const nameSv = value.name_sv;
  withTransaction(db, () => {
    db.prepare(`
      UPDATE begrepp SET name_sv = ?, name_en = ?, definition = ?, active = ?, sidc = ?, sort = ?
      WHERE id = ?
    `).run(
      nameSv,
      value.name_en,
      value.definition,
      value.active ? 1 : 0,
      value.sidc,
      value.sort,
      existing.id,
    );
    if (nameSv !== existing.name_sv) {
      const rows = db.prepare(`SELECT id, begrepp FROM cases WHERE EXISTS (
        SELECT 1 FROM json_each(cases.begrepp) WHERE value = ?
      )`).all(existing.name_sv);
      const updateCaseVocabulary = db.prepare('UPDATE cases SET begrepp = ?, updated_at = ? WHERE id = ?');
      const now = new Date().toISOString();
      for (const row of rows) {
        const names = JSON.parse(row.begrepp).map((name) => name === existing.name_sv ? nameSv : name);
        updateCaseVocabulary.run(JSON.stringify([...new Set(names)]), now, row.id);
      }
    }
  });
  return getVocabularyEntry(db, existing.id);
}

export function deleteVocabularyEntry(db, id) {
  const existing = getVocabularyEntry(db, id);
  const referenced = Number(db.prepare(`
    SELECT count(*) AS count FROM cases c, json_each(c.begrepp) item WHERE item.value = ?
  `).get(existing.name_sv).count);
  if (referenced) {
    throw new AppError('BEGREPP_IN_USE', 'The vocabulary entry is referenced by cases and can only be deactivated.', {
      status: 409, details: { referenced },
    });
  }
  withTransaction(db, () => {
    db.prepare('DELETE FROM notes WHERE entity_type = \'begrepp\' AND entity_id = ?').run(existing.id);
    db.prepare('DELETE FROM begrepp WHERE id = ?').run(existing.id);
  });
  return existing;
}

export function reorderVocabulary(db, ids) {
  const normalized = parseArray(ids, { field: 'ids', maxItems: 5_000, maxItemBytes: 32 }).map(Number);
  assert(normalized.every((id) => Number.isSafeInteger(id) && id > 0), 'INVALID_ORDER', 'The vocabulary order is invalid.');
  const allIds = db.prepare('SELECT id FROM begrepp').all().map((row) => Number(row.id));
  assert(normalized.length === allIds.length && new Set(normalized).size === allIds.length
    && allIds.every((id) => normalized.includes(id)), 'INVALID_ORDER', 'The vocabulary order must contain every entry exactly once.');
  withTransaction(db, () => {
    const update = db.prepare('UPDATE begrepp SET sort = ? WHERE id = ?');
    normalized.forEach((id, index) => update.run(index, id));
  });
  return normalized;
}

const PRIORITIES = new Set(['Hög', 'Medel', 'Låg']);
const QUESTION_STATUSES = new Set(['Föreslagen', 'Aktiv', 'Besvarad', 'Avförd']);

function normalizeLinkedIds(db, value) {
  const ids = [...new Set(parseArray(value, { field: 'linked_case_ids', maxItems: 500, maxItemBytes: 32 }).map(Number))];
  assert(ids.every((id) => Number.isSafeInteger(id) && id > 0), 'INVALID_CASE_IDS', 'One or more linked case ids are invalid.');
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(', ');
    const found = new Set(db.prepare(`SELECT id FROM cases WHERE id IN (${placeholders})`).all(...ids).map((row) => Number(row.id)));
    const missing = ids.filter((id) => !found.has(id));
    assert(!missing.length, 'CASE_NOT_FOUND', 'One or more linked cases were not found.', { details: { missing }, status: 404 });
  }
  return ids;
}

function deserializeQuestion(row) {
  if (!row) return null;
  let linkedCaseIds = [];
  try { linkedCaseIds = JSON.parse(row.linked_case_ids); } catch { /* Legacy row. */ }
  return { ...row, linked_case_ids: linkedCaseIds };
}

export function listQuestions(db, filters = {}) {
  const clauses = [];
  const params = [];
  if (filters.status) { clauses.push('status = ?'); params.push(filters.status); }
  if (filters.prioritet) { clauses.push('prioritet = ?'); params.push(filters.prioritet); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM spaningsfragor ${where} ORDER BY CASE prioritet WHEN 'Hög' THEN 0 WHEN 'Medel' THEN 1 ELSE 2 END, created_at DESC`)
    .all(...params).map(deserializeQuestion);
}

export function getQuestion(db, id) {
  const row = db.prepare('SELECT * FROM spaningsfragor WHERE id = ?').get(Number(id));
  if (!row) throw new AppError('QUESTION_NOT_FOUND', 'The collection question was not found.', { status: 404 });
  return deserializeQuestion(row);
}

export function createQuestion(db, input, options = {}) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_QUESTION', 'The collection-question payload must be an object.');
  const question = requiredText(input.question, 'question', INPUT_LIMITS.question);
  const prioritet = boundedText(input.prioritet ?? 'Medel', 'prioritet', 64, { required: true });
  const status = boundedText(input.status ?? 'Föreslagen', 'status', 64, { required: true });
  const createdBy = boundedText(input.created_by ?? options.createdBy ?? 'user', 'created_by', 64, { required: true });
  assert(PRIORITIES.has(prioritet), 'INVALID_PRIORITY', 'The priority is invalid.');
  assert(QUESTION_STATUSES.has(status), 'INVALID_STATUS', 'The collection-question status is invalid.');
  assert(['AI', 'user'].includes(createdBy), 'INVALID_CREATOR', 'The creator value is invalid.');
  const linked = normalizeLinkedIds(db, input.linked_case_ids ?? []);
  const now = nowIso(options.now);
  const createdAt = options.createdAt ? nowIso(options.createdAt) : now;
  const updatedAt = options.updatedAt ? nowIso(options.updatedAt) : now;
  const columns = ['question', 'motivering', 'prioritet', 'status', 'linked_case_ids', 'forslag_inhamtning', 'created_by', 'created_at', 'updated_at'];
  const values = [question,
    boundedText(input.motivering ?? '', 'motivering', INPUT_LIMITS.question_reason, { emptyAsNull: false }) ?? '',
    prioritet, status, JSON.stringify(linked),
    input.forslag_inhamtning == null ? null : boundedText(input.forslag_inhamtning, 'forslag_inhamtning', INPUT_LIMITS.question_collection),
    createdBy, createdAt, updatedAt];
  if (options.id !== undefined) {
    const id = Number(options.id);
    assert(Number.isSafeInteger(id) && id > 0, 'INVALID_ID', 'The collection-question id is invalid.');
    columns.unshift('id');
    values.unshift(id);
  }
  const result = db.prepare(`INSERT INTO spaningsfragor (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...values);
  return getQuestion(db, options.id ?? Number(result.lastInsertRowid));
}

export function updateQuestion(db, id, patch, options = {}) {
  const existing = getQuestion(db, id);
  const value = { ...existing, ...patch };
  const prioritet = boundedText(value.prioritet, 'prioritet', 64, { required: true });
  const status = boundedText(value.status, 'status', 64, { required: true });
  assert(PRIORITIES.has(prioritet), 'INVALID_PRIORITY', 'The priority is invalid.');
  assert(QUESTION_STATUSES.has(status), 'INVALID_STATUS', 'The collection-question status is invalid.');
  const linked = normalizeLinkedIds(db, value.linked_case_ids);
  db.prepare(`
    UPDATE spaningsfragor SET question = ?, motivering = ?, prioritet = ?, status = ?,
      linked_case_ids = ?, forslag_inhamtning = ?, updated_at = ? WHERE id = ?
  `).run(requiredText(value.question, 'question', INPUT_LIMITS.question),
    boundedText(value.motivering ?? '', 'motivering', INPUT_LIMITS.question_reason, { emptyAsNull: false }) ?? '', prioritet, status,
    JSON.stringify(linked), value.forslag_inhamtning == null ? null : boundedText(value.forslag_inhamtning, 'forslag_inhamtning', INPUT_LIMITS.question_collection),
    nowIso(options.now), existing.id);
  return getQuestion(db, existing.id);
}

export function deleteQuestion(db, id) {
  const existing = getQuestion(db, id);
  withTransaction(db, () => {
    db.prepare("DELETE FROM notes WHERE entity_type = 'spaningsfraga' AND entity_id = ?").run(existing.id);
    db.prepare('DELETE FROM spaningsfragor WHERE id = ?').run(existing.id);
  });
  return existing;
}

function ensureEntity(db, type, id) {
  const numericId = Number(id);
  assert(['case', 'begrepp', 'spaningsfraga'].includes(type), 'INVALID_ENTITY_TYPE', 'The note entity type is invalid.');
  assert(Number.isSafeInteger(numericId) && numericId > 0, 'INVALID_ID', 'The note entity id is invalid.');
  const table = { case: 'cases', begrepp: 'begrepp', spaningsfraga: 'spaningsfragor' }[type];
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(numericId)) {
    throw new AppError('ENTITY_NOT_FOUND', 'The note target was not found.', { status: 404 });
  }
  return numericId;
}

export function listNotes(db, { entity_type: entityType, entity_id: entityId } = {}) {
  if (entityType !== undefined || entityId !== undefined) {
    ensureEntity(db, entityType, entityId);
    return db.prepare('SELECT * FROM notes WHERE entity_type = ? AND entity_id = ? ORDER BY ts, id').all(entityType, Number(entityId));
  }
  return db.prepare('SELECT * FROM notes ORDER BY ts, id').all();
}

export function createNote(db, input, options = {}) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'INVALID_NOTE', 'The note payload must be an object.');
  const entityId = ensureEntity(db, input.entity_type, input.entity_id);
  const columns = ['entity_type', 'entity_id', 'ts', 'text'];
  const values = [input.entity_type, entityId, nowIso(options.ts ?? options.now), requiredText(input.text, 'text', INPUT_LIMITS.note_text)];
  if (options.id !== undefined) {
    const id = Number(options.id);
    assert(Number.isSafeInteger(id) && id > 0, 'INVALID_ID', 'The note id is invalid.');
    columns.unshift('id');
    values.unshift(id);
  }
  const result = db.prepare(`INSERT INTO notes (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...values);
  return db.prepare('SELECT * FROM notes WHERE id = ?').get(options.id ?? Number(result.lastInsertRowid));
}

export function updateNote(db, id, patch) {
  const existing = db.prepare('SELECT * FROM notes WHERE id = ?').get(Number(id));
  if (!existing) throw new AppError('NOTE_NOT_FOUND', 'The note was not found.', { status: 404 });
  assert(patch && typeof patch === 'object' && !Array.isArray(patch), 'INVALID_NOTE', 'The note payload must be an object.');
  db.prepare('UPDATE notes SET text = ? WHERE id = ?').run(requiredText(patch.text, 'text', INPUT_LIMITS.note_text), existing.id);
  return db.prepare('SELECT * FROM notes WHERE id = ?').get(existing.id);
}

export function deleteNote(db, id) {
  const existing = db.prepare('SELECT * FROM notes WHERE id = ?').get(Number(id));
  if (!existing) throw new AppError('NOTE_NOT_FOUND', 'The note was not found.', { status: 404 });
  db.prepare('DELETE FROM notes WHERE id = ?').run(existing.id);
  return existing;
}

export function getSettings(db, defaults = {}) {
  const result = { ...defaults };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    try { result[row.key] = JSON.parse(row.value); } catch { /* Ignore invalid legacy values. */ }
  }
  if (isLegacyLikelihoodScale(result.likelihoodScale)) result.likelihoodScale = [...R_UND_LIKELIHOOD_SCALE];
  return result;
}

export function updateSettings(db, patch, options = {}) {
  assert(patch && typeof patch === 'object' && !Array.isArray(patch), 'INVALID_SETTINGS', 'The settings payload must be an object.');
  const entries = Object.entries(patch);
  assert(entries.length <= 64, 'TOO_MANY_SETTINGS', 'The settings payload contains too many entries.', { status: 413, details: { max_items: 64 } });
  encodeBoundedJson(patch, 'settings', { maxBytes: INPUT_LIMITS.settings_patch, maxContainerItems: 64 });
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const now = nowIso(options.now);
  withTransaction(db, () => {
    for (const [key, value] of entries) {
      assert(/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(key), 'INVALID_SETTING_KEY', 'A setting key is invalid.', { details: { key } });
      upsert.run(key, encodeBoundedJson(value, key, { maxBytes: INPUT_LIMITS.setting_value }), now);
    }
  });
  return getSettings(db, options.defaults);
}
