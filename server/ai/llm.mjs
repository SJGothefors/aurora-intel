import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { AppError, assert } from '../errors.mjs';
import { validateJsonSchema } from './json-schema.mjs';
import { appendBoundedLog } from '../logs.mjs';

function localBaseUrl(portOrUrl) {
  const url = /^https?:/i.test(String(portOrUrl))
    ? new URL(String(portOrUrl))
    : new URL(`http://127.0.0.1:${Number(portOrUrl)}`);
  assert(url.protocol === 'http:', 'INVALID_LLM_URL', 'The local model URL must use HTTP.');
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'INVALID_LLM_URL', 'The local model URL must use the loopback interface.');
  return url.href.replace(/\/$/, '');
}

function parseContent(content) {
  if (content && typeof content === 'object' && !Array.isArray(content)) return content;
  if (Array.isArray(content)) content = content.map((item) => item?.text ?? '').join('');
  try { return JSON.parse(String(content)); }
  catch (error) { throw new AppError('LLM_INVALID_JSON', 'The local model returned invalid JSON.', { status: 502, cause: error }); }
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function isWithin(root, filename) {
  return filename !== root && filename.startsWith(`${root}${path.sep}`);
}

function modelRoot(modelsDir, { allowMissing = false } = {}) {
  const resolved = path.resolve(modelsDir);
  if (!fs.existsSync(resolved)) {
    if (allowMissing) return null;
    throw new AppError('MODEL_NOT_FOUND', 'The local model directory does not exist.', { status: 404 });
  }
  const stat = fs.lstatSync(resolved);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_MODEL_PATH', 'The local model directory must be a real directory, not a link.');
  return { resolved, real: fs.realpathSync(resolved) };
}

export function resolveModelFile(modelsDir, candidate) {
  const root = modelRoot(modelsDir);
  assert(typeof candidate === 'string' && Buffer.byteLength(candidate, 'utf8') <= 4_096,
    'INVALID_MODEL_PATH', 'The model path is invalid.');
  const filename = path.resolve(root.resolved, candidate);
  assert(filename.toLowerCase().endsWith('.gguf') && isWithin(root.resolved, filename),
    'INVALID_MODEL_PATH', 'The model path must identify a GGUF file in llm/models.');
  let before;
  try { before = fs.lstatSync(filename); }
  catch (error) {
    if (error?.code === 'ENOENT') throw new AppError('MODEL_NOT_FOUND', 'The selected local model file does not exist.', { status: 404 });
    throw error;
  }
  assert(before.isFile() && !before.isSymbolicLink() && before.nlink === 1,
    'UNSAFE_MODEL_PATH', 'The selected local model must be a regular, unlinked file.');

  let descriptor;
  try {
    descriptor = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(descriptor);
    assert(opened.isFile() && opened.nlink === 1 && opened.dev === before.dev && opened.ino === before.ino,
      'UNSAFE_MODEL_PATH', 'The selected local model changed during validation.');
    const real = fs.realpathSync(filename);
    const realStat = fs.statSync(real);
    assert(isWithin(root.real, real) && realStat.dev === opened.dev && realStat.ino === opened.ino,
      'UNSAFE_MODEL_PATH', 'The selected local model escapes llm/models.');
    const magic = Buffer.alloc(4);
    assert(fs.readSync(descriptor, magic, 0, magic.length, 0) === magic.length && magic.toString('ascii') === 'GGUF',
      'INVALID_MODEL_FILE', 'The selected local model is not a GGUF file.');
    return { name: path.basename(filename), path: filename, realpath: real, size: opened.size, modified_at: opened.mtime.toISOString() };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function discoverModelFiles(modelsDir) {
  const root = modelRoot(modelsDir, { allowMissing: true });
  if (!root) return [];
  let entries = [];
  try { entries = fs.readdirSync(modelsDir, { withFileTypes: true }); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const files = [];
  for (const entry of entries) {
    if (!entry.name.toLowerCase().endsWith('.gguf')) continue;
    try {
      const model = resolveModelFile(modelsDir, entry.name);
      files.push({ name: model.name, path: model.path, size: model.size, modified_at: model.modified_at });
    } catch (error) {
      if (!['INVALID_MODEL_FILE', 'INVALID_MODEL_PATH', 'MODEL_NOT_FOUND', 'UNSAFE_MODEL_PATH'].includes(error?.code)) throw error;
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name));
}

export class LlamaClient {
  constructor(options = {}) {
    this.baseUrl = localBaseUrl(options.baseUrl ?? options.port ?? 8475);
    this.model = options.model ?? 'local-model';
    this.timeoutMs = Number(options.timeoutMs) || 180_000;
    this.fetch = options.fetchImpl ?? globalThis.fetch;
    this.logsDir = options.logsDir;
    this.apiKey = String(options.apiKey ?? process.env.AURORA_LLM_API_KEY ?? '');
  }

  async request(endpoint, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), options.timeoutMs ?? this.timeoutMs);
    const external = options.signal;
    const abort = () => controller.abort(external.reason);
    external?.addEventListener('abort', abort, { once: true });
    try {
      const response = await this.fetch(`${this.baseUrl}${endpoint}`, {
        method: options.method ?? 'GET',
        headers: {
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new AppError('LLM_HTTP_ERROR', 'The local model server rejected the request.', {
          status: 502, details: { status: response.status },
        });
      }
      return await response.json();
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (controller.signal.aborted) {
        const code = external?.aborted ? 'JOB_CANCELLED' : 'LLM_TIMEOUT';
        throw new AppError(code, code === 'JOB_CANCELLED' ? 'The AI job was cancelled.' : 'The local model timed out.', { status: code === 'JOB_CANCELLED' ? 409 : 504, cause: error });
      }
      throw new AppError('LLM_UNAVAILABLE', 'The local model server is unavailable.', { status: 503, cause: error });
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', abort);
    }
  }

  async status() {
    const started = Date.now();
    try {
      const response = await this.request('/v1/models', { timeoutMs: 3_000 });
      return { ok: true, state: 'ready', latency_ms: Date.now() - started, models: response.data ?? [] };
    } catch (error) {
      return { ok: false, state: 'unavailable', latency_ms: Date.now() - started, error_code: error.code ?? 'LLM_UNAVAILABLE', models: [] };
    }
  }

  async chatJson({ schema, schemaName, messages, temperature, seed, signal }) {
    const body = {
      model: this.model,
      messages,
      temperature,
      seed,
      stream: false,
      response_format: {
        type: 'json_schema',
        json_schema: { name: schemaName, strict: true, schema },
      },
    };
    this.logPrompt({
      ts: new Date().toISOString(),
      schema: schemaName,
      schema_sha256: sha256(JSON.stringify(schema)),
      model: this.model,
      temperature,
      seed,
      messages: messages.map((message) => ({
        role: message.role,
        chars: String(message.content ?? '').length,
        sha256: sha256(message.content ?? ''),
      })),
      context_sha256: sha256(JSON.stringify(messages)),
    });
    const response = await this.request('/v1/chat/completions', { method: 'POST', body, signal });
    const content = response?.choices?.[0]?.message?.content;
    if (content === undefined) throw new AppError('LLM_EMPTY_RESPONSE', 'The local model returned no completion.', { status: 502 });
    return validateJsonSchema(parseContent(content), schema);
  }

  logPrompt(entry) {
    if (!this.logsDir) return;
    try {
      fs.mkdirSync(this.logsDir, { recursive: true, mode: 0o700 });
      appendBoundedLog(this.logsDir, 'llm-prompts.jsonl', `${JSON.stringify(entry)}\n`);
    } catch {
      // Prompt logging must never make the AI pipeline unavailable.
    }
  }
}
