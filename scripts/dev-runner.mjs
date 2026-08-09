#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureDevAiArtifacts } from './dev-ai-setup.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const withAi = process.argv.includes('--ai');
const valueAfter = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'app.defaults.json'), 'utf8'));
const appPort = Number(valueAfter('--port') ?? config.appPort);
const llmPort = Number(valueAfter('--llm-port') ?? config.llmPort);
const children = new Set();
const llmKey = randomBytes(32).toString('hex');
const inheritedKeys = process.platform === 'win32'
  ? ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'TZ']
  : ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ'];
const baseEnvironment = Object.fromEntries(inheritedKeys.flatMap((key) => process.env[key] ? [[key, process.env[key]]] : []));

function launch(command, args, env = {}) {
  const child = spawn(command, args, { cwd: root, env: { ...baseEnvironment, ...env }, stdio: 'inherit', shell: false });
  children.add(child);
  child.once('error', (error) => {
    children.delete(child);
    process.stderr.write(`Could not start ${path.basename(command)}: ${error.message}\n`);
    shutdown(1);
  });
  child.once('exit', (code) => {
    children.delete(child);
    if (!stopping) shutdown(code ?? 1);
  });
  return child;
}

function checkedModel(candidate) {
  const filename = path.resolve(root, candidate);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || path.extname(filename).toLowerCase() !== '.gguf') throw new Error('The development model must be a regular, unlinked .gguf file.');
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const magic = Buffer.alloc(4);
    if (fs.readSync(descriptor, magic, 0, 4, 0) !== 4 || magic.toString('ascii') !== 'GGUF') throw new Error('The selected file is not a GGUF model.');
  } finally { fs.closeSync(descriptor); }
  return filename;
}

function findExecutable() {
  const names = process.platform === 'win32' ? ['llama-server.exe', 'server.exe'] : ['llama-server', 'server'];
  const pathNames = process.platform === 'win32' ? ['llama-server.exe'] : ['llama-server'];
  const direct = names.flatMap((name) => [path.join(root, 'llm', 'bin', name), path.join(root, '.runtime', 'llama', name)]);
  const pathCandidates = (baseEnvironment.PATH ?? '').split(path.delimiter).filter(Boolean).flatMap((directory) => pathNames.map((name) => path.join(directory, name)));
  for (const candidate of [...direct, ...pathCandidates]) {
    try {
      const stat = fs.lstatSync(candidate);
      if (stat.isFile() && !stat.isSymbolicLink()) return candidate;
    } catch { /* Try the next standard location. */ }
  }
  const runtimeRoot = path.join(root, '.runtime', 'llama');
  const pending = [runtimeRoot];
  while (pending.length) {
    const directory = pending.pop();
    if (!directory) break;
    try {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory()) pending.push(candidate);
        else if (entry.isFile() && names.includes(entry.name)) return candidate;
      }
    } catch { /* A prepared runtime is optional during development. */ }
  }
  return null;
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  if (children.size === 0) process.exit(code);
  for (const child of children) child.kill('SIGTERM');
  const timer = setTimeout(() => { for (const child of children) child.kill('SIGKILL'); }, 5_000);
  timer.unref();
  Promise.all([...children].map((child) => new Promise((resolve) => child.once('exit', resolve))))
    .finally(() => { process.exitCode = code; });
}

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));

if (withAi) {
  try {
    const modelCandidate = valueAfter('--model') ?? config.modelPath;
    let llama = valueAfter('--llama') ?? process.env.AURORA_LLAMA_BIN ?? findExecutable();
    let modelPath = path.resolve(root, modelCandidate);
    if ((!fs.existsSync(modelPath) && !valueAfter('--model')) || (!llama && !valueAfter('--llama') && !process.env.AURORA_LLAMA_BIN)) {
      const prepared = await ensureDevAiArtifacts(root);
      if (!fs.existsSync(modelPath)) modelPath = prepared.model;
      if (!llama) llama = prepared.llama;
    }
    const model = checkedModel(modelPath);
    if (!llama) throw new Error('Local AI engine not found.');
    launch(llama, ['--host', '127.0.0.1', '--port', String(llmPort), '--model', model, '--ctx-size', String(config.llm.contextSize), '--parallel', '1', '--seed', String(config.llm.seed)], { LLAMA_API_KEY: llmKey });
  } catch (error) {
    process.stderr.write(`Cannot start local AI: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

launch(process.execPath, ['server/index.mjs', '--port', String(appPort), '--llm-port', String(llmPort)], withAi ? { AURORA_LLM_API_KEY: llmKey } : {});
launch(process.execPath, ['node_modules/vite/bin/vite.js', 'web', '--config', 'web/vite.config.ts'], { AURORA_DEV_API_PORT: String(appPort) });
process.stdout.write(`Aurora development UI: http://127.0.0.1:5173 (${withAi ? 'local AI enabled' : 'AI disabled'})\n`);
