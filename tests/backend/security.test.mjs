import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hasValidSession, validateLocalRequest, validateSettingsPatch } from '../../server/app.mjs';
import { discoverModelFiles, resolveModelFile } from '../../server/ai/llm.mjs';
import { ensureDataDirectories, runtimePaths } from '../../server/paths.mjs';
import { appendBoundedLog } from '../../server/logs.mjs';

function request(headers) {
  return { headers };
}

test('HTTP boundary accepts only matching loopback Host and Origin values', () => {
  assert.doesNotThrow(() => validateLocalRequest(request({ host: '127.0.0.1:8474' })));
  assert.doesNotThrow(() => validateLocalRequest(request({
    host: 'localhost:8474',
    origin: 'http://localhost:8474',
    'sec-fetch-site': 'same-origin',
  })));

  assert.throws(() => validateLocalRequest(request({ host: 'aurora.example' })), { code: 'UNTRUSTED_HOST' });
  assert.throws(() => validateLocalRequest(request({
    host: '127.0.0.1:8474',
    origin: 'http://attacker.example',
  })), { code: 'UNTRUSTED_ORIGIN' });
  assert.throws(() => validateLocalRequest(request({
    host: '127.0.0.1:8474',
    'sec-fetch-site': 'cross-site',
  })), { code: 'CROSS_SITE_REQUEST' });
});

test('local API session accepts only the exact bearer token or cookie', () => {
  const token = 'a'.repeat(64);
  assert.equal(hasValidSession(request({ authorization: `Bearer ${token}` }), token), true);
  assert.equal(hasValidSession(request({ cookie: `theme=dark; aurora_session=${token}` }), token), true);
  assert.equal(hasValidSession(request({ authorization: `Bearer ${'b'.repeat(64)}` }), token), false);
  assert.equal(hasValidSession(request({ cookie: 'aurora_session=%E0%A4%A' }), token), false);
  assert.equal(hasValidSession(request({}), token), false);
  assert.equal(hasValidSession(request({}), ''), true);
});

test('mutable data directories reject preseeded filesystem links', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-path-security-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-path-outside-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  try { fs.symlinkSync(outside, path.join(root, 'data'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('Filesystem links are unavailable in this test environment.');
    throw error;
  }
  assert.throws(() => ensureDataDirectories(runtimePaths({ root })), { code: 'UNSAFE_DATA_PATH' });
});

test('security logs rotate at a hard size limit and reject linked targets', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-log-security-'));
  const logs = path.join(root, 'logs');
  fs.mkdirSync(logs, { mode: 0o700 });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  appendBoundedLog(logs, 'audit.log', '12345678', { maxBytes: 10, archives: 2 });
  appendBoundedLog(logs, 'audit.log', 'abcdefgh', { maxBytes: 10, archives: 2 });
  assert.equal(fs.readFileSync(path.join(logs, 'audit.log.1'), 'utf8'), '12345678');
  assert.equal(fs.readFileSync(path.join(logs, 'audit.log'), 'utf8'), 'abcdefgh');

  try { fs.symlinkSync(path.join(logs, 'audit.log'), path.join(logs, 'linked.log')); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('Filesystem links are unavailable in this test environment.');
    throw error;
  }
  assert.throws(() => appendBoundedLog(logs, 'linked.log', 'blocked'), { code: 'UNSAFE_LOG_PATH' });
});

test('model discovery and settings reject fake, missing, linked, and escaping GGUF paths', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-model-security-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-model-outside-'));
  const paths = runtimePaths({ root });
  fs.mkdirSync(paths.modelsDir, { recursive: true });
  fs.writeFileSync(path.join(paths.modelsDir, 'valid.gguf'), Buffer.from('GGUFfixture'));
  fs.writeFileSync(path.join(paths.modelsDir, 'fake.gguf'), Buffer.from('NOT-A-MODEL'));
  fs.writeFileSync(path.join(outside, 'outside.gguf'), Buffer.from('GGUFoutside'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  let linked = false;
  try {
    fs.symlinkSync(path.join(outside, 'outside.gguf'), path.join(paths.modelsDir, 'linked.gguf'), 'file');
    linked = true;
  } catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
  }

  assert.deepEqual(discoverModelFiles(paths.modelsDir).map((file) => file.name), ['valid.gguf']);
  assert.equal(resolveModelFile(paths.modelsDir, 'valid.gguf').size, 11);
  assert.throws(() => resolveModelFile(paths.modelsDir, 'fake.gguf'), { code: 'INVALID_MODEL_FILE' });
  assert.throws(() => resolveModelFile(paths.modelsDir, 'missing.gguf'), { code: 'MODEL_NOT_FOUND' });
  assert.throws(() => resolveModelFile(paths.modelsDir, path.join(outside, 'outside.gguf')), { code: 'INVALID_MODEL_PATH' });
  if (linked) assert.throws(() => resolveModelFile(paths.modelsDir, 'linked.gguf'), { code: 'UNSAFE_MODEL_PATH' });

  const current = { appPort: 8474, llmPort: 8475 };
  assert.equal(validateSettingsPatch({ modelPath: 'llm/models/valid.gguf' }, current, paths).modelPath, 'llm/models/valid.gguf');
  assert.throws(() => validateSettingsPatch({ modelPath: path.join(outside, 'outside.gguf') }, current, paths), { code: 'INVALID_MODEL_PATH' });
  if (linked) assert.throws(() => validateSettingsPatch({ modelPath: 'llm/models/linked.gguf' }, current, paths), { code: 'UNSAFE_MODEL_PATH' });
});
