#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`Invalid supervisor argument: ${key ?? ""}`);
    result[key.slice(2)] = value;
  }
  return result;
}

const options = parseArgs(process.argv.slice(2));
for (const required of ["root", "node", "server", "llama", "model", "app-port", "llm-port", "data-dir"]) {
  if (!options[required]) throw new Error(`Missing --${required}`);
}
const root = path.resolve(options.root);
const dataDir = path.resolve(options["data-dir"]);
if (dataDir !== path.join(root, "data")) throw new Error("--data-dir must be the root data directory");

function ensureRealDirectory(directory) {
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe mutable directory: ${directory}`);
  try { fs.chmodSync(directory, 0o700); } catch { /* Windows ACLs are managed by the OS. */ }
}

ensureRealDirectory(dataDir);
const logs = path.join(dataDir, "logs");
ensureRealDirectory(logs);
const children = new Map();
let stopping = false;
const llamaFailureTimes = [];
let llamaRestartTimer;
const llmApiKey = randomBytes(32).toString("hex");
const appToken = randomBytes(32).toString("hex");
const logSizeLimit = 10 * 1024 * 1024;
const logFileCount = 5;
const llamaFailureLimit = 5;
const llamaFailureWindowMs = 2 * 60 * 1000;

const inheritedEnvironmentKeys = process.platform === "win32"
  ? ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "ProgramFiles", "ProgramFiles(x86)", "CommonProgramFiles", "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "LANG", "LC_ALL", "TZ"]
  : ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TZ"];

function childEnvironment(extra) {
  const environment = {};
  for (const key of inheritedEnvironmentKeys) {
    const value = process.env[key];
    if (typeof value === "string" && value) environment[key] = value;
  }
  return { ...environment, ...extra };
}

function writeAtomic(file, value) {
  const temporary = `${file}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
    fs.writeFileSync(descriptor, value, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    try {
      const current = fs.lstatSync(file);
      if (current.isDirectory()) throw new Error(`Refusing to replace directory: ${file}`);
      fs.unlinkSync(file);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    fs.renameSync(temporary, file);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch { /* Nothing to clean up. */ }
    throw error;
  }
}

function pidFile(name) {
  return path.join(logs, `${name}.pid`);
}

const sessionTokenFile = path.join(logs, "session.token");

function appendLog(name) {
  const filename = path.join(logs, `${name}.log`);
  try {
    const existing = fs.lstatSync(filename);
    if (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1) throw new Error(`Unsafe log file: ${filename}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const descriptor = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  const opened = fs.fstatSync(descriptor);
  if (!opened.isFile() || opened.nlink !== 1) {
    fs.closeSync(descriptor);
    throw new Error(`Unsafe log file: ${filename}`);
  }
  try { fs.fchmodSync(descriptor, 0o600); } catch { /* Windows ACLs are managed by the OS. */ }
  return descriptor;
}

function safeLogEntry(filename) {
  try {
    const stat = fs.lstatSync(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error(`Unsafe log file: ${filename}`);
    return stat;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function rotateLog(name) {
  const base = path.join(logs, `${name}.log`);
  safeLogEntry(base);
  for (let index = logFileCount - 1; index >= 1; index -= 1) {
    const target = `${base}.${index}`;
    const source = index === 1 ? base : `${base}.${index - 1}`;
    const targetStat = safeLogEntry(target);
    if (targetStat) fs.unlinkSync(target);
    if (safeLogEntry(source)) fs.renameSync(source, target);
  }
}

function appendRotating(name, value) {
  const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  const filename = path.join(logs, `${name}.log`);
  const current = safeLogEntry(filename);
  if (current && current.size > 0 && current.size + chunk.length > logSizeLimit) rotateLog(name);
  const descriptor = appendLog(name);
  try { fs.writeFileSync(descriptor, chunk); }
  finally { fs.closeSync(descriptor); }
}

function appendSupervisor(message) {
  appendRotating("supervisor", message);
}

function captureChildOutput(child, name) {
  child.stdout.on("data", (chunk) => appendRotating(name, chunk));
  child.stderr.on("data", (chunk) => appendRotating(name, chunk));
}

function writeLlamaStatus(status, details = {}) {
  writeAtomic(path.join(logs, "llama-status.json"), `${JSON.stringify({ status, at: new Date().toISOString(), ...details }, null, 2)}\n`);
}

function spawnApp() {
  const args = [
    path.resolve(options.server),
    "--host", "127.0.0.1",
    "--port", options["app-port"],
    "--llm-port", options["llm-port"],
    "--data-dir", path.resolve(options["data-dir"]),
    "--root", root
  ];
  const child = spawn(path.resolve(options.node), args, {
    cwd: root,
    env: childEnvironment({ AURORA_ROOT: root, AURORA_DATA_DIR: dataDir, AURORA_PORT: options["app-port"], AURORA_LLM_PORT: options["llm-port"], AURORA_LLM_API_KEY: llmApiKey, AURORA_APP_TOKEN: appToken }),
    detached: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  captureChildOutput(child, "app");
  children.set("app", child);
  writeAtomic(pidFile("app"), `${child.pid}\n`);
  child.once("exit", (code, signal) => {
    children.delete("app");
    if (!stopping) {
      appendSupervisor(`App exited unexpectedly (code=${code}, signal=${signal}); supervisor is stopping.\n`);
      shutdown(1);
    }
  });
}

function spawnLlama() {
  if (stopping) return;
  const isWindows = process.platform === "win32";
  const args = [
    "--host", "127.0.0.1",
    "--port", options["llm-port"],
    "--model", path.resolve(options.model),
    "--ctx-size", options["context-size"] ?? "8192",
    "--seed", options.seed ?? "4242",
    "--n-gpu-layers", isWindows ? "0" : "99"
  ];
  const child = spawn(path.resolve(options.llama), args, {
    cwd: path.dirname(path.resolve(options.llama)),
    env: childEnvironment({ LLAMA_API_KEY: llmApiKey }),
    detached: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  captureChildOutput(child, "llama");
  children.set("llama", child);
  writeAtomic(pidFile("llama"), `${child.pid}\n`);
  writeLlamaStatus("starting", { pid: child.pid, failuresInWindow: llamaFailureTimes.length });
  child.once("exit", (code, signal) => {
    children.delete("llama");
    if (stopping) return;
    const now = Date.now();
    while (llamaFailureTimes.length && llamaFailureTimes[0] < now - llamaFailureWindowMs) llamaFailureTimes.shift();
    llamaFailureTimes.push(now);
    if (llamaFailureTimes.length >= llamaFailureLimit) {
      const message = `llama-server circuit open after ${llamaFailureTimes.length} exits in ${llamaFailureWindowMs / 1000} seconds; automatic restart stopped. Run stop/start after correcting the model/runtime.\n`;
      appendSupervisor(message);
      writeLlamaStatus("circuit-open", { failuresInWindow: llamaFailureTimes.length, windowSeconds: llamaFailureWindowMs / 1000, lastExitCode: code, lastSignal: signal, message: "Automatic restart stopped; run stop/start after correcting the model/runtime." });
      return;
    }
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(llamaFailureTimes.length - 1, 5));
    appendSupervisor(`llama-server exited (code=${code}, signal=${signal}); restart in ${delay} ms (${llamaFailureTimes.length}/${llamaFailureLimit} failures in window).\n`);
    writeLlamaStatus("restart-wait", { failuresInWindow: llamaFailureTimes.length, failureLimit: llamaFailureLimit, delayMs: delay, lastExitCode: code, lastSignal: signal });
    llamaRestartTimer = setTimeout(spawnLlama, delay);
  });
}

function removeOwnPid(name, expected) {
  const file = pidFile(name);
  try {
    if (fs.readFileSync(file, "utf8").trim() === String(expected)) fs.unlinkSync(file);
  } catch {}
}

function removeOwnSession(expected) {
  let descriptor;
  try {
    const before = fs.lstatSync(sessionTokenFile);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) return;
    descriptor = fs.openSync(sessionTokenFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1) return;
    const value = fs.readFileSync(descriptor, "utf8").trim();
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (value === expected) fs.unlinkSync(sessionTokenFile);
  } catch { /* The next start safely replaces stale mutable state. */ }
  finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (llamaRestartTimer) clearTimeout(llamaRestartTimer);
  for (const child of children.values()) {
    if (!child.killed) child.kill("SIGTERM");
  }
  const deadline = setTimeout(() => {
    for (const child of children.values()) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 8000);
  deadline.unref();
  Promise.all([...children.entries()].map(([name, child]) => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", () => { removeOwnPid(name, child.pid); resolve(); });
  }))).finally(() => {
    removeOwnPid("supervisor", process.pid);
    removeOwnSession(appToken);
    process.exit(exitCode);
  });
}

writeAtomic(sessionTokenFile, `${appToken}\n`);
writeAtomic(pidFile("supervisor"), `${process.pid}\n`);
writeAtomic(path.join(logs, "state.json"), `${JSON.stringify({
  pid: process.pid,
  host: "127.0.0.1",
  appPort: Number(options["app-port"]),
  llmPort: Number(options["llm-port"]),
  url: `http://127.0.0.1:${options["app-port"]}`,
  startedAt: new Date().toISOString()
}, null, 2)}\n`);
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
process.on("uncaughtException", (error) => {
  try { appendSupervisor(`${new Date().toISOString()} ${error.stack ?? error}\n`); } catch { /* Preserve the original failure. */ }
  shutdown(1);
});
spawnLlama();
spawnApp();
