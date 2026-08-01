import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../../server/db.mjs';
import { runtimePaths } from '../../server/paths.mjs';

export function temporaryDatabase(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-backend-'));
  const paths = runtimePaths({ root });
  const db = openDatabase(paths);
  t.after(() => {
    try { db.close(); } catch { /* Already closed. */ }
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, paths, db };
}
