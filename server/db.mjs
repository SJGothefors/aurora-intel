import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ensureDataDirectories } from './paths.mjs';
import { seedVocabulary } from './vocabulary.mjs';

export function openDatabase(paths, { readonly = false, seed = true } = {}) {
  ensureDataDirectories(paths);
  const db = new DatabaseSync(paths.dbPath, {
    open: true,
    readOnly: readonly,
    enableForeignKeyConstraints: true,
  });
  configureDatabase(db, { readonly });
  if (!readonly) {
    migrateDatabase(db, paths.migrationsDir);
    if (seed) seedVocabulary(db);
  }
  return db;
}

export function configureDatabase(db, { readonly = false } = {}) {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (!readonly) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA wal_autocheckpoint = 1000');
  }
}

export function migrateDatabase(db, migrationsDir) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version));
  const filenames = fs.readdirSync(migrationsDir)
    .filter((filename) => /^\d+.*\.sql$/i.test(filename))
    .sort((a, b) => a.localeCompare(b, 'en'));
  for (const filename of filenames) {
    if (applied.has(filename)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(filename, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${filename} failed: ${error.message}`, { cause: error });
    }
  }
}

export function withTransaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function databaseStatus(db) {
  const quickCheck = db.prepare('PRAGMA quick_check').get();
  const migrations = db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all();
  return {
    ok: Object.values(quickCheck)[0] === 'ok',
    quickCheck: Object.values(quickCheck)[0],
    migrations,
    cases: Number(db.prepare('SELECT count(*) AS count FROM cases').get().count),
  };
}
