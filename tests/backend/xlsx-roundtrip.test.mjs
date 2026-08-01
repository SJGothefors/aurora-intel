import test from 'node:test';
import assert from 'node:assert/strict';
import { createCase, listCases } from '../../server/cases.mjs';
import {
  createNote, createQuestion, createVocabularyEntry, deleteVocabularyEntry,
} from '../../server/entities.mjs';
import { casesToCsv, csvEscape, exportWorkbook, importDataset, parseWorkbook } from '../../server/transfer.mjs';
import { temporaryDatabase } from './helpers.mjs';

test('XLSX export/import round-trip preserves the complete ledger schema', async (t) => {
  const first = temporaryDatabase(t);
  const created = createCase(first.db, {
    created_by: 'OP TEST', status: 'Uppföljning', star: true,
    tags: ['övning', 'prioriterad'], begrepp: ['STRIDSFORDON'], aktor: 'Misstänkt främmande',
    dtg_raw: '010632B AUG 26', time_utc: '2026-08-01T04:32:00.000Z', time_uncertain: false,
    place_raw: '33VWE 12345 67890', mgrs: '33VWE 12345 67890',
    styrka_raw: '3', count_min: 3, count_max: 3, slag: 'Stridsvagn',
    sysselsattning: 'Framryckning norrut', symbol: 'Vit triangel', sagesman: 'OP KILO',
    kallrapport_raw: 'Fiktiv övningsrapport', ai_json: { source: 'fixture', confidence: 1 },
    bedomning: 'BEDÖMNING: möjligt', fields_uncertain: [],
  }, { now: '2026-08-01T05:00:00.000Z' });
  const question = createQuestion(first.db, {
    question: 'Vilken riktning fortsätter fordonen?', motivering: 'Rörelseriktning saknas efter senaste observationen.',
    prioritet: 'Hög', linked_case_ids: [created.id], forslag_inhamtning: 'Observera nästa vägknut.', created_by: 'AI',
  }, { now: '2026-08-01T05:01:00.000Z' });
  deleteVocabularyEntry(first.db, first.db.prepare("SELECT id FROM begrepp WHERE name_sv = 'FORDON MIL'").get().id);
  deleteVocabularyEntry(first.db, first.db.prepare("SELECT id FROM begrepp WHERE name_sv = 'LUFTFARKOST'").get().id);
  const removedCustom = createVocabularyEntry(first.db, {
    name_sv: 'TILLFÄLLIGT BEGREPP', name_en: 'Temporary term', definition: 'Deleted before the snapshot.', active: true,
  });
  deleteVocabularyEntry(first.db, removedCustom.id);
  const vocabulary = createVocabularyEntry(first.db, {
    name_sv: 'LOKALT GAPPAT BEGREPP', name_en: 'Local gapped term', definition: 'Must retain its non-deterministic id.', active: false,
    sidc: '10031000000000000000', sort: 77,
  });
  assert.equal(vocabulary.id, 20);
  createNote(first.db, { entity_type: 'case', entity_id: created.id, text: 'Följ upp riktningen.' }, { now: '2026-08-01T05:02:00.000Z' });
  createNote(first.db, { entity_type: 'case', entity_id: created.id, text: 'Följ upp riktningen.' }, { now: '2026-08-01T05:02:00.000Z' });
  createNote(first.db, { entity_type: 'spaningsfraga', entity_id: question.id, text: 'Prioriterad fråga.' }, { now: '2026-08-01T05:03:00.000Z' });
  createNote(first.db, { entity_type: 'begrepp', entity_id: vocabulary.id, text: 'Lokalt exempel.' }, { now: '2026-08-01T05:04:00.000Z' });

  const workbook = await exportWorkbook(first.db);
  assert.ok(workbook.subarray(0, 2).equals(Buffer.from('PK')));
  const dataset = await parseWorkbook(workbook);
  assert.equal(dataset.cases.length, 1);
  assert.equal(dataset.spaningsfragor.length, 1);
  assert.equal(dataset.begrepp.length, 17);
  assert.deepEqual(dataset.begrepp.map((row) => row.id).filter((id) => id <= 3), [2]);
  assert.equal(dataset.begrepp.find((row) => row.name_sv === 'LOKALT GAPPAT BEGREPP').id, 20);
  assert.equal(dataset.cases[0].notes_json[0].text, 'Följ upp riktningen.');

  const second = temporaryDatabase(t);
  const report = importDataset(second.db, dataset, { mode: 'replace' });
  assert.equal(report.inserted, 1);
  const actual = listCases(second.db, { limit: 100 }).rows[0];
  const expected = listCases(first.db, { limit: 100 }).rows[0];
  assert.deepEqual(actual, expected);
  const importedQuestion = second.db.prepare('SELECT * FROM spaningsfragor').get();
  assert.equal(importedQuestion.question, 'Vilken riktning fortsätter fordonen?');
  assert.deepEqual(JSON.parse(importedQuestion.linked_case_ids), [created.id]);
  assert.deepEqual(second.db.prepare('SELECT * FROM begrepp ORDER BY id').all(),
    first.db.prepare('SELECT * FROM begrepp ORDER BY id').all());
  assert.equal(second.db.prepare("SELECT entity_id FROM notes WHERE entity_type = 'begrepp'").get().entity_id, 20);
  assert.deepEqual(second.db.prepare('SELECT id, entity_type, entity_id, ts, text FROM notes ORDER BY id').all(),
    first.db.prepare('SELECT id, entity_type, entity_id, ts, text FROM notes ORDER BY id').all());
});

test('CSV exports neutralize spreadsheet formulas in attacker-controlled text', () => {
  for (const value of ['=1+1', '+SUM(1,1)', '-2+3', '@cmd', '  =HYPERLINK("x")']) {
    assert.match(csvEscape(value), /^['"]/);
    assert.ok(csvEscape(value).includes("'"), `expected a neutralizing apostrophe for ${value}`);
  }
  const csv = casesToCsv([{ kallrapport_raw: '=HYPERLINK("file:///secret")' }], { bom: false });
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(!csv.includes(';=HYPERLINK'));
});
