import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PromptStore } from '../../server/ai/prompts.mjs';
import { KnowledgeSelector } from '../../server/ai/knowledge.mjs';

test('prompts and knowledge are hot-reloaded with runtime substitutions', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-context-'));
  const docs = path.join(root, 'docs');
  const knowledge = path.join(root, 'knowledge');
  fs.mkdirSync(docs);
  fs.mkdirSync(knowledge);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  fs.writeFileSync(path.join(docs, 'PROMPTS.md'), '<!-- AURORA:A1:START -->Tid {{CURRENT_DATETIME}} text {{RAW_REPORT_TEXT}}<!-- AURORA:A1:END -->');
  const prompts = new PromptStore(docs);
  assert.equal(prompts.render('A1', { CURRENT_DATETIME: '2026-08-01', RAW_REPORT_TEXT: 'värde $&' }), 'Tid 2026-08-01 text värde $&');
  fs.writeFileSync(path.join(docs, 'PROMPTS.md'), '<!-- AURORA:A1:START -->Ny {{RAW_REPORT_TEXT}}<!-- AURORA:A1:END -->');
  assert.equal(prompts.render('A1', { RAW_REPORT_TEXT: 'rapport' }), 'Ny rapport');

  fs.writeFileSync(path.join(knowledge, 'und_grund.md'), 'Grundläggande underrättelsemetodik.');
  const actorFile = path.join(knowledge, 'aktor_test.md');
  fs.writeFileSync(actorFile, '---\nid: aktor_test\ntags: [GNSS]\n---\nGNSS första versionen.');
  const selector = new KnowledgeSelector(knowledge);
  assert.match(selector.select({ question: 'GNSS' }), /första versionen/);
  fs.writeFileSync(actorFile, '---\nid: aktor_test\ntags: [GNSS]\n---\nGNSS ändrad version.');
  assert.match(selector.select({ question: 'GNSS' }), /ändrad version/);
});
