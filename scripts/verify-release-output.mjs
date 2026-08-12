#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const APPLICATION_EXPORT_FOLDER = 'applicationExportFolder';
const EOCD = 0x06054b50;
const ZIP64_EOCD = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;
const CENTRAL_FILE = 0x02014b50;
const REQUIRED_RELEASE_FILES = [
  'README.md', 'RELEASE_READY.txt', 'checksums.txt', 'package.json',
  'build.command', 'build.bat', 'start.command', 'start.bat',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readExactly(descriptor, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const count = fs.readSync(descriptor, buffer, offset, length - offset, position + offset);
    if (!count) throw new Error(`Unexpected end of ZIP at byte ${position + offset}`);
    offset += count;
  }
  return buffer;
}

function lastSignature(buffer, signature, before = buffer.length) {
  for (let index = before - 4; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === signature) return index;
  }
  return -1;
}

export function zipEntryNames(archive) {
  const descriptor = fs.openSync(archive, 'r');
  try {
    const size = fs.fstatSync(descriptor).size;
    assert(size >= 22, 'ZIP archive is empty or truncated');
    const tailLength = Math.min(size, 65_557);
    const tailStart = size - tailLength;
    const tail = readExactly(descriptor, tailLength, tailStart);
    const eocdIndex = lastSignature(tail, EOCD);
    assert(eocdIndex >= 0, 'ZIP end-of-central-directory record is missing');
    const eocd = tail.subarray(eocdIndex);
    assert(eocd.length >= 22 && eocd.readUInt16LE(20) === eocd.length - 22, 'Malformed ZIP end record');
    assert(eocd.readUInt16LE(4) === 0 && eocd.readUInt16LE(6) === 0, 'Split ZIP archives are not supported');

    let centralSize = eocd.readUInt32LE(12);
    let centralOffset = eocd.readUInt32LE(16);
    if (centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      const locatorIndex = lastSignature(tail, ZIP64_LOCATOR, eocdIndex);
      assert(locatorIndex >= 0 && locatorIndex + 20 <= tail.length, 'ZIP64 locator is missing');
      const zip64Offset = Number(tail.readBigUInt64LE(locatorIndex + 8));
      assert(Number.isSafeInteger(zip64Offset), 'ZIP64 central-directory offset is too large');
      const zip64 = readExactly(descriptor, 56, zip64Offset);
      assert(zip64.readUInt32LE(0) === ZIP64_EOCD, 'ZIP64 end record is missing');
      centralSize = Number(zip64.readBigUInt64LE(40));
      centralOffset = Number(zip64.readBigUInt64LE(48));
    }
    assert(Number.isSafeInteger(centralSize) && Number.isSafeInteger(centralOffset)
      && centralSize > 0 && centralOffset >= 0 && centralOffset + centralSize <= size,
    'Invalid ZIP central-directory bounds');

    const central = readExactly(descriptor, centralSize, centralOffset);
    const names = [];
    const seen = new Set();
    let cursor = 0;
    while (cursor < central.length) {
      assert(cursor + 46 <= central.length && central.readUInt32LE(cursor) === CENTRAL_FILE,
        `Malformed central directory at byte ${centralOffset + cursor}`);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentLength = central.readUInt16LE(cursor + 32);
      const next = cursor + 46 + nameLength + extraLength + commentLength;
      assert(next <= central.length, 'Truncated ZIP central-directory entry');
      const name = central.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
      assert(name && !name.includes('\\') && !name.startsWith('/') && !/^[A-Za-z]:/.test(name), `Unsafe ZIP path: ${name}`);
      assert(!name.split('/').includes('..'), `Unsafe ZIP parent path: ${name}`);
      assert(!seen.has(name), `Duplicate ZIP entry: ${name}`);
      seen.add(name);
      names.push(name);
      cursor = next;
    }
    assert(cursor === central.length && names.length > 0, 'ZIP central directory is empty or misaligned');
    return names;
  } finally {
    fs.closeSync(descriptor);
  }
}

async function sha256(filename) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

export async function verifyReleaseOutput(outputDirectory, version) {
  assert(typeof version === 'string' && /^[0-9A-Za-z][0-9A-Za-z._-]*$/.test(version), 'Release version is invalid');
  const output = path.resolve(outputDirectory);
  assert(path.basename(output) === APPLICATION_EXPORT_FOLDER,
    `Release output folder must be named ${APPLICATION_EXPORT_FOLDER}`);
  const releaseName = `aurora-intel-v${version}-offline`;
  const releaseDirectory = path.join(output, releaseName);
  const archive = path.join(output, `${releaseName}.zip`);
  const outerChecksums = path.join(output, 'checksums.txt');
  assert(fs.statSync(releaseDirectory, { throwIfNoEntry: false })?.isDirectory(), `Release folder is missing: ${releaseName}`);
  for (const relative of REQUIRED_RELEASE_FILES) {
    const filename = path.join(releaseDirectory, relative);
    assert(fs.statSync(filename, { throwIfNoEntry: false })?.isFile() && fs.statSync(filename).size > 0,
      `Required release file is missing or empty: ${relative}`);
  }
  assert(fs.statSync(archive, { throwIfNoEntry: false })?.isFile() && fs.statSync(archive).size > 0,
    `Release ZIP is missing or empty: ${path.basename(archive)}`);
  const entries = new Set(zipEntryNames(archive));
  for (const relative of REQUIRED_RELEASE_FILES) {
    assert(entries.has(`${releaseName}/${relative}`), `Required file is missing from release ZIP: ${relative}`);
  }
  const checksumText = fs.readFileSync(outerChecksums, 'utf8').trim();
  const match = checksumText.match(/^([0-9a-f]{64})  ([^/\\]+)$/);
  assert(match && match[2] === path.basename(archive), 'Outer checksums.txt has an invalid archive record');
  const actual = await sha256(archive);
  assert(actual === match[1], 'Release ZIP SHA-256 does not match outer checksums.txt');
  return { releaseDirectory, archive, sha256: actual, entries: entries.size };
}

async function main() {
  const [, , outputDirectory, version] = process.argv;
  if (!outputDirectory || !version) throw new Error('Usage: verify-release-output.mjs OUTPUT_DIRECTORY VERSION');
  const result = await verifyReleaseOutput(outputDirectory, version);
  process.stdout.write(`Release output verified: ${path.basename(result.archive)} (${result.entries} ZIP entries, SHA-256 ${result.sha256})\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`FEL / ERROR: ${error.message}\n`); process.exitCode = 1; });
}
