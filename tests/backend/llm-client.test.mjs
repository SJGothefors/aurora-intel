import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { LlamaClient } from '../../server/ai/llm.mjs';

test('local-model prompt log records hashes and lengths but never report content', async (t) => {
  const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-llm-log-'));
  t.after(() => fs.rmSync(logsDir, { recursive: true, force: true }));
  const secret = 'KÄLLRAPPORT SOM INTE FÅR LOGGAS';
  const client = new LlamaClient({
    port: 8475,
    logsDir,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
    }),
  });
  const result = await client.chatJson({
    schemaName: 'log_test',
    schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    messages: [{ role: 'user', content: secret }], temperature: 0.1, seed: 1,
  });
  assert.deepEqual(result, { ok: true });
  const log = fs.readFileSync(path.join(logsDir, 'llm-prompts.jsonl'), 'utf8');
  assert.doesNotMatch(log, new RegExp(secret));
  const [entry, completion] = log.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(entry.messages[0].chars, secret.length);
  assert.match(entry.messages[0].sha256, /^[a-f0-9]{64}$/);
  assert.match(entry.context_sha256, /^[a-f0-9]{64}$/);
  assert.equal(completion.event, 'completion');
  assert.equal(completion.chars, 11);
  assert.match(completion.sha256, /^[a-f0-9]{64}$/);
  assert.equal(completion.content, undefined);
});

test('local-model client accepts fenced JSON without exposing surrounding model prose', async () => {
  const client = new LlamaClient({
    port: 8475,
    fetchImpl: async () => ({ ok: true, json: async () => ({
      choices: [{ message: { content: '```json\n{"ok":true}\n```' }, finish_reason: 'stop' }],
    }) }),
  });
  const result = await client.chatJson({
    schemaName: 'fenced_test',
    schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } },
    messages: [{ role: 'user', content: 'test' }], temperature: 0, seed: 1,
  });
  assert.deepEqual(result, { ok: true });
});

test('local-model client rejects JSON that violates the enforced response schema', async () => {
  const client = new LlamaClient({
    port: 8475,
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":"yes"}' } }] }) }),
  });
  await assert.rejects(() => client.chatJson({
    schemaName: 'invalid_test',
    schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } },
    messages: [{ role: 'user', content: 'test' }], temperature: 0, seed: 1,
  }), { code: 'LLM_SCHEMA_VIOLATION' });
});

test('local-model client reports an output-limit response as truncated', async () => {
  const client = new LlamaClient({
    port: 8475,
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":' }, finish_reason: 'length' }] }) }),
  });
  await assert.rejects(() => client.chatJson({
    schemaName: 'truncated_test',
    schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    messages: [{ role: 'user', content: 'test' }], temperature: 0, seed: 1, maxTokens: 5,
  }), { code: 'LLM_OUTPUT_TRUNCATED' });
});

test('local-model client authenticates to the loopback llama listener without logging the key', async () => {
  let observedHeaders;
  const apiKey = 'a'.repeat(64);
  const client = new LlamaClient({
    port: 8475,
    apiKey,
    fetchImpl: async (_url, init) => {
      observedHeaders = init.headers;
      return { ok: true, json: async () => ({ data: [] }) };
    },
  });
  await client.request('/v1/models');
  assert.equal(observedHeaders.authorization, `Bearer ${apiKey}`);
});
