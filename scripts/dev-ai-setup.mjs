#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function hostPlatform() {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'macos-arm64';
  if (process.platform === 'darwin' && process.arch === 'x64') return 'macos-x64';
  if (process.platform === 'win32' && process.arch === 'x64') return 'windows-x64';
  throw new Error(`Automatic local AI setup is not available for ${process.platform}-${process.arch}.`);
}

function readLock(root) {
  return fs.readFileSync(path.join(root, 'config', 'versions.lock'), 'utf8').split(/\r?\n/).flatMap((line) => {
    if (!line.trim() || line.startsWith('#')) return [];
    const fields = line.split('|');
    if (fields.length !== 7) throw new Error('Invalid entry in config/versions.lock.');
    const [id, platform, kind, filename, url, sha256, destination] = fields;
    if (!url.startsWith('https://') || !/^[0-9a-f]{64}$/i.test(sha256)) throw new Error(`Unsafe or invalid lock entry: ${id}`);
    if (!destination || path.isAbsolute(destination) || destination.split(/[\\/]/).includes('..')) throw new Error(`Unsafe lock destination: ${id}`);
    return [{ id, platform, kind, filename, url, sha256: sha256.toLowerCase(), destination }];
  });
}

export function selectedDevAiArtifacts(root = scriptRoot) {
  const platform = hostPlatform();
  const entries = readLock(root);
  const llama = entries.find((entry) => entry.kind === 'llama' && entry.platform === platform);
  const model = entries.find((entry) => entry.kind === 'model' && entry.platform === 'all');
  if (!llama || !model) throw new Error(`Pinned AI artifacts are missing for ${platform}.`);
  return { platform, llama, model };
}

function ensureParent(root, destination) {
  const target = path.resolve(root, destination);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('Artifact destination escapes the project.');
  let current = path.resolve(root);
  for (const part of path.relative(root, path.dirname(target)).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.existsSync(current)) {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe artifact directory: ${path.relative(root, current)}`);
    } else {
      fs.mkdirSync(current, { mode: 0o700 });
    }
  }
  return target;
}

async function sha256(filename) {
  const hash = createHash('sha256');
  await pipeline(fs.createReadStream(filename), hash);
  return hash.digest('hex');
}

async function download(entry, root) {
  const target = ensureParent(root, entry.destination);
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error(`Unsafe existing artifact: ${entry.destination}`);
    if (await sha256(target) === entry.sha256) return target;
    fs.renameSync(target, `${target}.invalid.${Date.now()}`);
  }

  const partial = `${target}.part`;
  let offset = 0;
  if (fs.existsSync(partial)) {
    const stat = fs.lstatSync(partial);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error(`Unsafe partial download: ${entry.destination}.part`);
    offset = stat.size;
    if (offset > 0 && await sha256(partial) === entry.sha256) {
      fs.renameSync(partial, target);
      return target;
    }
  }
  process.stdout.write(`Downloading pinned ${entry.kind}: ${entry.filename}${offset ? ' (resuming)' : ''}\n`);
  let response = await fetch(entry.url, { redirect: 'follow', headers: offset ? { Range: `bytes=${offset}-` } : {} });
  if (response.status === 416 && offset > 0) {
    fs.renameSync(partial, `${partial}.invalid.${Date.now()}`);
    offset = 0;
    response = await fetch(entry.url, { redirect: 'follow' });
  }
  if (!response.ok || !response.body || new URL(response.url).protocol !== 'https:') throw new Error(`Download failed for ${entry.id}: HTTP ${response.status}`);
  const append = offset > 0 && response.status === 206;
  if (!append) offset = 0;
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  const total = offset + contentLength;
  let received = offset;
  let lastReport = 0;
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (Date.now() - lastReport > 2_000) {
        lastReport = Date.now();
        const percent = total ? ` ${Math.min(100, Math.floor(received / total * 100))}%` : '';
        process.stdout.write(`  ${(received / 1024 / 1024).toFixed(0)} MiB${percent}\n`);
      }
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(partial, { flags: append ? 'a' : 'w', mode: 0o600 }));
  if (await sha256(partial) !== entry.sha256) {
    fs.renameSync(partial, `${partial}.invalid.${Date.now()}`);
    throw new Error(`SHA-256 verification failed for ${entry.id}.`);
  }
  fs.renameSync(partial, target);
  process.stdout.write(`Verified ${entry.kind}: ${entry.sha256}\n`);
  return target;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false, stdio: options.stdio ?? 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with code ${code}.`)));
  });
}

function findLlama(directory) {
  const names = new Set(process.platform === 'win32' ? ['llama-server.exe', 'server.exe'] : ['llama-server', 'server']);
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    if (!current) break;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile() && names.has(entry.name)) return candidate;
    }
  }
  return null;
}

async function extractLlama(entry, archive, root) {
  ensureParent(root, `.cache/dev-ai/llama/${entry.id}.placeholder`);
  const destination = path.resolve(root, '.cache', 'dev-ai', 'llama', entry.id);
  if (fs.existsSync(destination)) {
    const existing = findLlama(destination);
    if (existing) return existing;
    fs.renameSync(destination, `${destination}.invalid.${Date.now()}`);
  }
  const temporary = `${destination}.extract.${process.pid}`;
  fs.mkdirSync(temporary, { recursive: false, mode: 0o700 });
  try {
    await run(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xf', archive, '-C', temporary]);
    const executable = findLlama(temporary);
    if (!executable) throw new Error('The verified llama archive does not contain llama-server.');
    fs.renameSync(temporary, destination);
    const installed = findLlama(destination);
    if (!installed) throw new Error('Could not install llama-server.');
    if (process.platform !== 'win32') fs.chmodSync(installed, 0o700);
    return installed;
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function ensureDevAiArtifacts(root = scriptRoot) {
  const selected = selectedDevAiArtifacts(root);
  process.stdout.write('First AI setup may download about 4.5 GB. Downloads are pinned, resumable, and SHA-256 verified.\n');
  const model = await download(selected.model, root);
  const archive = await download(selected.llama, root);
  const llama = await extractLlama(selected.llama, archive, root);
  return { model, llama };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--dry-run')) {
    const selected = selectedDevAiArtifacts();
    process.stdout.write(`${selected.platform}: ${selected.llama.filename} + ${selected.model.filename}\n`);
  } else {
    ensureDevAiArtifacts().then(({ model, llama }) => process.stdout.write(`AI files ready:\n${llama}\n${model}\n`)).catch((error) => {
      process.stderr.write(`AI setup failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
