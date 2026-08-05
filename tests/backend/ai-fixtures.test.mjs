import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { AIService } from '../../server/ai/service.mjs';
import { postprocessExtraction } from '../../server/ai/postprocess.mjs';
import { temporaryDatabase } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'extractions.json'), 'utf8'));
const inputs = [
  '7S\nSTUNDEN: 010632B AUG 26\nSTÄLLET: 33VWE 12345 67890',
  'Vakthavande rapporterar: ca 2130 igår kväll observerades tre mindre drönare över hamnområdet i Luleå.',
  '1) 312145B JUL 26, Tofta skjutfält. 2) Samma natt ca 0200 GPS-störningar V om Visby.',
  'Vad har vi för läge kring Gotland?',
];

class MockLlm {
  constructor(responses) { this.responses = [...responses]; this.calls = []; }
  async chatJson(call) { this.calls.push(call); return structuredClone(this.responses.shift()); }
}

test('mocked local model fixtures are defensively post-processed into previews', async (t) => {
  const { db } = temporaryDatabase(t);
  const llm = new MockLlm(fixtures);
  const service = new AIService({
    db, llm,
    prompts: { load: (key) => key },
    knowledge: { select: () => '' },
    config: { operatorName: 'Testoperatör' },
  });

  const results = [];
  for (const text of inputs) {
    results.push(await service.extraction({ text, entry_time: '2026-08-01T10:00:00.000Z', local_offset_minutes: 120 }));
  }

  assert.equal(results[0].reports.length, 1);
  assert.equal(results[0].reports[0].stunden.iso_utc, '2026-08-01T04:32:00.000Z');
  assert.equal(results[0].reports[0].stallet.mgrs, '33VWE 12345 67890');
  assert.equal(results[0].reports[0].position_missing, false);
  assert.deepEqual(results[0].reports[0].begrepp, ['STRIDSFORDON']);
  assert.equal(results[0].drafts[0].kallrapport_raw, inputs[0]);

  assert.equal(results[1].reports[0].stunden.iso_utc, '2026-07-31T19:30:00.000Z');
  assert.equal(results[1].reports[0].stallet.place_name, 'Luleå hamn');
  assert.equal(results[1].reports[0].position_missing, true);
  assert.deepEqual(results[1].reports[0].begrepp, ['UAS/DRÖNARE', 'KRITISK INFRASTRUKTUR']);

  assert.equal(results[2].reports.length, 2);
  assert.deepEqual(results[2].reports.map((report) => report.begrepp[0]), ['SPANING/REKOGNOSERING', 'SIGNALSTÖRNING/GNSS']);
  assert.ok(results[2].reports[1].fields_uncertain.includes('stunden'));
  assert.equal(results[3].reports.length, 0);
  assert.ok(results[3].reason);
  assert.equal(llm.calls.length, 4);
  assert.ok(llm.calls.every((call) => call.schema && call.schemaName === 'aurora_extraction'));
});

test('explicit labeled 7S fields and source report id override model omissions', () => {
  const sourceText = '051708. Stund, 17:01, Ställe: 33VVC 40125 89192, Styrka, 2 stridsvagnar. Slag: T90, sysselsättning, framrycker längsväg. Symbol, vita kryss. sagesman: Jacob Gothefors.';
  const raw = {
    reports: [{
      source_report_id: null,
      stunden: { raw: '17:01', iso_utc: null, uncertain: false },
      stallet: { raw: '33VVC 40125 89192', mgrs: '33VVC 40125 89192', lat: null, lon: null, place_name: 'Påhittad plats' },
      styrkan: { raw: '2 stridsvagnar', count_min: 2, count_max: 2 },
      slaget: null, sysselsattningen: null, symbolen: null, sagesmannen: null,
      begrepp: ['FORDON MIL'], position_missing: false,
      fields_uncertain: ['slaget', 'sysselsattningen', 'symbolen', 'sagesmannen'], summary_sv: '',
    }],
    reason: null,
  };
  const result = postprocessExtraction(raw, {
    sourceText, activeVocabulary: ['FORDON MIL', 'STRIDSFORDON', 'ÖVRIGT/OKÄNT'],
    referenceDate: new Date('2026-08-05T15:30:00.000Z'), localOffsetMinutes: 120,
  }).reports[0];
  assert.equal(result.source_report_id, '051708');
  assert.equal(result.slaget, 'T90');
  assert.equal(result.sysselsattningen, 'framrycker längsväg');
  assert.equal(result.symbolen, 'vita kryss');
  assert.equal(result.sagesmannen, 'Jacob Gothefors');
  assert.equal(result.stallet.place_name, null);
  assert.deepEqual(result.begrepp, ['STRIDSFORDON']);
  assert.equal(result.fields_uncertain.includes('slaget'), false);
});
