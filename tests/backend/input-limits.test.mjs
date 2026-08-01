import test from 'node:test';
import assert from 'node:assert/strict';
import { createCase } from '../../server/cases.mjs';
import {
  createNote, createQuestion, createVocabularyEntry, updateSettings,
} from '../../server/entities.mjs';
import { exportWorkbook, importDataset, parseImport, parseWorkbook } from '../../server/transfer.mjs';
import { INPUT_LIMITS } from '../../server/validation.mjs';
import { temporaryDatabase } from './helpers.mjs';

test('DB and FTS-backed entity fields enforce per-field, item, and JSON limits', (t) => {
  const { db } = temporaryDatabase(t);
  const existing = createCase(db, { slag: 'Fixture' });

  assert.throws(() => createCase(db, {
    kallrapport_raw: 'x'.repeat(INPUT_LIMITS.case.kallrapport_raw + 1),
  }), { code: 'FIELD_TOO_LARGE', status: 413 });
  assert.throws(() => createCase(db, {
    tags: Array.from({ length: 65 }, (_value, index) => `tag-${index}`),
  }), { code: 'TOO_MANY_ITEMS', status: 413 });
  assert.throws(() => createCase(db, {
    ai_json: { blob: 'x'.repeat(INPUT_LIMITS.case.ai_json) },
  }), { code: 'JSON_TOO_LARGE', status: 413 });

  assert.throws(() => createNote(db, {
    entity_type: 'case', entity_id: existing.id, text: 'x'.repeat(INPUT_LIMITS.note_text + 1),
  }), { code: 'FIELD_TOO_LARGE', status: 413 });
  assert.throws(() => createQuestion(db, {
    question: 'x'.repeat(INPUT_LIMITS.question + 1),
  }), { code: 'FIELD_TOO_LARGE', status: 413 });
  assert.throws(() => createVocabularyEntry(db, {
    name_sv: 'x'.repeat(INPUT_LIMITS.vocabulary_name + 1), name_en: 'oversized',
  }), { code: 'FIELD_TOO_LARGE', status: 413 });

  assert.throws(() => updateSettings(db, {
    oversized: 'x'.repeat(INPUT_LIMITS.setting_value + 1),
  }), { code: 'JSON_TOO_LARGE', status: 413 });
  assert.throws(() => updateSettings(db,
    Object.fromEntries(Array.from({ length: 65 }, (_value, index) => [`key${index}`, index]))),
  { code: 'TOO_MANY_SETTINGS', status: 413 });

  assert.equal(db.prepare('SELECT count(*) AS count FROM cases').get().count, 1);
  assert.equal(db.prepare('SELECT count(*) AS count FROM notes').get().count, 0);
  assert.equal(db.prepare('SELECT count(*) AS count FROM spaningsfragor').get().count, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM begrepp WHERE name_sv = 'oversized'").get().count, 0);
});

test('imports cannot bypass entity field limits and roll back atomically', (t) => {
  const { db } = temporaryDatabase(t);
  const before = Number(db.prepare('SELECT count(*) AS count FROM cases').get().count);
  assert.throws(() => importDataset(db, {
    cases: [
      { slag: 'Valid row' },
      { slag: 'x'.repeat(INPUT_LIMITS.case.slag + 1) },
    ],
  }, { mode: 'append' }), { code: 'FIELD_TOO_LARGE', status: 413 });
  assert.equal(Number(db.prepare('SELECT count(*) AS count FROM cases').get().count), before);
});

test('isolated import parsing enforces cell limits and an exact ZIP footer', async (t) => {
  const { db } = temporaryDatabase(t);
  await assert.rejects(() => parseImport(Buffer.from(`slag\n${'x'.repeat(250_001)}\n`), 'oversized.csv'), {
    code: 'IMPORT_CELL_TOO_LARGE', status: 413,
  });

  const workbook = await exportWorkbook(db);
  await assert.rejects(() => parseWorkbook(Buffer.concat([workbook, Buffer.from([0])])), {
    code: 'INVALID_WORKBOOK',
  });
});
