#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logs = path.join(root, "data", "logs");
const tokenFile = path.join(logs, "session.token");
const [cleanUrl, outputArgument] = process.argv.slice(2);

function fail(message) {
  throw new Error(message);
}

if (!/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.test(cleanUrl ?? "")) fail("Invalid clean loopback URL");
const port = Number(new URL(cleanUrl).port);
if (!Number.isInteger(port) || port < 1 || port > 65535) fail("Invalid clean loopback port");

for (const directory of [path.join(root, "data"), logs]) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("Unsafe mutable directory");
}

const output = path.resolve(outputArgument ?? "");
if (path.dirname(output) !== logs || !/^\.aurora-session-[0-9]+\.html$/.test(path.basename(output))) fail("Unsafe bootstrap path");

let tokenDescriptor;
let token;
try {
  const before = fs.lstatSync(tokenFile);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) fail("Unsafe session token file");
  if (process.platform !== "win32" && (before.mode & 0o077) !== 0) fail("Session token file permissions are too broad");
  tokenDescriptor = fs.openSync(tokenFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  const opened = fs.fstatSync(tokenDescriptor);
  if (!opened.isFile() || opened.nlink !== 1) fail("Unsafe session token file");
  token = fs.readFileSync(tokenDescriptor, "utf8").trim();
} finally {
  if (tokenDescriptor !== undefined) fs.closeSync(tokenDescriptor);
}
if (!/^[0-9a-fA-F]{64}$/.test(token)) fail("Invalid session token file");

const target = `${cleanUrl}/?session=${token}`;
const html = `<!doctype html>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Aurora Intel</title>
<p>Opening Aurora Intel locally…</p>
<script>location.replace(${JSON.stringify(target)});</script>
`;

let outputDescriptor;
try {
  outputDescriptor = fs.openSync(output, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  fs.writeFileSync(outputDescriptor, html, "utf8");
  fs.fsyncSync(outputDescriptor);
  const opened = fs.fstatSync(outputDescriptor);
  if (!opened.isFile() || opened.nlink !== 1) fail("Unsafe bootstrap file");
  try { fs.fchmodSync(outputDescriptor, 0o600); } catch { /* Windows ACLs are inherited from the user's data directory. */ }
} catch (error) {
  try { fs.unlinkSync(output); } catch { /* Nothing to clean up. */ }
  throw error;
} finally {
  if (outputDescriptor !== undefined) fs.closeSync(outputDescriptor);
}
