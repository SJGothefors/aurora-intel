#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? ".");
const output = path.join(root, "checksums.txt");
const excludedTop = new Set([".runtime", ".cache", ".git", "data", "exports", "node_modules", "release"]);
const excludedFiles = new Set(["checksums.txt", "config/app.local.json"]);
const files = [];
const portablePath = /^[A-Za-z0-9._/@+\-]+$/;

function walk(directory, relative = "") {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (!relative && excludedTop.has(entry.name)) continue;
    if (excludedFiles.has(rel)) continue;
    if (!portablePath.test(rel) || rel.includes("//") || rel.split("/").includes("..")) {
      throw new Error(`Release path is not portable or manifest-safe: ${JSON.stringify(rel)}`);
    }
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, rel);
    else if (entry.isFile()) {
      const stat = fs.statSync(absolute);
      if (stat.nlink !== 1) throw new Error(`Release may not contain hard-linked files: ${rel}`);
      files.push({ absolute, rel });
    }
    else if (entry.isSymbolicLink()) throw new Error(`Release may not contain symbolic links: ${rel}`);
    else throw new Error(`Release may not contain special files: ${rel}`);
  }
}
walk(root);
const lines = [];
function hashFile(filename) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filename);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
for (const { absolute, rel } of files) {
  const hash = await hashFile(absolute);
  lines.push(`${hash}  ${rel}`);
}
fs.writeFileSync(output, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o644 });
console.log(`Wrote ${files.length} checksums.`);
