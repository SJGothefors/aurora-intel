import { randomUUID } from 'node:crypto';
import { AppError, assert } from '../errors.mjs';

const TYPES = new Set(['extraction', 'questions', 'qa', 'assessment']);
const MAX_ACTIVE_JOBS = 32;
const MAX_RETAINED_JOBS = 100;
const MAX_JOB_PAYLOAD_BYTES = 256 * 1024;
const MAX_JOB_RESULT_BYTES = 2 * 1024 * 1024;
const RESULT_RETENTION_MS = 24 * 60 * 60 * 1000;

function decode(row, { includePayload = false, includeResult = true } = {}) {
  if (!row) return null;
  const result = { ...row };
  if (includePayload) result.payload = JSON.parse(row.payload);
  else delete result.payload;
  if (includeResult && row.result) result.result = JSON.parse(row.result);
  else delete result.result;
  return result;
}

export class AIJobQueue {
  constructor({ db, service, debounceMs = 30_000, questionThreshold = 3 }) {
    this.db = db;
    this.service = service;
    this.running = false;
    this.drainPromise = null;
    this.closing = false;
    this.current = null;
    this.autoTimer = null;
    this.debounceMs = debounceMs;
    const configuredThreshold = Number(questionThreshold);
    this.questionThreshold = Number.isFinite(configuredThreshold) && configuredThreshold >= 0 ? configuredThreshold : 3;
    db.prepare("UPDATE ai_jobs SET status = 'pending', started_at = NULL WHERE status = 'running'").run();
    db.prepare("UPDATE ai_jobs SET payload = '{}' WHERE status IN ('done', 'failed', 'cancelled')").run();
    this.prune();
    queueMicrotask(() => this.drain());
  }

  enqueue(type, payload = {}) {
    assert(!this.closing, 'QUEUE_CLOSED', 'The AI job queue is closed.', { status: 503 });
    assert(TYPES.has(type), 'INVALID_JOB_TYPE', 'The AI job type is invalid.');
    assert(payload && typeof payload === 'object' && !Array.isArray(payload), 'INVALID_JOB_PAYLOAD', 'The AI job payload must be an object.');
    const active = Number(this.db.prepare("SELECT count(*) AS count FROM ai_jobs WHERE status IN ('pending', 'running')").get().count);
    assert(active < MAX_ACTIVE_JOBS, 'QUEUE_FULL', 'The local AI queue is full.', { status: 429 });
    const encodedPayload = JSON.stringify(payload);
    assert(Buffer.byteLength(encodedPayload) <= MAX_JOB_PAYLOAD_BYTES, 'JOB_PAYLOAD_TOO_LARGE', 'The AI job payload exceeds the size limit.', { status: 413 });
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO ai_jobs (id, type, status, payload, created_at) VALUES (?, ?, 'pending', ?, ?)
    `).run(id, type, encodedPayload, createdAt);
    queueMicrotask(() => this.drain());
    return this.get(id);
  }

  list({ limit = 100 } = {}) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    return this.db.prepare('SELECT * FROM ai_jobs ORDER BY created_at DESC LIMIT ?').all(safeLimit)
      .map((row) => decode(row, { includeResult: false }));
  }

  get(id, options = {}) {
    const row = this.db.prepare('SELECT * FROM ai_jobs WHERE id = ?').get(String(id));
    if (!row) throw new AppError('JOB_NOT_FOUND', 'The AI job was not found.', { status: 404 });
    return decode(row, options);
  }

  cancel(id) {
    const job = this.get(id);
    if (['done', 'failed', 'cancelled'].includes(job.status)) return job;
    const now = new Date().toISOString();
    if (job.status === 'pending') {
      this.db.prepare("UPDATE ai_jobs SET status = 'cancelled', payload = '{}', finished_at = ? WHERE id = ? AND status = 'pending'").run(now, job.id);
    } else if (this.current?.id === job.id) {
      this.current.controller.abort(new Error('cancelled'));
    }
    return this.get(job.id);
  }

  scheduleQuestions(payload = {}) {
    clearTimeout(this.autoTimer);
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null;
      const count = Number(this.db.prepare('SELECT count(*) AS count FROM cases').get().count);
      const active = Number(this.db.prepare("SELECT count(*) AS count FROM ai_jobs WHERE type = 'questions' AND status IN ('pending', 'running')").get().count);
      if (count > this.questionThreshold && !active) this.enqueue('questions', { ...payload, automatic: true });
    }, this.debounceMs);
    this.autoTimer.unref?.();
  }

  async drain() {
    if (this.running) return this.drainPromise;
    this.running = true;
    this.drainPromise = (async () => {
      try {
        while (true) {
          if (this.closing) break;
          const row = this.db.prepare("SELECT * FROM ai_jobs WHERE status = 'pending' ORDER BY created_at LIMIT 1").get();
          if (!row) break;
          const now = new Date().toISOString();
          const claimed = this.db.prepare("UPDATE ai_jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'pending'").run(now, row.id);
          if (!claimed.changes) continue;
          const controller = new AbortController();
          this.current = { id: row.id, controller };
          try {
            const result = await this.service.execute(row.type, JSON.parse(row.payload), controller.signal);
            const encodedResult = JSON.stringify(result);
            assert(Buffer.byteLength(encodedResult) <= MAX_JOB_RESULT_BYTES, 'JOB_RESULT_TOO_LARGE', 'The AI job result exceeds the size limit.', { status: 502 });
            this.db.prepare("UPDATE ai_jobs SET status = 'done', payload = '{}', result = ?, finished_at = ? WHERE id = ?")
              .run(encodedResult, new Date().toISOString(), row.id);
          } catch (error) {
            const cancelled = controller.signal.aborted || error?.code === 'JOB_CANCELLED';
            this.db.prepare("UPDATE ai_jobs SET status = ?, payload = '{}', result = NULL, error_code = ?, finished_at = ? WHERE id = ?")
              .run(cancelled ? 'cancelled' : 'failed', cancelled ? 'JOB_CANCELLED' : (error?.code ?? 'AI_JOB_FAILED'), new Date().toISOString(), row.id);
          } finally {
            this.current = null;
            this.prune();
          }
        }
      } finally {
        this.running = false;
        this.drainPromise = null;
        if (!this.closing && this.db.prepare("SELECT 1 FROM ai_jobs WHERE status = 'pending' LIMIT 1").get()) {
          queueMicrotask(() => this.drain());
        }
      }
    })();
    return this.drainPromise;
  }

  async close() {
    this.closing = true;
    clearTimeout(this.autoTimer);
    this.db.prepare("UPDATE ai_jobs SET status = 'cancelled', payload = '{}', error_code = 'JOB_CANCELLED', finished_at = ? WHERE status = 'pending'")
      .run(new Date().toISOString());
    this.current?.controller.abort(new Error('shutdown'));
    await this.drainPromise;
  }

  prune() {
    const cutoff = new Date(Date.now() - RESULT_RETENTION_MS).toISOString();
    this.db.prepare("DELETE FROM ai_jobs WHERE status IN ('done', 'failed', 'cancelled') AND finished_at < ?").run(cutoff);
    this.db.prepare(`DELETE FROM ai_jobs WHERE status IN ('done', 'failed', 'cancelled') AND id NOT IN (
      SELECT id FROM ai_jobs WHERE status IN ('done', 'failed', 'cancelled') ORDER BY created_at DESC LIMIT ?
    )`).run(MAX_RETAINED_JOBS);
  }
}
