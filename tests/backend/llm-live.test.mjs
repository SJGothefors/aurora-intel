import test from 'node:test';
import assert from 'node:assert/strict';
import { LlamaClient } from '../../server/ai/llm.mjs';

test('live llama.cpp honors a strict JSON schema', {
  skip: process.env.AURORA_LIVE_LLM !== '1' ? 'Set AURORA_LIVE_LLM=1 with llama-server running to execute.' : false,
}, async () => {
  const client = new LlamaClient({ port: Number(process.env.AURORA_LLM_PORT) || 8475, timeoutMs: 60_000 });
  const result = await client.chatJson({
    schemaName: 'aurora_live_grammar_test',
    schema: {
      type: 'object', additionalProperties: false, required: ['ok', 'value'],
      properties: { ok: { type: 'boolean', const: true }, value: { type: 'integer', const: 7 } },
    },
    messages: [{ role: 'system', content: 'Return only the requested JSON.' }, { role: 'user', content: 'Return ok=true and value=7.' }],
    temperature: 0, seed: 1,
  });
  assert.deepEqual(result, { ok: true, value: 7 });
});
