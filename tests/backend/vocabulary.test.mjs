import test from 'node:test';
import assert from 'node:assert/strict';
import { createCase } from '../../server/cases.mjs';
import { createNote, deleteVocabularyEntry } from '../../server/entities.mjs';
import { postprocessExtraction } from '../../server/ai/postprocess.mjs';
import { temporaryDatabase } from './helpers.mjs';

test('unknown controlled-vocabulary values cannot enter a case', (t) => {
  const { db } = temporaryDatabase(t);
  assert.throws(() => createCase(db, { begrepp: ['INVENTERAT BEGREPP'] }), {
    code: 'INVALID_BEGREPP',
  });
});

test('ÖVRIGT/OKÄNT cannot be deactivated or deleted', (t) => {
  const { db } = temporaryDatabase(t);
  const fallback = db.prepare("SELECT id FROM begrepp WHERE name_sv = 'ÖVRIGT/OKÄNT'").get();
  const note = createNote(db, { entity_type: 'begrepp', entity_id: fallback.id, text: 'Must survive a rejected delete.' });
  assert.throws(() => db.prepare('UPDATE begrepp SET active = 0 WHERE id = ?').run(fallback.id), /VOCABULARY_FALLBACK_REQUIRED/);
  assert.throws(() => db.prepare('DELETE FROM begrepp WHERE id = ?').run(fallback.id), /VOCABULARY_FALLBACK_REQUIRED/);
  assert.throws(() => db.prepare("UPDATE begrepp SET name_sv = 'ANNAT' WHERE id = ?").run(fallback.id), /VOCABULARY_FALLBACK_REQUIRED/);
  assert.throws(() => deleteVocabularyEntry(db, fallback.id), /VOCABULARY_FALLBACK_REQUIRED/);
  assert.equal(db.prepare('SELECT text FROM notes WHERE id = ?').get(note.id).text, note.text);
});

test('AI output drops invented terms, applies fallback and flags the field', () => {
  const result = postprocessExtraction({
    reports: [{
      stunden: { raw: null, iso_utc: null, uncertain: true },
      stallet: { raw: null, mgrs: null, lat: null, lon: null, place_name: null },
      styrkan: { raw: null, count_min: null, count_max: null },
      slaget: null, sysselsattningen: null, symbolen: null, sagesmannen: null,
      begrepp: ['INVENTERAT BEGREPP'], position_missing: true, fields_uncertain: [], summary_sv: '',
    }], reason: null,
  }, { activeVocabulary: ['UAS/DRÖNARE', 'ÖVRIGT/OKÄNT'] });
  assert.deepEqual(result.reports[0].begrepp, ['ÖVRIGT/OKÄNT']);
  assert.ok(result.reports[0].fields_uncertain.includes('begrepp'));
});
