import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AppError, assert } from './errors.mjs';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.dirname(SERVER_DIR);

function absoluteFrom(base, value) {
  return path.isAbsolute(value) ? value : path.resolve(base, value);
}

export function runtimePaths(overrides = {}) {
  const root = absoluteFrom(process.cwd(), overrides.root ?? process.env.AURORA_ROOT ?? DEFAULT_ROOT);
  const dataDir = absoluteFrom(root, overrides.dataDir ?? process.env.AURORA_DATA_DIR ?? 'data');
  return {
    root,
    dataDir,
    dbPath: absoluteFrom(dataDir, overrides.dbPath ?? 'aurora.db'),
    mirrorDir: path.join(dataDir, 'mirror'),
    backupDir: path.join(dataDir, 'backups'),
    logsDir: path.join(dataDir, 'logs'),
    configDir: path.join(root, 'config'),
    docsDir: path.join(root, 'docs'),
    knowledgeDir: path.join(root, 'knowledge'),
    modelsDir: path.join(root, 'llm', 'models'),
    webDir: overrides.webDir
      ? absoluteFrom(root, overrides.webDir)
      : firstDirectory([path.join(root, 'web', 'dist'), path.join(root, 'dist')]),
    migrationsDir: path.join(SERVER_DIR, 'migrations'),
  };
}

function firstDirectory(candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

export function ensureDataDirectories(paths) {
  const dataDir = path.resolve(paths.dataDir);
  if (fs.existsSync(dataDir)) {
    const stat = fs.lstatSync(dataDir);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_DATA_PATH', 'The data directory must be a real directory, not a link.');
  } else fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const realDataDir = fs.realpathSync(dataDir);
  try { fs.chmodSync(realDataDir, 0o700); } catch { /* Windows ACLs are managed by the OS. */ }
  for (const directory of [paths.mirrorDir, paths.backupDir, paths.logsDir]) {
    const resolved = path.resolve(directory);
    assert(resolved.startsWith(`${dataDir}${path.sep}`), 'UNSAFE_DATA_PATH', 'Mutable data paths must remain inside the data directory.');
    if (fs.existsSync(resolved)) {
      const stat = fs.lstatSync(resolved);
      assert(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_DATA_PATH', 'Mutable data subdirectories cannot be links.');
    } else fs.mkdirSync(resolved, { recursive: false, mode: 0o700 });
    const real = fs.realpathSync(resolved);
    assert(real.startsWith(`${realDataDir}${path.sep}`), 'UNSAFE_DATA_PATH', 'A mutable data path escapes the data directory.');
    try { fs.chmodSync(real, 0o700); } catch { /* Windows ACLs are managed by the OS. */ }
  }
  assertSafeDataFile(paths, paths.dbPath, { allowMissing: true });
}

export function assertSafeDataFile(paths, filename, { allowMissing = false } = {}) {
  const dataDir = fs.realpathSync(path.resolve(paths.dataDir));
  const resolved = path.resolve(filename);
  assert(resolved.startsWith(`${path.resolve(paths.dataDir)}${path.sep}`), 'UNSAFE_DATA_PATH', 'Mutable files must remain inside the data directory.');
  const realParent = fs.realpathSync(path.dirname(resolved));
  assert(realParent === dataDir || realParent.startsWith(`${dataDir}${path.sep}`), 'UNSAFE_DATA_PATH', 'A mutable file parent escapes the data directory.');
  if (!fs.existsSync(resolved)) {
    if (allowMissing) return resolved;
    throw new AppError('DATA_FILE_NOT_FOUND', 'The requested data file does not exist.', { status: 404 });
  }
  const stat = fs.lstatSync(resolved);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'UNSAFE_DATA_PATH', 'Mutable files must be regular, unlinked files.');
  const real = fs.realpathSync(resolved);
  assert(real.startsWith(`${dataDir}${path.sep}`), 'UNSAFE_DATA_PATH', 'A mutable file escapes the data directory.');
  return real;
}

export function readJsonFile(filename, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

export function loadAppConfig(paths, overrides = {}) {
  const defaults = readJsonFile(path.join(paths.configDir, 'app.defaults.json'), {
    appPort: 8474,
    llmPort: 8475,
    lang: 'sv',
    theme: 'dark',
    density: 'compact',
    accent: '#F0568C',
    operatorName: '',
    bannerText: 'EJ SEKRETESSKLASSAT – ÖVNING',
    likelihoodScale: ['tveksam', 'möjligen', 'troligen', 'sannolik'],
    backupIntervalMin: 30,
    backupRetention: 20,
    spaningsfragaTrigger: 3,
  });
  const local = process.env.AURORA_CONFIG_DEFAULTS_ONLY === '1'
    ? {}
    : readJsonFile(path.join(paths.configDir, 'app.local.json'), {});
  return { ...defaults, ...local, ...overrides };
}

export function writeLocalConfig(paths, patch) {
  const filename = path.join(paths.configDir, 'app.local.json');
  if (fs.existsSync(filename)) {
    const stat = fs.lstatSync(filename);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
      'UNSAFE_CONFIG_PATH', 'The local configuration must be a regular, unlinked file.');
  }
  const current = readJsonFile(filename, {});
  fs.mkdirSync(paths.configDir, { recursive: true });
  const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, filename);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch { /* Nothing to clean up. */ }
    throw error;
  }
}
