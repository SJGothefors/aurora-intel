import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APPLICATION_EXPORT_FOLDER, verifyReleaseOutput } from '../scripts/verify-release-output.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED = [
  'README.md', 'RELEASE_READY.txt', 'checksums.txt', 'package.json',
  'build.command', 'build.bat', 'start.command', 'start.bat',
];

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}

function storedZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, raw] of entries) {
    const filename = Buffer.from(name);
    const body = Buffer.from(raw);
    const crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(filename.length, 26);
    localParts.push(local, filename, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, filename);
    offset += local.length + filename.length + body.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function fixture(t, { version = '0.1.0-alpha', omittedArchiveFile } = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-release-test-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const output = path.join(temporary, APPLICATION_EXPORT_FOLDER);
  const releaseName = `aurora-intel-v${version}-offline`;
  const release = path.join(output, releaseName);
  fs.mkdirSync(release, { recursive: true });
  for (const relative of REQUIRED) fs.writeFileSync(path.join(release, relative), `${relative}\n`);
  const entries = REQUIRED.filter((relative) => relative !== omittedArchiveFile)
    .map((relative) => [`${releaseName}/${relative}`, `${relative}\n`]);
  const archive = path.join(output, `${releaseName}.zip`);
  fs.writeFileSync(archive, storedZip(entries));
  const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(path.join(output, 'checksums.txt'), `${digest}  ${path.basename(archive)}\n`);
  return { output, archive, version };
}

test('release output verifier accepts a complete ZIP and matching transport checksum', async (t) => {
  const input = fixture(t);
  const result = await verifyReleaseOutput(input.output, input.version);
  assert.equal(result.archive, input.archive);
  assert.equal(result.entries, REQUIRED.length);
});

test('release output verifier rejects checksum mismatches', async (t) => {
  const input = fixture(t);
  const archive = fs.readFileSync(input.archive);
  const firstNameLength = archive.readUInt16LE(26);
  archive[30 + firstNameLength] ^= 1;
  fs.writeFileSync(input.archive, archive);
  await assert.rejects(verifyReleaseOutput(input.output, input.version), /SHA-256 does not match/);
});

test('release output verifier rejects a ZIP missing a required launcher', async (t) => {
  const input = fixture(t, { omittedArchiveFile: 'start.bat' });
  await assert.rejects(verifyReleaseOutput(input.output, input.version), /start\.bat/);
});

test('macOS and Windows release scripts share the explicit export-folder and verifier contract', () => {
  const shell = fs.readFileSync(path.join(root, 'scripts', 'prepare_release.sh'), 'utf8');
  const powershell = fs.readFileSync(path.join(root, 'scripts', 'prepare_release.ps1'), 'utf8');
  assert.match(shell, /AURORA_ROOT\/applicationExportFolder/);
  assert.match(powershell, /Join-Path \$root 'applicationExportFolder'/);
  assert.match(shell, /verify-release-output\.mjs/);
  assert.match(powershell, /verify-release-output\.mjs/);
  assert.match(execFileSync('sh', ['scripts/prepare_release.sh', '--help'], { cwd: root, encoding: 'utf8' }), /Usage:/);
});
