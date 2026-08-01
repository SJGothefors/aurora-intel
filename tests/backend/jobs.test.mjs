import test from 'node:test';
import assert from 'node:assert/strict';
import { AIJobQueue } from '../../server/ai/jobs.mjs';
import { temporaryDatabase } from './helpers.mjs';

async function until(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('Timed out waiting for job state.');
}

test('AI queue persists results and cancels a running local-model job', async (t) => {
  const { db } = temporaryDatabase(t);
  let release;
  const blocking = new Promise((resolve) => { release = resolve; });
  const service = {
    async execute(type, payload, signal) {
      if (payload.block) {
        await Promise.race([
          blocking,
          new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'JOB_CANCELLED' })), { once: true })),
        ]);
      }
      return { type, value: payload.value };
    },
  };
  const queue = new AIJobQueue({ db, service });

  const first = queue.enqueue('qa', { value: 7 });
  const completed = await until(() => {
    const job = queue.get(first.id);
    return job.status === 'done' ? job : null;
  });
  assert.deepEqual(completed.result, { type: 'qa', value: 7 });
  assert.equal(db.prepare('SELECT payload FROM ai_jobs WHERE id = ?').get(first.id).payload, '{}');
  assert.equal(Object.hasOwn(queue.list()[0], 'result'), false);

  const second = queue.enqueue('assessment', { block: true });
  await until(() => queue.get(second.id).status === 'running');
  queue.cancel(second.id);
  const cancelled = await until(() => queue.get(second.id).status === 'cancelled' ? queue.get(second.id) : null);
  assert.equal(cancelled.error_code, 'JOB_CANCELLED');
  release();
  await queue.close();
});
