#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [lockArg, cacheArg, npmCliArg] = process.argv.slice(2);
if (!lockArg || !cacheArg || !npmCliArg) {
  console.error("Usage: cache-packages.mjs PACKAGE_LOCK CACHE_DIR NPM_CLI_JS");
  process.exit(2);
}
const lock = JSON.parse(fs.readFileSync(lockArg, "utf8"));
const urls = new Set();
for (const metadata of Object.values(lock.packages ?? {})) {
  if (typeof metadata?.resolved === "string" && /^https:\/\//.test(metadata.resolved)) urls.add(metadata.resolved);
}
if (!urls.size) throw new Error("package-lock.json contains no resolved package URLs; regenerate it with a supported npm version");
fs.mkdirSync(cacheArg, { recursive: true });
let index = 0;
for (const url of [...urls].sort()) {
  index += 1;
  process.stdout.write(`Caching npm artifact ${index}/${urls.size}\r`);
  const result = spawnSync(process.execPath, [npmCliArg, "cache", "add", url, "--cache", path.resolve(cacheArg), "--no-audit", "--no-fund"], { stdio: ["ignore", "ignore", "inherit"] });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
process.stdout.write(`Cached ${urls.size} npm artifacts.                    \n`);
