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

test('overview refresh exposes the last completed result while its replacement runs', async (t) => {
  const { db } = temporaryDatabase(t);
  let release;
  const blocking = new Promise((resolve) => { release = resolve; });
  const service = {
    async execute(_type, payload) {
      if (payload.block) await blocking;
      return { version: payload.version };
    },
  };
  const queue = new AIJobQueue({ db, service });
  const first = queue.enqueue('overview', { version: 1 });
  await until(() => queue.get(first.id).status === 'done');
  const second = queue.enqueue('overview', { version: 2, block: true });
  await until(() => queue.get(second.id).status === 'running');

  const visible = queue.latestWithPrevious('overview');
  assert.equal(visible.id, second.id);
  assert.deepEqual(visible.previous_result, { version: 1 });

  release();
  await until(() => queue.get(second.id).status === 'done');
  await queue.close();
});

test('manual AI work runs before pending automatic analysis', async (t) => {
  const { db } = temporaryDatabase(t);
  const started = [];
  let release;
  const blocking = new Promise((resolve) => { release = resolve; });
  const service = {
    async execute(_type, payload) {
      started.push(payload.name);
      if (payload.name === 'first') await blocking;
      return { name: payload.name };
    },
  };
  const queue = new AIJobQueue({ db, service });
  const first = queue.enqueue('qa', { name: 'first' });
  await until(() => queue.get(first.id).status === 'running');
  const automatic = queue.enqueue('overview', { name: 'automatic', automatic: true });
  const manual = queue.enqueue('assessment', { name: 'manual' });

  release();
  await until(() => queue.get(automatic.id).status === 'done' && queue.get(manual.id).status === 'done');
  assert.deepEqual(started, ['first', 'manual', 'automatic']);
  await queue.close();
});
