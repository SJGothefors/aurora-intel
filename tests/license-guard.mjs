#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const allowed = /(?:^|\b)(?:MIT|ISC|BSD(?:-[234]-Clause)?|Apache-2\.0|OFL(?:-1\.1)?|CC0(?:-1\.0)?|Unlicense|Public Domain)(?:\b|$)/i;
const violations = [];

for (const [path, metadata] of Object.entries(lock.packages ?? {})) {
  if (!path || metadata.dev === true) continue;
  const license = metadata.license ?? '';
  if (!allowed.test(String(license))) {
    violations.push(`${path}: ${license || 'undeclared license'}`);
  }
}

if (violations.length) {
  console.error('Production dependency license guard failed:');
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log('License guard OK: production dependencies use allowed license families.');
