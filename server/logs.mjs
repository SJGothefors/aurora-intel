import fs from 'node:fs';
import path from 'node:path';
import { AppError, assert } from './errors.mjs';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_ARCHIVES = 5;

function safeLogPath(logsDir, name) {
  assert(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(name)), 'UNSAFE_LOG_PATH', 'The log filename is invalid.');
  const resolvedDir = path.resolve(logsDir);
  const stat = fs.lstatSync(resolvedDir);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_LOG_PATH', 'The logs directory must be a real directory.');
  return path.join(fs.realpathSync(resolvedDir), String(name));
}

function assertRegularUnlinked(filename, { allowMissing = false } = {}) {
  try {
    const stat = fs.lstatSync(filename);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
      'UNSAFE_LOG_PATH', 'Log files must be regular files with exactly one link.');
    return stat;
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return null;
    throw error;
  }
}

function rotate(filename, archives) {
  for (let index = archives; index >= 1; index -= 1) {
    const destination = `${filename}.${index}`;
    const source = index === 1 ? filename : `${filename}.${index - 1}`;
    if (fs.existsSync(destination)) {
      assertRegularUnlinked(destination);
      fs.unlinkSync(destination);
    }
    if (fs.existsSync(source)) {
      assertRegularUnlinked(source);
      fs.renameSync(source, destination);
    }
  }
}

/** Append to a no-follow local log and retain a bounded set of rotated archives. */
export function appendBoundedLog(logsDir, name, value, options = {}) {
  const maxBytes = Math.max(1, Number(options.maxBytes) || DEFAULT_MAX_BYTES);
  const archives = Math.max(1, Math.min(20, Number(options.archives) || DEFAULT_ARCHIVES));
  const message = Buffer.from(String(value), 'utf8');
  if (message.length > maxBytes) throw new AppError('LOG_ENTRY_TOO_LARGE', 'A single log entry exceeds the log size limit.');
  const filename = safeLogPath(logsDir, name);
  const existing = assertRegularUnlinked(filename, { allowMissing: true });
  if (existing && existing.size + message.length > maxBytes) rotate(filename, archives);

  const descriptor = fs.openSync(filename,
    fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const opened = fs.fstatSync(descriptor);
    assert(opened.isFile() && opened.nlink === 1, 'UNSAFE_LOG_PATH', 'The opened log target is unsafe.');
    try { fs.fchmodSync(descriptor, 0o600); } catch { /* Windows ACLs are managed by the OS. */ }
    fs.writeFileSync(descriptor, message);
  } finally {
    fs.closeSync(descriptor);
  }
}
