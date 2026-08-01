#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const archive = path.resolve(process.argv[2] ?? "");
if (!process.argv[2] || !fs.existsSync(archive)) {
  console.error("Usage: fix-zip-permissions.mjs ARCHIVE.zip");
  process.exit(2);
}

const EOCD = 0x06054b50;
const ZIP64_EOCD = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;
const CENTRAL_FILE = 0x02014b50;
const file = fs.openSync(archive, "r+");

function readExactly(length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const count = fs.readSync(file, buffer, offset, length - offset, position + offset);
    if (!count) throw new Error(`Unexpected end of ZIP at byte ${position + offset}`);
    offset += count;
  }
  return buffer;
}

function writeExactly(buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    offset += fs.writeSync(file, buffer, offset, buffer.length - offset, position + offset);
  }
}

function lastSignature(buffer, signature, before = buffer.length) {
  for (let index = before - 4; index >= 0; index -= 1) {
    if (buffer.readUInt32LE(index) === signature) return index;
  }
  return -1;
}

try {
  const size = fs.fstatSync(file).size;
  const tailLength = Math.min(size, 65_557);
  const tailStart = size - tailLength;
  const tail = readExactly(tailLength, tailStart);
  const eocdIndex = lastSignature(tail, EOCD);
  if (eocdIndex < 0) throw new Error("ZIP end-of-central-directory record is missing");
  const eocd = tail.subarray(eocdIndex);
  if (eocd.length < 22 || eocd.readUInt16LE(20) !== eocd.length - 22) throw new Error("Malformed ZIP end record");
  if (eocd.readUInt16LE(4) !== 0 || eocd.readUInt16LE(6) !== 0) throw new Error("Split ZIP archives are not supported");

  let centralSize = eocd.readUInt32LE(12);
  let centralOffset = eocd.readUInt32LE(16);
  if (centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    const locatorIndex = lastSignature(tail, ZIP64_LOCATOR, eocdIndex);
    if (locatorIndex < 0 || locatorIndex + 20 > tail.length) throw new Error("ZIP64 locator is missing");
    const zip64Offset = Number(tail.readBigUInt64LE(locatorIndex + 8));
    if (!Number.isSafeInteger(zip64Offset)) throw new Error("ZIP64 central directory offset is too large");
    const zip64 = readExactly(56, zip64Offset);
    if (zip64.readUInt32LE(0) !== ZIP64_EOCD) throw new Error("ZIP64 end record is missing");
    centralSize = Number(zip64.readBigUInt64LE(40));
    centralOffset = Number(zip64.readBigUInt64LE(48));
  }
  if (!Number.isSafeInteger(centralSize) || !Number.isSafeInteger(centralOffset) || centralSize < 0 || centralOffset < 0 || centralOffset + centralSize > size) {
    throw new Error("Invalid ZIP central-directory bounds");
  }

  const central = readExactly(centralSize, centralOffset);
  let cursor = 0;
  let entries = 0;
  let executables = 0;
  while (cursor < central.length) {
    if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== CENTRAL_FILE) throw new Error(`Malformed central directory at byte ${centralOffset + cursor}`);
    const nameLength = central.readUInt16LE(cursor + 28);
    const extraLength = central.readUInt16LE(cursor + 30);
    const commentLength = central.readUInt16LE(cursor + 32);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > central.length) throw new Error("Truncated ZIP central-directory entry");
    const name = central.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8").replaceAll("\\", "/");
    const directory = name.endsWith("/");
    const executable = !directory && (name.endsWith(".command") || name.endsWith(".sh") || name.endsWith(".mjs") || name.endsWith(".py") || name.endsWith("/scripts/prepare_release"));
    const unixMode = directory ? 0o040755 : executable ? 0o100755 : 0o100644;
    const dosAttributes = directory ? 0x10 : 0;
    central[cursor + 5] = 3; // ZIP "version made by" host: Unix.
    central.writeUInt32LE((((unixMode << 16) >>> 0) | dosAttributes) >>> 0, cursor + 38);
    entries += 1;
    if (executable) executables += 1;
    cursor = next;
  }
  if (cursor !== central.length || entries === 0) throw new Error("ZIP central directory is empty or misaligned");
  writeExactly(central, centralOffset);
  console.log(`ZIP permissions: ${entries} entries normalized, ${executables} executable files.`);
} catch (error) {
  console.error(`FEL / ERROR: ZIP permissions could not be normalized: ${error.message}`);
  process.exitCode = 1;
} finally {
  fs.closeSync(file);
}
