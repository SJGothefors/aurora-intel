import fs from 'node:fs';
import path from 'node:path';
import { writeWorkbook } from './transfer.mjs';

function timestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

export async function createBackup(db, paths, { keep = 20, now } = {}) {
  fs.mkdirSync(paths.backupDir, { recursive: true });
  const filename = path.join(paths.backupDir, `aurora-${timestamp(now ? new Date(now) : new Date())}.xlsx`);
  await writeWorkbook(db, filename);
  const backups = fs.readdirSync(paths.backupDir)
    .filter((name) => /^aurora-\d{8}-\d{6}(?:-\d+)?\.xlsx$/i.test(name))
    .sort()
    .reverse();
  for (const stale of backups.slice(Math.max(1, keep))) fs.unlinkSync(path.join(paths.backupDir, stale));
  return filename;
}

export function startBackupRotation(db, paths, options = {}) {
  const intervalMin = Math.max(1, Number(options.intervalMin) || 30);
  let running = false;
  const run = async () => {
    if (running) return null;
    running = true;
    try {
      return await createBackup(db, paths, options);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    run().catch((error) => options.onError?.(error));
  }, intervalMin * 60_000);
  timer.unref?.();
  return { run, stop: () => clearInterval(timer) };
}
