import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { databaseStatus, openDatabase, withTransaction } from './db.mjs';
import { assertSafeDataFile, runtimePaths, loadAppConfig, writeLocalConfig } from './paths.mjs';
import { AppError, assert, errorResponse } from './errors.mjs';
import { createCase, deleteCase, distinctTags, getCase, listCases, updateCase } from './cases.mjs';
import {
  createNote, createQuestion, createVocabularyEntry, deleteNote, deleteQuestion, deleteVocabularyEntry,
  getQuestion, getSettings, getVocabularyEntry, listNotes, listQuestions, reorderVocabulary,
  updateNote, updateQuestion, updateSettings, updateVocabularyEntry,
} from './entities.mjs';
import { listVocabulary } from './vocabulary.mjs';
import {
  exportCasesCsv, exportWorkbook, importDataset, parseImport, previewImport, refreshCsvMirror, writeAtomic,
} from './transfer.mjs';
import { createBackup, startBackupRotation } from './backup.mjs';
import { LlamaClient, discoverModelFiles, resolveModelFile } from './ai/llm.mjs';
import { PromptStore } from './ai/prompts.mjs';
import { KnowledgeSelector } from './ai/knowledge.mjs';
import { AIService } from './ai/service.mjs';
import { AIJobQueue } from './ai/jobs.mjs';
import { boundedText, INPUT_LIMITS } from './validation.mjs';

const MAX_BODY = 16 * 1024 * 1024;
const MAX_IMPORT_PREVIEWS = 1;
const CSP = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:";
const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.geojson': 'application/geo+json',
});

function securityHeaders(response) {
  response.setHeader('Content-Security-Policy', CSP);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
}

function isLoopbackAuthority(value) {
  return /^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/i.test(String(value ?? '').trim());
}

export function validateLocalRequest(request) {
  const host = String(request.headers?.host ?? '').trim();
  assert(isLoopbackAuthority(host), 'UNTRUSTED_HOST', 'Requests must use a loopback Host header.', { status: 421 });
  const fetchSite = String(request.headers?.['sec-fetch-site'] ?? '').toLowerCase();
  assert(fetchSite !== 'cross-site', 'CROSS_SITE_REQUEST', 'Cross-site browser requests are not allowed.', { status: 403 });
  const origin = request.headers?.origin;
  if (origin !== undefined) {
    let parsed;
    try { parsed = new URL(String(origin)); } catch { /* Rejected below. */ }
    assert(parsed?.protocol === 'http:' && isLoopbackAuthority(parsed.host)
      && parsed.host.toLowerCase() === host.toLowerCase(),
    'UNTRUSTED_ORIGIN', 'The request Origin must match the loopback application origin.', { status: 403 });
  }
}

function equalSecret(left, right) {
  const first = Buffer.from(String(left ?? ''));
  const second = Buffer.from(String(right ?? ''));
  return first.length === second.length && first.length > 0 && timingSafeEqual(first, second);
}

export function hasValidSession(request, sessionToken) {
  if (!sessionToken) return true;
  const authorization = String(request.headers?.authorization ?? '');
  if (authorization.startsWith('Bearer ') && equalSecret(authorization.slice(7), sessionToken)) return true;
  const cookies = String(request.headers?.cookie ?? '').split(';');
  for (const cookie of cookies) {
    const [name, ...parts] = cookie.trim().split('=');
    if (name === 'aurora_session') {
      try {
        if (equalSecret(decodeURIComponent(parts.join('=')), sessionToken)) return true;
      } catch { /* A malformed cookie is never a valid session. */ }
    }
  }
  return false;
}

function jsonStringify(value) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? Number(item) : item);
}

function sendJson(response, status, value) {
  const body = Buffer.from(jsonStringify(value));
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
  response.end(body);
}

function sendBuffer(response, status, buffer, headers = {}) {
  response.writeHead(status, { 'content-length': buffer.length, 'cache-control': 'no-store', ...headers });
  response.end(buffer);
}

async function readBuffer(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new AppError('BODY_TOO_LARGE', 'The request body exceeds the size limit.', { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseMultipart(buffer, contentType) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean);
  assert(boundary, 'INVALID_MULTIPART', 'The multipart boundary is missing.');
  const delimiter = Buffer.from(`--${boundary}`);
  const result = { fields: {}, files: [] };
  let cursor = buffer.indexOf(delimiter);
  while (cursor >= 0) {
    const next = buffer.indexOf(delimiter, cursor + delimiter.length);
    if (next < 0) break;
    let part = buffer.subarray(cursor + delimiter.length, next);
    if (part.subarray(0, 2).toString() === '\r\n') part = part.subarray(2);
    if (part.subarray(-2).toString() === '\r\n') part = part.subarray(0, -2);
    const separator = part.indexOf(Buffer.from('\r\n\r\n'));
    if (separator > 0) {
      const headers = part.subarray(0, separator).toString('utf8');
      const data = part.subarray(separator + 4);
      const name = headers.match(/name="([^"]+)"/i)?.[1];
      const filename = headers.match(/filename="([^"]*)"/i)?.[1];
      if (name && filename !== undefined) result.files.push({ name, filename: path.basename(filename), data });
      else if (name) result.fields[name] = data.toString('utf8');
    }
    cursor = next;
  }
  return result;
}

async function readBody(request, { allowMultipart = false } = {}) {
  const buffer = await readBuffer(request);
  if (!buffer.length) return {};
  const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
  if (contentType.includes('application/json')) {
    try { return JSON.parse(buffer.toString('utf8')); }
    catch (error) { throw new AppError('INVALID_JSON', 'The request body is not valid JSON.', { cause: error }); }
  }
  if (allowMultipart && contentType.includes('multipart/form-data')) return parseMultipart(buffer, contentType);
  throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'This endpoint requires a JSON request body.', { status: 415 });
}

function queryObject(searchParams) {
  const result = {};
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    result[key] = values.length > 1 ? values : values[0];
  }
  return result;
}

function matchPath(pathname, pattern) {
  const names = [];
  const expression = new RegExp(`^${pattern.replace(/:([a-zA-Z_]+)/g, (_match, name) => { names.push(name); return '([^/]+)'; })}$`);
  const match = pathname.match(expression);
  return match ? Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1])])) : null;
}

function downloadName(prefix, extension) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13);
  return `${prefix}-${stamp}.${extension}`;
}

function safeFile(root, relative) {
  const resolvedRoot = path.resolve(root);
  const filename = path.resolve(resolvedRoot, relative.replace(/^[/\\]+/, ''));
  if (filename !== resolvedRoot && !filename.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  try {
    const realRoot = fs.realpathSync(resolvedRoot);
    const realFilename = fs.realpathSync(filename);
    if (realFilename !== realRoot && !realFilename.startsWith(`${realRoot}${path.sep}`)) return null;
    if (fs.lstatSync(filename).isSymbolicLink()) return null;
    return realFilename;
  } catch { return null; }
}

function serveStatic(response, root, relative, { immutable = false } = {}) {
  const filename = safeFile(root, relative);
  if (!filename) return false;
  let descriptor;
  let stat;
  let body;
  try {
    descriptor = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) return false;
    body = fs.readFileSync(descriptor);
  } catch { return false; }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
  response.writeHead(200, {
    'content-type': MIME[path.extname(filename).toLowerCase()] ?? 'application/octet-stream',
    'content-length': body.length,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  response.end(body);
  return true;
}

function uploadedFile(body, url) {
  if (body.files?.length) return { filename: body.files[0].filename, buffer: body.files[0].data };
  if (body.file_base64) return { filename: path.basename(body.filename ?? 'import.xlsx'), buffer: Buffer.from(body.file_base64, 'base64') };
  if (body.raw) return { filename: path.basename(url.searchParams.get('filename') ?? 'import.xlsx'), buffer: body.raw };
  return null;
}

function applyMapping(dataset, mapping) {
  if (!mapping || !Object.keys(mapping).length) return dataset;
  return {
    ...dataset,
    cases: (dataset.cases ?? []).map((source) => Object.fromEntries(Object.entries(mapping)
      .filter(([, sourceHeader]) => sourceHeader)
      .map(([target, sourceHeader]) => [target, source[sourceHeader]]))),
  };
}

function importMappingKey(mapping = {}) {
  return JSON.stringify(Object.entries(mapping)
    .filter(([, source]) => typeof source === 'string' && source.trim())
    .sort(([left], [right]) => left.localeCompare(right)));
}

export function validateSettingsPatch(patch, current, paths) {
  assert(patch && typeof patch === 'object' && !Array.isArray(patch), 'INVALID_SETTINGS', 'The settings payload must be an object.');
  const normalized = { ...patch };
  const next = { ...current, ...normalized };
  for (const key of ['appPort', 'llmPort']) {
    assert(Number.isInteger(next[key]) && next[key] >= 1 && next[key] <= 65535, 'INVALID_PORT', `${key} must be an integer from 1 to 65535.`, { details: { key } });
  }
  assert(next.appPort !== next.llmPort, 'PORT_CONFLICT', 'The application and local-model ports must differ.');
  if (patch.lang !== undefined) assert(['sv', 'en'].includes(patch.lang), 'INVALID_LANGUAGE', 'The language is invalid.');
  if (patch.theme !== undefined) assert(['dark', 'light'].includes(patch.theme), 'INVALID_THEME', 'The theme is invalid.');
  if (patch.density !== undefined) assert(['compact', 'comfortable'].includes(patch.density), 'INVALID_DENSITY', 'The display density is invalid.');
  if (patch.accent !== undefined) {
    normalized.accent = boundedText(patch.accent, 'accent', 32, { required: true });
    assert(/^#[0-9a-f]{6}$/i.test(normalized.accent), 'INVALID_ACCENT', 'The accent must be a six-digit hexadecimal color.');
  }
  if (patch.operatorName !== undefined) normalized.operatorName = boundedText(patch.operatorName, 'operatorName', 256, { emptyAsNull: false }) ?? '';
  if (patch.bannerText !== undefined) normalized.bannerText = boundedText(patch.bannerText, 'bannerText', 1_024, { emptyAsNull: false }) ?? '';
  if (patch.backupIntervalMin !== undefined) assert(Number.isInteger(patch.backupIntervalMin) && patch.backupIntervalMin >= 1 && patch.backupIntervalMin <= 10_080, 'INVALID_BACKUP_INTERVAL', 'The backup interval is invalid.');
  if (patch.backupRetention !== undefined) assert(Number.isInteger(patch.backupRetention) && patch.backupRetention >= 1 && patch.backupRetention <= 1000, 'INVALID_BACKUP_RETENTION', 'The backup retention value is invalid.');
  if (patch.spaningsfragaTrigger !== undefined) assert(Number.isInteger(patch.spaningsfragaTrigger) && patch.spaningsfragaTrigger >= 0 && patch.spaningsfragaTrigger <= 10_000, 'INVALID_TRIGGER', 'The collection-question trigger is invalid.');
  if (patch.likelihoodScale !== undefined) {
    assert(Array.isArray(patch.likelihoodScale) && patch.likelihoodScale.length >= 2 && patch.likelihoodScale.length <= 10,
      'INVALID_LIKELIHOOD_SCALE', 'The likelihood scale is invalid.');
    normalized.likelihoodScale = patch.likelihoodScale.map((item, index) => boundedText(item, `likelihoodScale[${index}]`, 256, { required: true }));
  }
  if (patch.modelPath !== undefined) {
    const configuredPath = boundedText(patch.modelPath, 'modelPath', 4_096, { required: true });
    const model = resolveModelFile(paths.modelsDir, path.resolve(paths.root, configuredPath));
    normalized.modelPath = path.relative(paths.root, model.path).split(path.sep).join('/');
  }
  // The generic settings writer independently enforces aggregate and per-value JSON limits.
  assert(Buffer.byteLength(JSON.stringify(normalized), 'utf8') <= INPUT_LIMITS.settings_patch,
    'SETTINGS_TOO_LARGE', 'The settings payload exceeds the size limit.', { status: 413 });
  return normalized;
}

export function createAuroraApp(options = {}) {
  const paths = options.paths ?? runtimePaths(options);
  const config = { ...loadAppConfig(paths), ...options.config };
  const sessionToken = String(options.sessionToken ?? process.env.AURORA_APP_TOKEN ?? '');
  assert(!sessionToken || /^[a-f0-9]{64}$/i.test(sessionToken), 'INVALID_SESSION_TOKEN', 'The local API session token must be 256-bit hexadecimal.');
  const db = options.db ?? openDatabase(paths);
  const llm = options.llm ?? new LlamaClient({ port: config.llmPort, model: config.modelPath ? path.basename(config.modelPath) : undefined, logsDir: paths.logsDir });
  const service = options.aiService ?? new AIService({
    db, llm, prompts: new PromptStore(paths.docsDir),
    knowledge: new KnowledgeSelector(paths.knowledgeDir, { maxChars: Math.max(1000, Number(config.llm?.knowledgeTokenBudget) * 4 || 3600) }),
    config,
  });
  const jobs = options.jobs ?? new AIJobQueue({ db, service, questionThreshold: config.spaningsfragaTrigger, debounceMs: options.aiDebounceMs });
  const imports = new Map();
  const backup = startBackupRotation(db, paths, {
    intervalMin: config.backupIntervalMin,
    keep: config.backupRetention,
    onError: (error) => options.logger?.error?.('backup_failed', { code: error.code }),
  });

  const afterCaseWrite = () => {
    refreshCsvMirror(db, paths);
    jobs.scheduleQuestions({ language: getSettings(db, config).lang ?? config.lang });
  };

  async function api(request, response, url) {
    const method = request.method ?? 'GET';
    const pathname = url.pathname;
    const query = queryObject(url.searchParams);
    let params;

    if (!['GET', 'HEAD'].includes(method)) {
      assert(request.headers['x-aurora-request'] === '1', 'CSRF_HEADER_REQUIRED',
        'A local-request header is required for state-changing operations.', { status: 403 });
    }

    if (method === 'GET' && pathname === '/api') {
      return sendJson(response, 200, { name: 'Aurora Intel API', version: 1 });
    }
    if (method === 'GET' && pathname === '/api/health') {
      return sendJson(response, 200, { ok: true, version: 1 });
    }
    if (method === 'GET' && pathname === '/api/llm/status') return sendJson(response, 200, await llm.status());
    if (method === 'GET' && pathname === '/api/llm/models') {
      return sendJson(response, 200, { files: discoverModelFiles(paths.modelsDir), server: await llm.status(), selected: getSettings(db, config).modelPath ?? config.modelPath ?? null });
    }

    if (method === 'GET' && pathname === '/api/cases') return sendJson(response, 200, listCases(db, query));
    if (method === 'POST' && pathname === '/api/cases') {
      const body = await readBody(request);
      if (body.created_by === undefined || body.created_by === null || body.created_by === '') {
        body.created_by = getSettings(db, config).operatorName ?? '';
      }
      const created = createCase(db, body, { referenceDate: body.entry_time, localOffsetMinutes: body.local_offset_minutes });
      afterCaseWrite();
      return sendJson(response, 201, created);
    }
    if (method === 'GET' && pathname === '/api/tags') return sendJson(response, 200, { tags: distinctTags(db, query.q) });
    if ((params = matchPath(pathname, '/api/cases/:id'))) {
      if (method === 'GET') return sendJson(response, 200, getCase(db, params.id));
      if (method === 'PATCH' || method === 'PUT') {
        const updated = updateCase(db, params.id, await readBody(request));
        afterCaseWrite();
        return sendJson(response, 200, updated);
      }
      if (method === 'DELETE') {
        const removed = deleteCase(db, params.id);
        afterCaseWrite();
        return sendJson(response, 200, removed);
      }
    }
    if ((params = matchPath(pathname, '/api/cases/:id/position')) && (method === 'PATCH' || method === 'PUT')) {
      const body = await readBody(request);
      const updated = updateCase(db, params.id, { mgrs: body.mgrs ?? null, lat: body.lat, lon: body.lon });
      afterCaseWrite();
      return sendJson(response, 200, updated);
    }

    if (method === 'GET' && pathname === '/api/begrepp') return sendJson(response, 200, { rows: listVocabulary(db, query.active === undefined ? {} : { active: ['1', 'true'].includes(query.active) }) });
    if (method === 'POST' && pathname === '/api/begrepp') return sendJson(response, 201, createVocabularyEntry(db, await readBody(request)));
    if (method === 'POST' && pathname === '/api/begrepp/reorder') return sendJson(response, 200, { ids: reorderVocabulary(db, (await readBody(request)).ids) });
    if (method === 'GET' && pathname === '/api/begrepp/export') return sendJson(response, 200, { version: 1, begrepp: listVocabulary(db) });
    if (method === 'POST' && pathname === '/api/begrepp/import') {
      const body = await readBody(request);
      const rows = body.begrepp ?? body;
      assert(Array.isArray(rows), 'INVALID_VOCABULARY_IMPORT', 'The vocabulary import must be an array.');
      assert(rows.length <= 5_000, 'TOO_MANY_VOCABULARY_ENTRIES', 'The vocabulary import contains too many entries.', { status: 413, details: { max_items: 5_000 } });
      const imported = [];
      for (const row of rows) {
        const existing = db.prepare('SELECT id FROM begrepp WHERE name_sv = ? COLLATE NOCASE').get(row.name_sv);
        imported.push(existing ? updateVocabularyEntry(db, existing.id, row) : createVocabularyEntry(db, row));
      }
      return sendJson(response, 200, { rows: imported });
    }
    if ((params = matchPath(pathname, '/api/begrepp/:id'))) {
      if (method === 'GET') return sendJson(response, 200, getVocabularyEntry(db, params.id));
      if (method === 'PATCH' || method === 'PUT') {
        const updated = updateVocabularyEntry(db, params.id, await readBody(request));
        refreshCsvMirror(db, paths);
        return sendJson(response, 200, updated);
      }
      if (method === 'DELETE') return sendJson(response, 200, deleteVocabularyEntry(db, params.id));
    }

    if (method === 'GET' && pathname === '/api/spaningsfragor') return sendJson(response, 200, { rows: listQuestions(db, query) });
    if (method === 'POST' && pathname === '/api/spaningsfragor') return sendJson(response, 201, createQuestion(db, await readBody(request)));
    if (method === 'POST' && pathname === '/api/spaningsfragor/generate') return sendJson(response, 202, jobs.enqueue('questions', await readBody(request)));
    if ((params = matchPath(pathname, '/api/spaningsfragor/:id'))) {
      if (method === 'GET') return sendJson(response, 200, getQuestion(db, params.id));
      if (method === 'PATCH' || method === 'PUT') return sendJson(response, 200, updateQuestion(db, params.id, await readBody(request)));
      if (method === 'DELETE') return sendJson(response, 200, deleteQuestion(db, params.id));
    }

    if (method === 'GET' && pathname === '/api/notes') return sendJson(response, 200, { rows: listNotes(db, query) });
    if (method === 'POST' && pathname === '/api/notes') {
      const created = createNote(db, await readBody(request));
      if (created.entity_type === 'case') refreshCsvMirror(db, paths);
      return sendJson(response, 201, created);
    }
    if ((params = matchPath(pathname, '/api/notes/:id'))) {
      if (method === 'PATCH' || method === 'PUT') {
        const updated = updateNote(db, params.id, await readBody(request));
        if (updated.entity_type === 'case') refreshCsvMirror(db, paths);
        return sendJson(response, 200, updated);
      }
      if (method === 'DELETE') {
        const removed = deleteNote(db, params.id);
        if (removed.entity_type === 'case') refreshCsvMirror(db, paths);
        return sendJson(response, 200, removed);
      }
    }

    if (method === 'GET' && pathname === '/api/settings') return sendJson(response, 200, getSettings(db, config));
    if ((method === 'PATCH' || method === 'PUT') && pathname === '/api/settings') {
      const body = validateSettingsPatch(await readBody(request), getSettings(db, config), paths);
      const settings = updateSettings(db, body, { defaults: config });
      if (body.spaningsfragaTrigger !== undefined) jobs.questionThreshold = Math.max(0, Number(body.spaningsfragaTrigger) || 0);
      const localKeys = ['appPort', 'llmPort', 'modelPath', 'lang', 'theme', 'density', 'accent', 'operatorName', 'bannerText', 'likelihoodScale', 'backupIntervalMin', 'backupRetention', 'spaningsfragaTrigger'];
      const localPatch = Object.fromEntries(Object.entries(body).filter(([key]) => localKeys.includes(key)));
      if (Object.keys(localPatch).length) writeLocalConfig(paths, localPatch);
      return sendJson(response, 200, settings);
    }

    if (method === 'GET' && pathname === '/api/ai/jobs') return sendJson(response, 200, { rows: jobs.list(query) });
    if (method === 'POST' && pathname === '/api/ai/jobs') {
      const body = await readBody(request);
      return sendJson(response, 202, jobs.enqueue(body.type, body.payload ?? {}));
    }
    const directAi = { '/api/ai/extract': 'extraction', '/api/ai/ask': 'qa', '/api/ai/assess': 'assessment' }[pathname];
    if (method === 'POST' && directAi) return sendJson(response, 202, jobs.enqueue(directAi, await readBody(request)));
    if ((params = matchPath(pathname, '/api/ai/jobs/:id'))) {
      if (method === 'GET') return sendJson(response, 200, jobs.get(params.id));
      if (method === 'DELETE') return sendJson(response, 200, jobs.cancel(params.id));
    }

    if (method === 'GET' && ['/api/exports/csv', '/api/export/csv'].includes(pathname)) {
      const delimiter = query.delimiter === 'comma' || query.delimiter === ',' ? ',' : ';';
      const csv = Buffer.from(exportCasesCsv(db, { delimiter, caseIds: query.case_ids ? String(query.case_ids).split(',').map(Number) : undefined }));
      return sendBuffer(response, 200, csv, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${downloadName('aurora-liggare', 'csv')}"` });
    }
    if (method === 'GET' && ['/api/exports/xlsx', '/api/export/xlsx'].includes(pathname)) {
      const workbook = await exportWorkbook(db, { caseIds: query.case_ids ? String(query.case_ids).split(',').map(Number) : undefined });
      return sendBuffer(response, 200, workbook, { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': `attachment; filename="${downloadName('aurora-liggare', 'xlsx')}"` });
    }
    if (method === 'POST' && pathname === '/api/imports/preview') {
      const body = await readBody(request, { allowMultipart: true });
      const file = uploadedFile(body, url);
      const dataset = body.dataset ?? (file ? await parseImport(file.buffer, file.filename) : null);
      assert(dataset, 'IMPORT_FILE_REQUIRED', 'An import file is required.');
      const now = Date.now();
      for (const [key, value] of imports) if (value.expires <= now) imports.delete(key);
      while (imports.size >= MAX_IMPORT_PREVIEWS) imports.delete(imports.keys().next().value);
      const token = randomUUID();
      const preview = previewImport(db, dataset, body.mapping);
      imports.set(token, { dataset, mappingKey: importMappingKey(body.mapping), expires: now + 10 * 60_000 });
      const timer = setTimeout(() => imports.delete(token), 10 * 60_000); timer.unref?.();
      return sendJson(response, 200, { token, ...preview });
    }
    if (method === 'POST' && pathname === '/api/imports/apply') {
      const body = await readBody(request);
      const cached = body.token ? imports.get(body.token) : null;
      assert(cached?.dataset && cached.expires > Date.now(), 'IMPORT_EXPIRED', 'The import preview has expired.', { status: 410 });
      assert(cached.mappingKey === importMappingKey(body.mapping), 'IMPORT_MAPPING_CHANGED', 'Revalidate the column mapping before applying the import.', { status: 409 });
      const validation = previewImport(db, cached.dataset, body.mapping);
      assert(validation.can_apply, 'IMPORT_VALIDATION_FAILED', 'The import preview contains errors and cannot be applied.', { status: 409, details: validation.errors });
      const result = importDataset(db, applyMapping(cached.dataset, body.mapping), { mode: body.mode });
      imports.delete(body.token);
      refreshCsvMirror(db, paths);
      jobs.scheduleQuestions({ language: getSettings(db, config).lang ?? config.lang });
      return sendJson(response, 200, result);
    }

    if (method === 'GET' && pathname === '/api/backups') {
      const rows = fs.readdirSync(paths.backupDir).filter((name) => name.endsWith('.xlsx')).sort().reverse()
        .map((name) => ({ name, size: fs.statSync(path.join(paths.backupDir, name)).size }));
      return sendJson(response, 200, { rows });
    }
    if (method === 'POST' && pathname === '/api/backups') return sendJson(response, 201, { path: await createBackup(db, paths) });
    if (method === 'POST' && pathname === '/api/admin/migrate') return sendJson(response, 200, databaseStatus(db));
    if (method === 'DELETE' && pathname === '/api/logs') {
      for (const name of fs.readdirSync(paths.logsDir)) {
        if (/\.(?:log|jsonl)$/i.test(name)) fs.truncateSync(assertSafeDataFile(paths, path.join(paths.logsDir, name)), 0);
      }
      return sendJson(response, 200, { cleared: true });
    }
    if (method === 'POST' && pathname === '/api/admin/wipe') {
      const body = await readBody(request);
      assert(body.confirmed === true && body.confirmation === 'AURORA', 'CONFIRMATION_REQUIRED', 'Explicit wipe confirmation is required.', { status: 409 });
      const exportsDir = path.join(paths.root, 'exports');
      fs.mkdirSync(exportsDir, { recursive: true });
      const basename = downloadName('aurora-final', 'xlsx');
      writeAtomic(path.join(exportsDir, basename), await exportWorkbook(db));
      writeAtomic(path.join(exportsDir, basename.replace(/\.xlsx$/, '.csv')), exportCasesCsv(db));
      withTransaction(db, () => {
        db.prepare('DELETE FROM notes').run();
        db.prepare('DELETE FROM spaningsfragor').run();
        db.prepare('DELETE FROM cases').run();
        db.prepare('DELETE FROM ai_jobs').run();
        db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('cases', 'spaningsfragor', 'notes', 'ai_jobs')").run();
      });
      refreshCsvMirror(db, paths);
      return sendJson(response, 200, { cleared: true });
    }

    throw new AppError('NOT_FOUND', 'The API endpoint was not found.', { status: 404 });
  }

  const server = http.createServer(async (request, response) => {
    securityHeaders(response);
    try {
      validateLocalRequest(request);
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (sessionToken && request.method === 'GET' && url.pathname === '/' && url.searchParams.has('session')) {
        assert(equalSecret(url.searchParams.get('session'), sessionToken), 'INVALID_SESSION', 'The local session link is invalid.', { status: 403 });
        response.writeHead(303, {
          location: '/',
          'set-cookie': `aurora_session=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Strict; Path=/`,
          'cache-control': 'no-store',
        });
        return response.end();
      }
      if (sessionToken && url.pathname.startsWith('/api') && url.pathname !== '/api/health') {
        assert(hasValidSession(request, sessionToken), 'SESSION_REQUIRED', 'Open Aurora from the start script to establish a local session.', { status: 401 });
      }
      if (url.pathname.startsWith('/api')) return await api(request, response, url);
      if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) throw new AppError('METHOD_NOT_ALLOWED', 'The method is not allowed.', { status: 405 });
      let served = false;
      if (url.pathname.startsWith('/assets/')) {
        const relative = decodeURIComponent(url.pathname.slice('/assets/'.length));
        const immutable = /\.[a-f0-9]{8,}\./i.test(url.pathname);
        served = serveStatic(response, paths.webDir, path.join('assets', relative), { immutable });
        if (!served) served = serveStatic(response, path.join(paths.root, 'assets'), relative, { immutable: true });
      } else served = serveStatic(response, paths.webDir, decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1)), { immutable: /\.[a-f0-9]{8,}\./i.test(url.pathname) });
      if (!served && !path.extname(url.pathname)) served = serveStatic(response, paths.webDir, 'index.html');
      if (!served) throw new AppError('NOT_FOUND', 'The resource was not found.', { status: 404 });
    } catch (error) {
      if (response.headersSent) return response.destroy();
      const { status, body } = errorResponse(error);
      if (status >= 500) options.logger?.error?.('request_failed', { code: error.code ?? 'INTERNAL_ERROR', path: request.url });
      sendJson(response, status, body);
    }
  });

  return {
    server, db, paths, config, llm, jobs, backup,
    async start({ port = config.appPort, maxPortAttempts = 50 } = {}) {
      let candidate = Number(port);
      if (!Number.isInteger(candidate) || candidate < 0 || candidate > 65535) candidate = 8474;
      for (let attempt = 0; attempt < maxPortAttempts; attempt += 1, candidate += 1) {
        try {
          await new Promise((resolve, reject) => {
            const onError = (error) => { server.off('listening', onListening); reject(error); };
            const onListening = () => { server.off('error', onError); resolve(); };
            server.once('error', onError);
            server.once('listening', onListening);
            server.listen(candidate, '127.0.0.1');
          });
          await backup.run().catch((error) => options.logger?.error?.('backup_failed', { code: error.code }));
          const actualPort = server.address().port;
          return { host: '127.0.0.1', port: actualPort, url: `http://127.0.0.1:${actualPort}` };
        } catch (error) {
          if (error?.code !== 'EADDRINUSE') throw error;
        }
      }
      throw new AppError('NO_AVAILABLE_PORT', 'No available loopback port was found.', { status: 503 });
    },
    async close() {
      await jobs.close();
      backup.stop();
      if (server.listening) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      db.close();
    },
  };
}
