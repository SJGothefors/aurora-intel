import test from 'node:test';
import assert from 'node:assert/strict';
import { createCase, listCases, updateCase } from '../../server/cases.mjs';
import { getSettings, updateVocabularyEntry } from '../../server/entities.mjs';
import { temporaryDatabase } from './helpers.mjs';

test('case search, filters, coordinate repair, and vocabulary rename stay consistent', (t) => {
  const { db } = temporaryDatabase(t);
  const first = createCase(db, {
    dtg_raw: '010632B AUG 26', slag: 'Stridsvagn', sysselsattning: 'Framryckning norrut',
    begrepp: ['STRIDSFORDON'], tags: ['prioriterad'], star: true, aktor: 'Misstänkt främmande',
  });
  createCase(db, { slag: 'Civil lastbil', begrepp: ['LOGISTIK/TRANSPORT'], aktor: 'Civil' });

  const filtered = listCases(db, { q: 'framryckning', begrepp: 'STRIDSFORDON', star: true, limit: 50 });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.rows[0].id, first.id);
  assert.equal(filtered.rows[0].position_missing, true);

  const positioned = updateCase(db, first.id, { lat: 58.3517364424, lon: 15.2109317492 });
  assert.equal(positioned.position_missing, false);
  assert.match(positioned.mgrs, /^33VWE/);
  assert.equal(listCases(db, { bbox: '15,58,16,59' }).total, 1);

  const vocabulary = db.prepare("SELECT id FROM begrepp WHERE name_sv = 'STRIDSFORDON'").get();
  updateVocabularyEntry(db, vocabulary.id, { name_sv: 'PANSARFORDON' });
  assert.deepEqual(listCases(db, { begrepp: 'PANSARFORDON' }).rows[0].begrepp, ['PANSARFORDON']);
  assert.equal(listCases(db, { q: 'pansarfordon' }).total, 1);
});

test('legacy default likelihood labels migrate to the R UND 2022 scale without replacing custom scales', (t) => {
  const { db } = temporaryDatabase(t);
  assert.deepEqual(getSettings(db, {
    likelihoodScale: ['mycket osannolikt', 'osannolikt', 'möjligt', 'sannolikt', 'mycket sannolikt'],
  }).likelihoodScale, ['tveksam', 'möjligen', 'troligen', 'sannolik']);
  assert.deepEqual(getSettings(db, { likelihoodScale: ['låg', 'hög'] }).likelihoodScale, ['låg', 'hög']);
});
