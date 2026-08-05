import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { Worker } from 'node:worker_threads';
import * as XLSXNamespace from 'xlsx';
import { AppError, assert } from './errors.mjs';
import { CASE_COLUMNS, createCase, deserializeCase, findDuplicates, parseArray, updateCase } from './cases.mjs';
import {
  createNote, createQuestion, createVocabularyEntry, normalizeVocabularyEntry,
  updateQuestion,
} from './entities.mjs';
import { listVocabulary } from './vocabulary.mjs';
import { withTransaction } from './db.mjs';
import { boundedText, encodeBoundedJson, INPUT_LIMITS } from './validation.mjs';

const XLSX = XLSXNamespace?.default ?? XLSXNamespace;

export const QUESTION_COLUMNS = Object.freeze([
  'id', 'question', 'motivering', 'prioritet', 'status', 'linked_case_ids',
  'forslag_inhamtning', 'created_by', 'created_at', 'updated_at', 'notes_json',
]);
export const VOCABULARY_COLUMNS = Object.freeze([
  'id', 'name_sv', 'name_en', 'definition', 'active', 'sidc', 'sort', 'notes_json',
]);
export const CASE_EXPORT_COLUMNS = Object.freeze([...CASE_COLUMNS, 'notes_json']);

const JSON_COLUMNS = new Set(['tags', 'begrepp', 'fields_uncertain', 'ai_json', 'linked_case_ids', 'notes_json']);
const BOOLEAN_COLUMNS = new Set(['star', 'time_uncertain', 'position_missing', 'active']);
const MAX_IMPORT_BYTES = 16 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 2048;
const MAX_ARCHIVE_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_IMPORT_ROWS = 20_000;
const MAX_IMPORT_COLUMNS = 128;
const MAX_IMPORT_CELLS = 500_000;
const MAX_CELL_CHARACTERS = 250_000;
const MEANINGFUL_CASE_COLUMNS = new Set([
  'source_report_id', 'dtg_raw', 'time_utc', 'place_raw', 'place_name', 'mgrs', 'lat', 'lon', 'styrka_raw',
  'count_min', 'count_max', 'slag', 'sysselsattning', 'symbol', 'sagesman',
  'kallrapport_raw', 'begrepp', 'tags', 'bedomning',
]);

function cellValue(column, value) {
  if (value === null || value === undefined) return null;
  if (JSON_COLUMNS.has(column)) return JSON.stringify(value);
  if (BOOLEAN_COLUMNS.has(column)) return value ? 1 : 0;
  return value;
}

function decodeCell(column, value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('result' in value) value = value.result;
    else if ('text' in value) value = value.text;
    else if ('richText' in value) value = value.richText.map((part) => part.text).join('');
    else if ('hyperlink' in value) value = value.text ?? value.hyperlink;
  }
  if (JSON_COLUMNS.has(column)) {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return parseArray(value, { separators: true }); }
  }
  if (BOOLEAN_COLUMNS.has(column)) return value === true || value === 1 || String(value).toLowerCase() === 'true';
  return value;
}

function rowsForCases(db, caseIds) {
  let rows;
  if (!caseIds?.length) rows = db.prepare('SELECT * FROM cases ORDER BY lopnr').all().map(deserializeCase);
  else {
    const ids = [...new Set(caseIds.map(Number))];
    assert(ids.every((id) => Number.isSafeInteger(id) && id > 0), 'INVALID_CASE_IDS', 'One or more export case ids are invalid.');
    rows = [];
    for (let offset = 0; offset < ids.length; offset += 500) {
      const chunk = ids.slice(offset, offset + 500);
      rows.push(...db.prepare(`SELECT * FROM cases WHERE id IN (${chunk.map(() => '?').join(', ')})`).all(...chunk).map(deserializeCase));
    }
    rows.sort((left, right) => Number(left.lopnr) - Number(right.lopnr));
  }
  return attachNotes(db, rows, 'case');
}

function attachNotes(db, rows, entityType) {
  if (!rows.length) return rows.map((row) => ({ ...row, notes_json: [] }));
  const ids = rows.map((row) => Number(row.id));
  const notes = [];
  for (let offset = 0; offset < ids.length; offset += 500) {
    const chunk = ids.slice(offset, offset + 500);
    notes.push(...db.prepare(`SELECT * FROM notes WHERE entity_type = ? AND entity_id IN (${chunk.map(() => '?').join(', ')}) ORDER BY ts, id`)
      .all(entityType, ...chunk));
  }
  notes.sort((left, right) => left.ts.localeCompare(right.ts) || Number(left.id) - Number(right.id));
  const grouped = new Map(ids.map((id) => [id, []]));
  for (const note of notes) grouped.get(Number(note.entity_id))?.push(note);
  return rows.map((row) => ({ ...row, notes_json: grouped.get(Number(row.id)) ?? [] }));
}

export function csvEscape(value, delimiter = ';') {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[\u0000-\u0020]*[=+\-@]/u.test(text)) text = `'${text}`;
  return /["\r\n]/.test(text) || text.includes(delimiter) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function casesToCsv(cases, { delimiter = ';', bom = true } = {}) {
  assert([',', ';', '\t'].includes(delimiter), 'INVALID_DELIMITER', 'The CSV delimiter is invalid.');
  const lines = [CASE_EXPORT_COLUMNS.map((column) => csvEscape(column, delimiter)).join(delimiter)];
  for (const row of cases) {
    lines.push(CASE_EXPORT_COLUMNS.map((column) => csvEscape(cellValue(column, row[column]), delimiter)).join(delimiter));
  }
  return `${bom ? '\uFEFF' : ''}${lines.join('\r\n')}\r\n`;
}

export function exportCasesCsv(db, options = {}) {
  return casesToCsv(rowsForCases(db, options.caseIds), options);
}

function detectDelimiter(text) {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((delimiter) => [delimiter, firstLine.split(delimiter).length]);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

export function parseCsv(input, options = {}) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);
  assert(Buffer.byteLength(text, 'utf8') <= MAX_IMPORT_BYTES, 'IMPORT_TOO_LARGE', 'The import file exceeds the size limit.', { status: 413 });
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let cells = 0;
  const appendField = () => {
    assert(field.length <= MAX_CELL_CHARACTERS, 'IMPORT_CELL_TOO_LARGE', 'An import cell exceeds the size limit.', { status: 413 });
    assert(row.length < MAX_IMPORT_COLUMNS, 'IMPORT_TOO_MANY_COLUMNS', 'The import has too many columns.', { status: 413 });
    row.push(field);
    field = '';
    cells += 1;
    assert(cells <= MAX_IMPORT_CELLS, 'IMPORT_TOO_MANY_CELLS', 'The import has too many cells.', { status: 413 });
  };
  const appendRow = () => {
    if (row.some((value) => value !== '')) rows.push(row);
    row = [];
    assert(rows.length <= MAX_IMPORT_ROWS + 1, 'IMPORT_TOO_MANY_ROWS', 'The import has too many rows.', { status: 413 });
  };
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field === '') quoted = true;
    else if (character === delimiter) appendField();
    else if (character === '\n') {
      field = field.replace(/\r$/, '');
      appendField();
      appendRow();
    } else {
      field += character;
      assert(field.length <= MAX_CELL_CHARACTERS, 'IMPORT_CELL_TOO_LARGE', 'An import cell exceeds the size limit.', { status: 413 });
    }
  }
  if (field || row.length) { appendField(); appendRow(); }
  assert(!quoted, 'INVALID_CSV', 'The CSV file contains an unterminated quoted field.');
  if (!rows.length) return [];
  const headers = rows.shift().map((header) => header.trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, decodeCell(header, values[index] ?? '')])));
}

function addSheet(workbook, name, columns, rows) {
  const data = rows.map((row) => Object.fromEntries(columns.map((column) => [column, cellValue(column, row[column])])));
  const worksheet = XLSX.utils.json_to_sheet(data, { header: columns, skipHeader: false });
  worksheet['!cols'] = columns.map((key) => ({ wch: Math.min(60, Math.max(12, key.length + 2)) }));
  worksheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(columns.length - 1)}1` };
  XLSX.utils.book_append_sheet(workbook, worksheet, name);
  return worksheet;
}

export async function exportWorkbook(db, options = {}) {
  const workbook = XLSX.utils.book_new();
  workbook.Props = { Author: 'Aurora Intel', CreatedDate: new Date(0), ModifiedDate: new Date(0) };
  addSheet(workbook, 'Liggare', CASE_EXPORT_COLUMNS, rowsForCases(db, options.caseIds));
  const questions = attachNotes(db, db.prepare('SELECT * FROM spaningsfragor ORDER BY id').all().map((row) => ({
    ...row,
    linked_case_ids: JSON.parse(row.linked_case_ids),
  })), 'spaningsfraga');
  addSheet(workbook, 'Spaningsfrågor', QUESTION_COLUMNS, questions);
  addSheet(workbook, 'Begrepp', VOCABULARY_COLUMNS, attachNotes(db, listVocabulary(db), 'begrepp'));
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true }));
}

function worksheetRows(worksheet, expectedColumns) {
  if (!worksheet) return undefined;
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: null, raw: true });
  const known = new Set(expectedColumns);
  return rows.map((row) => Object.fromEntries(Object.entries(row)
    .filter(([key]) => known.has(key))
    .map(([key, value]) => [key, decodeCell(key, value)])));
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

export function validateWorkbookArchive(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  assert(buffer.length <= MAX_IMPORT_BYTES, 'IMPORT_TOO_LARGE', 'The import file exceeds the size limit.', { status: 413 });
  const end = findEndOfCentralDirectory(buffer);
  assert(end >= 0, 'INVALID_WORKBOOK', 'The workbook ZIP directory is missing.');
  const commentLength = buffer.readUInt16LE(end + 20);
  assert(end + 22 + commentLength === buffer.length, 'INVALID_WORKBOOK', 'The workbook ZIP footer is invalid.');
  const disk = buffer.readUInt16LE(end + 4);
  const centralDisk = buffer.readUInt16LE(end + 6);
  const entriesOnDisk = buffer.readUInt16LE(end + 8);
  const entries = buffer.readUInt16LE(end + 10);
  const centralSize = buffer.readUInt32LE(end + 12);
  const centralOffset = buffer.readUInt32LE(end + 16);
  assert(disk === 0 && centralDisk === 0 && entriesOnDisk === entries, 'INVALID_WORKBOOK', 'Split workbook archives are not supported.');
  assert(entries !== 0xffff && centralSize !== 0xffffffff && centralOffset !== 0xffffffff,
    'INVALID_WORKBOOK', 'ZIP64 workbook imports are not supported.');
  assert(entries > 0 && entries <= MAX_ARCHIVE_ENTRIES, 'IMPORT_TOO_MANY_ARCHIVE_ENTRIES', 'The workbook contains too many archive entries.', { status: 413 });
  assert(centralOffset + centralSize <= end, 'INVALID_WORKBOOK', 'The workbook ZIP directory is invalid.');

  let cursor = centralOffset;
  let totalExpanded = 0;
  for (let index = 0; index < entries; index += 1) {
    assert(cursor + 46 <= end && buffer.readUInt32LE(cursor) === 0x02014b50, 'INVALID_WORKBOOK', 'A workbook ZIP entry is invalid.');
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const declaredSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    assert((flags & 0x41) === 0, 'INVALID_WORKBOOK', 'Encrypted workbook entries are not supported.');
    assert(method === 0 || method === 8, 'INVALID_WORKBOOK', 'The workbook uses an unsupported compression method.');
    assert(declaredSize <= MAX_ARCHIVE_ENTRY_BYTES, 'IMPORT_ARCHIVE_ENTRY_TOO_LARGE', 'A workbook archive entry exceeds the size limit.', { status: 413 });
    assert(localOffset + 30 <= centralOffset && buffer.readUInt32LE(localOffset) === 0x04034b50, 'INVALID_WORKBOOK', 'A workbook local ZIP entry is invalid.');
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    assert(dataOffset + compressedSize <= centralOffset, 'INVALID_WORKBOOK', 'A workbook ZIP entry exceeds the archive bounds.');
    let actualSize;
    if (method === 0) actualSize = compressedSize;
    else {
      try {
        actualSize = inflateRawSync(buffer.subarray(dataOffset, dataOffset + compressedSize), {
          maxOutputLength: MAX_ARCHIVE_ENTRY_BYTES + 1,
        }).length;
      } catch (error) {
        throw new AppError('INVALID_WORKBOOK', 'A workbook entry could not be decompressed safely.', { status: 413, cause: error });
      }
    }
    assert(actualSize === declaredSize, 'INVALID_WORKBOOK', 'A workbook ZIP entry size is inconsistent.');
    totalExpanded += actualSize;
    assert(totalExpanded <= MAX_ARCHIVE_TOTAL_BYTES, 'IMPORT_ARCHIVE_TOO_LARGE', 'The expanded workbook exceeds the size limit.', { status: 413 });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  assert(cursor === centralOffset + centralSize, 'INVALID_WORKBOOK', 'The workbook ZIP directory length is inconsistent.');
  return { entries, expandedBytes: totalExpanded };
}

function validateWorksheetBounds(worksheet, name) {
  if (!worksheet) return 0;
  const reference = worksheet['!fullref'] ?? worksheet['!ref'];
  if (!reference) return 0;
  let range;
  try { range = XLSX.utils.decode_range(reference); }
  catch (error) { throw new AppError('INVALID_WORKBOOK', `The ${name} worksheet range is invalid.`, { cause: error }); }
  const rows = range.e.r - range.s.r + 1;
  const columns = range.e.c - range.s.c + 1;
  assert(rows <= MAX_IMPORT_ROWS + 1, 'IMPORT_TOO_MANY_ROWS', `The ${name} worksheet has too many rows.`, { status: 413 });
  assert(columns <= MAX_IMPORT_COLUMNS, 'IMPORT_TOO_MANY_COLUMNS', `The ${name} worksheet has too many columns.`, { status: 413 });
  const cells = rows * columns;
  assert(cells <= MAX_IMPORT_CELLS, 'IMPORT_TOO_MANY_CELLS', `The ${name} worksheet range is too large.`, { status: 413 });
  for (const [address, cell] of Object.entries(worksheet)) {
    if (address.startsWith('!')) continue;
    if (typeof cell?.v === 'string') assert(cell.v.length <= MAX_CELL_CHARACTERS,
      'IMPORT_CELL_TOO_LARGE', `A cell in ${name} exceeds the size limit.`, { status: 413 });
  }
  return cells;
}

export function parseWorkbookInProcess(buffer) {
  validateWorkbookArchive(buffer);
  let workbook;
  try {
    workbook = XLSX.read(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer), {
      type: 'buffer', raw: true, cellDates: false, sheetRows: MAX_IMPORT_ROWS + 1,
    });
  } catch (error) {
    throw new AppError('INVALID_WORKBOOK', 'The workbook could not be read.', { cause: error });
  }
  assert(workbook.SheetNames.length <= 16, 'IMPORT_TOO_MANY_SHEETS', 'The workbook contains too many worksheets.', { status: 413 });
  let cells = 0;
  for (const name of workbook.SheetNames) cells += validateWorksheetBounds(workbook.Sheets[name], name);
  assert(cells <= MAX_IMPORT_CELLS, 'IMPORT_TOO_MANY_CELLS', 'The workbook contains too many cells.', { status: 413 });
  const cases = worksheetRows(workbook.Sheets.Liggare, CASE_EXPORT_COLUMNS);
  assert(cases, 'INVALID_WORKBOOK', 'The workbook does not contain a Liggare sheet.');
  return {
    cases,
    spaningsfragor: worksheetRows(workbook.Sheets['Spaningsfrågor'], QUESTION_COLUMNS),
    begrepp: worksheetRows(workbook.Sheets.Begrepp, VOCABULARY_COLUMNS),
  };
}

function parseInWorker(kind, input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  assert(buffer.length <= MAX_IMPORT_BYTES, 'IMPORT_TOO_LARGE', 'The import file exceeds the size limit.', { status: 413 });
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./import-worker.mjs', import.meta.url), {
      workerData: { kind, buffer },
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 64, stackSizeMb: 4 },
    });
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      void worker.terminate();
      finish(() => reject(new AppError('IMPORT_TIMEOUT', 'The import parser exceeded its time limit.', { status: 408 })));
    }, 15_000);
    timer.unref?.();
    worker.once('message', (message) => finish(() => {
      if (message?.ok) {
        try { resolve(validateImportDataset(message.dataset)); }
        catch (error) { reject(error); }
      } else reject(new AppError(message?.error?.code ?? 'INVALID_IMPORT', message?.error?.message ?? 'The import could not be parsed.', {
        status: message?.error?.status ?? 400, details: message?.error?.details,
      }));
    }));
    worker.once('error', (error) => finish(() => reject(new AppError('INVALID_IMPORT', 'The isolated import parser failed.', { cause: error }))));
    worker.once('exit', () => {
      if (!settled) finish(() => reject(new AppError('INVALID_IMPORT', 'The isolated import parser exited without a result.')));
    });
  });
}

export async function parseWorkbook(buffer) {
  return parseInWorker('xlsx', buffer);
}

export async function parseImport(buffer, filename = '') {
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.csv' || extension === '.txt') return parseInWorker('csv', buffer);
  if (extension === '.xlsx' || Buffer.from(buffer).subarray(0, 2).toString() === 'PK') return parseWorkbook(buffer);
  throw new AppError('UNSUPPORTED_IMPORT', 'The import file type is not supported.');
}

export function validateImportDataset(dataset) {
  assert(dataset && typeof dataset === 'object' && !Array.isArray(dataset), 'INVALID_IMPORT', 'The import dataset must be an object.');
  let rows = 0;
  let cells = 0;
  for (const key of ['cases', 'spaningsfragor', 'begrepp']) {
    const value = dataset[key];
    assert(value === undefined || Array.isArray(value), 'INVALID_IMPORT', `${key} must be an array.`);
    if (key === 'begrepp' && value) {
      assert(value.length <= 5_000, 'TOO_MANY_VOCABULARY_ENTRIES', 'The vocabulary import contains too many entries.', { status: 413, details: { max_items: 5_000 } });
    }
    rows += value?.length ?? 0;
    for (const [index, row] of (value ?? []).entries()) {
      assert(row && typeof row === 'object' && !Array.isArray(row), 'INVALID_IMPORT_ROW', `A row in ${key} is invalid.`, { details: { sheet: key, row: index + 2 } });
      const entries = Object.entries(row);
      assert(entries.length <= MAX_IMPORT_COLUMNS, 'IMPORT_TOO_MANY_COLUMNS', `A row in ${key} has too many columns.`, { status: 413 });
      cells += entries.length;
      assert(cells <= MAX_IMPORT_CELLS, 'IMPORT_TOO_MANY_CELLS', 'The import has too many populated cells.', { status: 413 });
      for (const [column, cell] of entries) {
        assert(column.length <= 512, 'IMPORT_HEADER_TOO_LARGE', 'An import column name exceeds the size limit.', { status: 413 });
        if (typeof cell === 'string') {
          assert(cell.length <= MAX_CELL_CHARACTERS, 'IMPORT_CELL_TOO_LARGE', 'An import cell exceeds the size limit.', { status: 413 });
        } else if (cell && typeof cell === 'object') {
          encodeBoundedJson(cell, `${key}.${column}`, { maxBytes: MAX_CELL_CHARACTERS * 4, maxNodes: 20_000 });
        }
      }
    }
  }
  assert(rows > 0, 'EMPTY_IMPORT', 'The import dataset is empty.');
  assert(rows <= MAX_IMPORT_ROWS, 'IMPORT_TOO_MANY_ROWS', 'The import has too many rows.', { status: 413 });
  return dataset;
}

function hasMeaningfulCaseValue(row) {
  return [...MEANINGFUL_CASE_COLUMNS].some((column) => {
    const value = row[column];
    return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && String(value).trim() !== '';
  });
}

export function previewImport(db, dataset, mapping = {}) {
  validateImportDataset(dataset);
  const headers = [...new Set((dataset.cases ?? []).flatMap((row) => Object.keys(row)))];
  const mappingEntries = Object.entries(mapping).filter(([, source]) => typeof source === 'string' && source.trim());
  if (mappingEntries.length) {
    assert(mappingEntries.every(([target, source]) => CASE_EXPORT_COLUMNS.includes(target) && headers.includes(source)),
      'INVALID_IMPORT_MAPPING', 'The import mapping contains an unknown target or source column.');
    assert(mappingEntries.some(([target, source]) => MEANINGFUL_CASE_COLUMNS.has(target) && source),
      'EMPTY_IMPORT_MAPPING', 'Map at least one meaningful case field before applying the import.');
  }
  const mapped = (dataset.cases ?? []).map((source) => {
    if (!mappingEntries.length) return source;
    return Object.fromEntries(mappingEntries.map(([target, sourceHeader]) => [target, source[sourceHeader]]));
  });
  const duplicates = [];
  const errors = [];
  mapped.forEach((row, index) => {
    try {
      assert(hasMeaningfulCaseValue(row), 'NO_RECOGNIZED_CASE_FIELDS', 'The row does not contain a recognized case field.');
      const matches = findDuplicates(db, row);
      if (matches.length) duplicates.push({ row: index + 2, matches });
    } catch (error) {
      errors.push({ row: index + 2, code: error.code ?? 'INVALID_ROW', message: error.message });
    }
  });
  return {
    headers,
    auto_mapping: Object.fromEntries(CASE_EXPORT_COLUMNS.map((column) => [column, column])),
    counts: {
      cases: dataset.cases?.length ?? 0,
      spaningsfragor: dataset.spaningsfragor?.length ?? 0,
      begrepp: dataset.begrepp?.length ?? 0,
    },
    duplicates,
    errors,
    can_apply: errors.length === 0 && ((dataset.cases?.length ?? 0) > 0 || (dataset.spaningsfragor?.length ?? 0) > 0 || (dataset.begrepp?.length ?? 0) > 0),
  };
}

function upsertVocabulary(db, rows) {
  if (!rows) return;
  for (const row of rows) {
    const value = normalizeVocabularyEntry({ ...row, name_en: row.name_en ?? row.name_sv });
    const existing = db.prepare('SELECT id FROM begrepp WHERE name_sv = ? COLLATE NOCASE').get(value.name_sv);
    if (existing) {
      db.prepare('UPDATE begrepp SET name_sv = ?, name_en = ?, definition = ?, active = ?, sidc = ?, sort = ? WHERE id = ?')
        .run(value.name_sv, value.name_en, value.definition, value.active ? 1 : 0, value.sidc, value.sort, Number(existing.id));
    } else createVocabularyEntry(db, value);
  }
}

function replaceVocabularyExact(db, rows) {
  if (rows === undefined) return;
  assert(Array.isArray(rows) && rows.length > 0, 'INVALID_VOCABULARY_IMPORT', 'An exact replacement must include the controlled vocabulary.');
  const normalized = rows.map((row) => {
    assert(row && typeof row === 'object' && !Array.isArray(row), 'INVALID_VOCABULARY_IMPORT', 'A vocabulary row is invalid.');
    const id = Number(row.id);
    assert(Number.isSafeInteger(id) && id > 0, 'INVALID_ID', 'An exact vocabulary row must have a positive integer id.');
    return { id, ...normalizeVocabularyEntry({ ...row, name_en: row.name_en ?? row.name_sv }) };
  });
  assert(new Set(normalized.map((row) => row.id)).size === normalized.length,
    'DUPLICATE_VOCABULARY_ID', 'The exact vocabulary snapshot contains duplicate ids.');
  assert(new Set(normalized.map((row) => row.name_sv.toLocaleUpperCase('sv-SE'))).size === normalized.length,
    'DUPLICATE_VOCABULARY_NAME', 'The exact vocabulary snapshot contains duplicate names.');
  const fallbackRows = normalized.filter((row) => row.name_sv.toLocaleUpperCase('sv-SE') === 'ÖVRIGT/OKÄNT');
  assert(fallbackRows.length === 1 && fallbackRows[0].active,
    'VOCABULARY_FALLBACK_REQUIRED', 'The exact vocabulary snapshot must contain one active ÖVRIGT/OKÄNT entry.');

  const fallback = fallbackRows[0];
  db.prepare("DELETE FROM begrepp WHERE upper(name_sv) != 'ÖVRIGT/OKÄNT'").run();
  const existingFallback = db.prepare("SELECT id FROM begrepp WHERE upper(name_sv) = 'ÖVRIGT/OKÄNT'").get();
  assert(existingFallback, 'VOCABULARY_FALLBACK_REQUIRED', 'The database vocabulary fallback is missing.');
  db.prepare(`UPDATE begrepp SET id = ?, name_sv = ?, name_en = ?, definition = ?, active = 1, sidc = ?, sort = ? WHERE id = ?`)
    .run(fallback.id, fallback.name_sv, fallback.name_en, fallback.definition, fallback.sidc, fallback.sort, Number(existingFallback.id));
  for (const row of normalized) {
    if (row.id === fallback.id) continue;
    createVocabularyEntry(db, row, { id: row.id });
  }
}

function restoreNotes(db, entityType, entityId, value, { preserveIds = false } = {}) {
  if (value === null || value === undefined) return;
  assert(Array.isArray(value), 'INVALID_NOTES', 'Imported notes must be a JSON array.');
  assert(value.length <= 1_000, 'TOO_MANY_NOTES', 'An imported entity contains too many notes.', { status: 413, details: { max_items: 1_000 } });
  const notes = value;
  for (const note of notes) {
    assert(note && typeof note === 'object' && !Array.isArray(note), 'INVALID_NOTE', 'An imported note is invalid.');
    const rawTimestamp = note.ts ?? new Date().toISOString();
    const timestampValue = boundedText(rawTimestamp, 'ts', 128, { required: true });
    const timestamp = new Date(timestampValue);
    assert(!Number.isNaN(timestamp.valueOf()), 'INVALID_TIME', 'An imported note timestamp is invalid.');
    const ts = timestamp.toISOString();
    const text = boundedText(note.text, 'text', INPUT_LIMITS.note_text, { required: true });
    if (!preserveIds) {
      const duplicate = db.prepare('SELECT 1 FROM notes WHERE entity_type = ? AND entity_id = ? AND ts = ? AND text = ?')
        .get(entityType, entityId, ts, text);
      if (duplicate) continue;
    }
    let id;
    if (preserveIds) {
      id = Number(note.id);
      assert(Number.isSafeInteger(id) && id > 0, 'INVALID_ID', 'An exact note row must have a positive integer id.');
      assert(!db.prepare('SELECT 1 FROM notes WHERE id = ?').get(id), 'DUPLICATE_NOTE_ID', 'The exact snapshot contains duplicate note ids.');
    }
    createNote(db, { entity_type: entityType, entity_id: entityId, text }, { ts, ...(id ? { id } : {}) });
  }
}

export function importDataset(db, dataset, options = {}) {
  validateImportDataset(dataset);
  const mode = options.mode ?? 'append';
  assert(['append', 'merge', 'replace'].includes(mode), 'INVALID_IMPORT_MODE', 'The import mode is invalid.');
  const report = { inserted: 0, updated: 0, skipped: 0, questions: 0, vocabulary: 0 };
  const caseIdMap = new Map();
  withTransaction(db, () => {
    if (mode === 'replace') {
      db.prepare('DELETE FROM notes').run();
      db.prepare('DELETE FROM spaningsfragor').run();
      db.prepare('DELETE FROM cases').run();
      replaceVocabularyExact(db, dataset.begrepp);
      report.vocabulary = dataset.begrepp?.length ?? 0;
    }

    for (const row of dataset.cases ?? []) {
      const duplicates = mode === 'merge' ? findDuplicates(db, row) : [];
      if (duplicates.length) {
        const updated = updateCase(db, duplicates[0].id, row, { allowInactiveVocabulary: true });
        if (row.id) caseIdMap.set(Number(row.id), updated.id);
        restoreNotes(db, 'case', updated.id, row.notes_json);
        report.updated += 1;
        continue;
      }
      const preserve = mode === 'replace';
      const created = createCase(db, row, {
        transaction: false,
        allowInactiveVocabulary: true,
        ...(preserve && row.id ? { id: Number(row.id) } : {}),
        ...(preserve && row.lopnr ? { lopnr: Number(row.lopnr) } : {}),
        ...(preserve && row.created_at ? { createdAt: row.created_at } : {}),
        ...(preserve && row.updated_at ? { updatedAt: row.updated_at } : {}),
      });
      if (row.id) caseIdMap.set(Number(row.id), created.id);
      restoreNotes(db, 'case', created.id, row.notes_json, { preserveIds: preserve });
      report.inserted += 1;
    }

    if (dataset.spaningsfragor) {
      for (const row of dataset.spaningsfragor) {
        const mappedCaseIds = parseArray(row.linked_case_ids, { field: 'linked_case_ids', maxItems: 500, maxItemBytes: 32 })
          .map(Number).map((id) => caseIdMap.get(id) ?? id);
        const linkedCaseIds = mode === 'replace'
          ? mappedCaseIds
          : mappedCaseIds.filter((id) => db.prepare('SELECT 1 FROM cases WHERE id = ?').get(id));
        if (mode === 'merge' && row.id && db.prepare('SELECT 1 FROM spaningsfragor WHERE id = ?').get(Number(row.id))) {
          const updated = updateQuestion(db, Number(row.id), { ...row, linked_case_ids: linkedCaseIds });
          restoreNotes(db, 'spaningsfraga', updated.id, row.notes_json);
          report.questions += 1;
          continue;
        }
        const created = createQuestion(db, { ...row, linked_case_ids: linkedCaseIds }, {
          ...(mode === 'replace' ? { id: row.id } : {}),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
        const questionId = created.id;
        restoreNotes(db, 'spaningsfraga', questionId, row.notes_json, { preserveIds: mode === 'replace' });
        report.questions += 1;
      }
    }

    if (mode !== 'replace' && dataset.begrepp) {
      upsertVocabulary(db, dataset.begrepp);
      report.vocabulary = dataset.begrepp.length;
    }
    for (const row of dataset.begrepp ?? []) {
      const entry = db.prepare('SELECT id FROM begrepp WHERE name_sv = ? COLLATE NOCASE').get(row.name_sv);
      if (entry) restoreNotes(db, 'begrepp', Number(entry.id), row.notes_json, { preserveIds: mode === 'replace' });
    }
  });
  return report;
}

export function writeAtomic(filename, data) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(descriptor, data);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filename);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch { /* Nothing to clean up. */ }
    throw error;
  }
}

export function refreshCsvMirror(db, paths) {
  const filename = path.join(paths.mirrorDir, 'liggare.csv');
  writeAtomic(filename, exportCasesCsv(db, { delimiter: ';', bom: true }));
  return filename;
}

export async function writeWorkbook(db, filename, options = {}) {
  writeAtomic(filename, await exportWorkbook(db, options));
  return filename;
}
