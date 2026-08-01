PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lopnr INTEGER NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Ny' CHECK (status IN ('Ny', 'Under bearbetning', 'Uppföljning', 'Avslutad')),
  star INTEGER NOT NULL DEFAULT 0 CHECK (star IN (0, 1)),
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags) AND json_type(tags) = 'array'),
  begrepp TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(begrepp) AND json_type(begrepp) = 'array'),
  aktor TEXT NOT NULL DEFAULT 'Okänd' CHECK (aktor IN ('Okänd', 'Misstänkt främmande', 'Civil', 'Egen')),
  dtg_raw TEXT,
  time_utc TEXT,
  time_uncertain INTEGER NOT NULL DEFAULT 0 CHECK (time_uncertain IN (0, 1)),
  place_raw TEXT,
  place_name TEXT,
  mgrs TEXT,
  lat REAL CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90)),
  lon REAL CHECK (lon IS NULL OR (lon >= -180 AND lon <= 180)),
  position_missing INTEGER NOT NULL DEFAULT 1 CHECK (position_missing IN (0, 1)),
  styrka_raw TEXT,
  count_min INTEGER CHECK (count_min IS NULL OR count_min >= 0),
  count_max INTEGER CHECK (count_max IS NULL OR count_max >= 0),
  slag TEXT,
  sysselsattning TEXT,
  symbol TEXT,
  sagesman TEXT,
  kallrapport_raw TEXT,
  ai_json TEXT CHECK (ai_json IS NULL OR json_valid(ai_json)),
  bedomning TEXT,
  fields_uncertain TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(fields_uncertain) AND json_type(fields_uncertain) = 'array'),
  CHECK (count_min IS NULL OR count_max IS NULL OR count_min <= count_max),
  CHECK (
    (position_missing = 1)
    OR (mgrs IS NOT NULL AND lat IS NOT NULL AND lon IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_cases_lopnr ON cases(lopnr);
CREATE INDEX IF NOT EXISTS idx_cases_time ON cases(time_utc);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_aktor ON cases(aktor);
CREATE INDEX IF NOT EXISTS idx_cases_star ON cases(star);
CREATE INDEX IF NOT EXISTS idx_cases_position_missing ON cases(position_missing);
CREATE INDEX IF NOT EXISTS idx_cases_mgrs ON cases(mgrs);

CREATE VIRTUAL TABLE IF NOT EXISTS cases_fts USING fts5(
  created_by,
  status,
  tags,
  begrepp,
  aktor,
  dtg_raw,
  time_utc,
  place_raw,
  place_name,
  mgrs,
  styrka_raw,
  slag,
  sysselsattning,
  symbol,
  sagesman,
  kallrapport_raw,
  ai_json,
  bedomning,
  fields_uncertain,
  content='cases',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS cases_fts_insert AFTER INSERT ON cases BEGIN
  INSERT INTO cases_fts(
    rowid, created_by, status, tags, begrepp, aktor, dtg_raw, time_utc, place_raw, place_name,
    mgrs, styrka_raw, slag, sysselsattning, symbol, sagesman,
    kallrapport_raw, ai_json, bedomning, fields_uncertain
  ) VALUES (
    new.id, new.created_by, new.status, new.tags, new.begrepp, new.aktor, new.dtg_raw,
    new.time_utc, new.place_raw, new.place_name, new.mgrs, new.styrka_raw, new.slag,
    new.sysselsattning, new.symbol, new.sagesman, new.kallrapport_raw,
    new.ai_json, new.bedomning, new.fields_uncertain
  );
END;

CREATE TRIGGER IF NOT EXISTS cases_fts_delete AFTER DELETE ON cases BEGIN
  INSERT INTO cases_fts(
    cases_fts, rowid, created_by, status, tags, begrepp, aktor, dtg_raw, time_utc, place_raw,
    place_name, mgrs, styrka_raw, slag, sysselsattning, symbol, sagesman,
    kallrapport_raw, ai_json, bedomning, fields_uncertain
  ) VALUES (
    'delete', old.id, old.created_by, old.status, old.tags, old.begrepp, old.aktor,
    old.dtg_raw, old.time_utc, old.place_raw, old.place_name, old.mgrs, old.styrka_raw,
    old.slag, old.sysselsattning, old.symbol, old.sagesman,
    old.kallrapport_raw, old.ai_json, old.bedomning, old.fields_uncertain
  );
END;

CREATE TRIGGER IF NOT EXISTS cases_fts_update AFTER UPDATE ON cases BEGIN
  INSERT INTO cases_fts(
    cases_fts, rowid, created_by, status, tags, begrepp, aktor, dtg_raw, time_utc, place_raw,
    place_name, mgrs, styrka_raw, slag, sysselsattning, symbol, sagesman,
    kallrapport_raw, ai_json, bedomning, fields_uncertain
  ) VALUES (
    'delete', old.id, old.created_by, old.status, old.tags, old.begrepp, old.aktor,
    old.dtg_raw, old.time_utc, old.place_raw, old.place_name, old.mgrs, old.styrka_raw,
    old.slag, old.sysselsattning, old.symbol, old.sagesman,
    old.kallrapport_raw, old.ai_json, old.bedomning, old.fields_uncertain
  );
  INSERT INTO cases_fts(
    rowid, created_by, status, tags, begrepp, aktor, dtg_raw, time_utc, place_raw, place_name,
    mgrs, styrka_raw, slag, sysselsattning, symbol, sagesman,
    kallrapport_raw, ai_json, bedomning, fields_uncertain
  ) VALUES (
    new.id, new.created_by, new.status, new.tags, new.begrepp, new.aktor, new.dtg_raw,
    new.time_utc, new.place_raw, new.place_name, new.mgrs, new.styrka_raw, new.slag,
    new.sysselsattning, new.symbol, new.sagesman, new.kallrapport_raw,
    new.ai_json, new.bedomning, new.fields_uncertain
  );
END;

CREATE TABLE IF NOT EXISTS begrepp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name_sv TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name_en TEXT NOT NULL,
  definition TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sidc TEXT NOT NULL DEFAULT '10031000000000000000',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_begrepp_active_sort ON begrepp(active, sort, name_sv);

CREATE TRIGGER IF NOT EXISTS begrepp_unknown_stays_active
BEFORE UPDATE OF active ON begrepp
WHEN upper(old.name_sv) = 'ÖVRIGT/OKÄNT' AND new.active = 0
BEGIN
  SELECT RAISE(ABORT, 'VOCABULARY_FALLBACK_REQUIRED');
END;

CREATE TRIGGER IF NOT EXISTS begrepp_unknown_not_deleted
BEFORE DELETE ON begrepp
WHEN upper(old.name_sv) = 'ÖVRIGT/OKÄNT'
BEGIN
  SELECT RAISE(ABORT, 'VOCABULARY_FALLBACK_REQUIRED');
END;

CREATE TRIGGER IF NOT EXISTS begrepp_unknown_not_renamed
BEFORE UPDATE OF name_sv ON begrepp
WHEN upper(old.name_sv) = 'ÖVRIGT/OKÄNT' AND upper(new.name_sv) != 'ÖVRIGT/OKÄNT'
BEGIN
  SELECT RAISE(ABORT, 'VOCABULARY_FALLBACK_REQUIRED');
END;

CREATE TABLE IF NOT EXISTS spaningsfragor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question TEXT NOT NULL,
  motivering TEXT NOT NULL DEFAULT '',
  prioritet TEXT NOT NULL DEFAULT 'Medel' CHECK (prioritet IN ('Hög', 'Medel', 'Låg')),
  status TEXT NOT NULL DEFAULT 'Föreslagen' CHECK (status IN ('Föreslagen', 'Aktiv', 'Besvarad', 'Avförd')),
  linked_case_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(linked_case_ids) AND json_type(linked_case_ids) = 'array'),
  forslag_inhamtning TEXT,
  created_by TEXT NOT NULL DEFAULT 'user' CHECK (created_by IN ('AI', 'user')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spaningsfragor_status ON spaningsfragor(status);
CREATE INDEX IF NOT EXISTS idx_spaningsfragor_priority ON spaningsfragor(prioritet);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('case', 'begrepp', 'spaningsfraga')),
  entity_id INTEGER NOT NULL,
  ts TEXT NOT NULL,
  text TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes(entity_type, entity_id, ts);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid(value)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('extraction', 'questions', 'qa', 'assessment')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled')),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  result TEXT CHECK (result IS NULL OR json_valid(result)),
  error_code TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_jobs_status_created ON ai_jobs(status, created_at);
