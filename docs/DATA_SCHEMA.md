# Aurora Intel data schema

SQLite is the source of truth. All mutable user state is below `data/`; deleting that directory removes the working database, mirrors, backups, logs, and PID files. Times are UTC ISO-8601 strings with millisecond precision where available. Booleans are SQLite integers constrained to `0` or `1`. JSON text must parse and is validated in application code before a transaction commits.

## Database lifecycle and invariants

- Database: `data/aurora.db`; WAL mode, foreign keys enabled, busy timeout configured.
- Migrations are ordered and transactional. `build` runs them with `server/index.mjs --migrate-only`; re-running is idempotent.
- Every domain write and the CSV mirror refresh occur as one application operation: commit SQLite first, then atomically replace `data/mirror/liggare.csv`. A mirror failure is surfaced and retried; it never rolls the database back silently.
- IDs are stable integers. `lopnr` is an auto-assigned, user-visible unique sequence and is never reused.
- `begrepp` values on a case must exist in `begrepp.name_sv`. New writes may use active values only. Deactivation preserves historical rows. `ÖVRIGT/OKÄNT` cannot be deactivated or deleted.
- `lat` and `lon` are both null or both finite/in range. `position_missing=1` exactly when a validated pair is absent. MGRS and WGS84 are normalized in application code, not trusted from an LLM.
- `count_min <= count_max` when both exist. Original strings remain in `*_raw`.
- AI output is draft data until explicit review/save. Raw JSON is retained in `ai_json` for traceability.

## `cases`

One row per händelse/ärende.

| Column | SQLite type | Null | Meaning |
|---|---:|:---:|---|
| `id` | INTEGER PK | no | Stable internal/citation ID. |
| `lopnr` | INTEGER UNIQUE | no | Monotonic display number. |
| `created_at`, `updated_at` | TEXT | no | UTC ISO timestamps. |
| `created_by` | TEXT | no | Operator name at creation; may be empty. |
| `status` | TEXT | no | `Ny`, `Under bearbetning`, `Uppföljning`, `Avslutad`. |
| `star` | INTEGER | no | `0`/`1`. |
| `tags` | TEXT/JSON | no | Array of free-text strings, default `[]`. |
| `begrepp` | TEXT/JSON | no | Unique vocabulary names, default `[]`. |
| `aktor` | TEXT | no | `Okänd`, `Misstänkt främmande`, `Civil`, `Egen`. |
| `dtg_raw` | TEXT | yes | Original time phrase/DTG. |
| `time_utc` | TEXT | yes | Normalized UTC time. |
| `time_uncertain` | INTEGER | no | Approximate/relative/ambiguous time. |
| `place_raw` | TEXT | yes | Original place expression. |
| `place_name` | TEXT | yes | Normalized label, not an assumed coordinate. |
| `mgrs` | TEXT | yes | Normalized compact MGRS. |
| `lat`, `lon` | REAL | yes | WGS84 decimal degrees. |
| `position_missing` | INTEGER | no | `1` when no validated WGS84 pair exists. |
| `styrka_raw` | TEXT | yes | Original strength phrase. |
| `count_min`, `count_max` | INTEGER | yes | Exact number uses equal values. |
| `slag` | TEXT | yes | Observed object/type. |
| `sysselsattning` | TEXT | yes | Activity/direction. |
| `symbol` | TEXT | yes | Markings/registration/insignia. |
| `sagesman` | TEXT | yes | Reported source/observer. |
| `kallrapport_raw` | TEXT | no | Complete original pasted report. |
| `ai_json` | TEXT/JSON | yes | Accepted extraction draft as generated/validated. |
| `bedomning` | TEXT | yes | Latest explicitly stored assessment. |
| `fields_uncertain` | TEXT/JSON | no | Unique field-name array, default `[]`. |

Checks constrain enums, booleans, coordinate ranges, non-negative counts, and JSON validity. Migration index names are `idx_cases_lopnr`, `idx_cases_time`, `idx_cases_status`, `idx_cases_aktor`, `idx_cases_star`, `idx_cases_position_missing`, and `idx_cases_mgrs`. JSON-array filters may use `json_each`.

## `begrepp`

| Column | Type | Rules |
|---|---:|---|
| `id` | INTEGER PK | Stable. |
| `name_sv` | TEXT UNIQUE | Controlled Swedish case value. |
| `name_en` | TEXT | English display translation. |
| `definition` | TEXT | Editable usage guidance. |
| `active` | INTEGER | `0`/`1`; inactive values remain valid historically. |
| `sidc` | TEXT | Milsymbol/APP-6 code; affiliation is replaced from `cases.aktor` at render time. |
| `sort` | INTEGER | Unique display order. |

The first migration seeds preset `BAS` exactly once. `idx_begrepp_active_sort` supports ordered active lookups. Triggers `begrepp_unknown_stays_active`, `begrepp_unknown_not_deleted`, and `begrepp_unknown_not_renamed` protect the required fallback in the database as well as application code. Vocabulary JSON import validates uniqueness, SIDC strings, and ordering before replacing/merging.

## `spaningsfragor`

| Column | Type | Rules |
|---|---:|---|
| `id` | INTEGER PK | Stable. |
| `question` | TEXT | Concrete collection question. |
| `motivering` | TEXT | Grounding/information gap. |
| `prioritet` | TEXT | `Hög`, `Medel`, `Låg`. |
| `status` | TEXT | `Föreslagen`, `Aktiv`, `Besvarad`, `Avförd`. |
| `linked_case_ids` | TEXT/JSON | Unique existing case IDs; AI proposals require at least one. |
| `forslag_inhamtning` | TEXT | Suggested lawful observation-level collection. |
| `created_by` | TEXT | `AI` or `user`. |
| `created_at`, `updated_at` | TEXT | UTC ISO timestamps. |

Deleting a case removes its id from `linked_case_ids` in the same transaction; it does not silently delete the question. Indexes are `idx_spaningsfragor_status` and `idx_spaningsfragor_priority`.

## `notes`

Appendable thread entries for any domain entity.

| Column | Type | Rules |
|---|---:|---|
| `id` | INTEGER PK | Stable. |
| `entity_type` | TEXT | `case`, `begrepp`, `spaningsfraga`. |
| `entity_id` | INTEGER | Must resolve in the corresponding table. |
| `ts` | TEXT | UTC ISO timestamp. |
| `text` | TEXT | Non-empty note. |

The polymorphic relation is checked in application transactions. `idx_notes_entity` covers `(entity_type, entity_id, ts)`.

## `settings`

`key TEXT PRIMARY KEY`, `value TEXT NOT NULL`. This table holds data-level settings that need transaction semantics. Installation/UI configuration lives in `config/app.local.json`, overlaying `config/app.defaults.json`; teardown removes the overlay.

## `ai_jobs`

Local queue state: `id`, `type` (`extraction`, `questions`, `qa`, `assessment`), `status` (`pending`, `running`, `done`, `failed`, `cancelled`), `created_at`, `started_at`, `finished_at`, `input_json`, `result_json`, `error_code`, `error_message`. `idx_ai_jobs_status_created` supports queue polling. Raw report text is not written to info-level logs. Queue rows are local user data and disappear with `data/`.

## Full-text search

`cases_fts` is an FTS5 external-content virtual table tied to `cases.id`. It indexes `lopnr`, `dtg_raw`, `place_raw`, `place_name`, `mgrs`, `styrka_raw`, `slag`, `sysselsattning`, `symbol`, `sagesman`, `kallrapport_raw`, `bedomning`, tags, and begrepp. Triggers `cases_fts_insert`, `cases_fts_delete`, and `cases_fts_update` keep it synchronized; a migration can rebuild with `INSERT INTO cases_fts(cases_fts) VALUES ('rebuild')`. Search input is tokenized/escaped by the backend rather than interpolated into SQL.

## CSV mirror and backups

`data/mirror/liggare.csv` is UTF-8 with BOM and semicolon-delimited by default for Swedish Excel. JSON arrays use compact JSON in one quoted cell. The file is atomically replaced after each committed case/domain write.

On every start and every `backupIntervalMin` (default 30), a full workbook is written to `data/backups/aurora-backup-<YYYYMMDD-HHMMSS>.xlsx`. After a successful write, oldest files beyond `backupRetention` (default 20) are removed. An incomplete temporary file never replaces a completed backup.

## XLSX fixed round-trip schema

An Aurora workbook has exactly these core sheets; unknown extra sheets are ignored with a warning.

### `Liggare`

Columns in order:

```text
id, lopnr, created_at, updated_at, created_by, status, star, tags,
begrepp, aktor, dtg_raw, time_utc, time_uncertain, place_raw,
place_name, mgrs, lat, lon, position_missing, styrka_raw, count_min,
count_max, slag, sysselsattning, symbol, sagesman, kallrapport_raw,
ai_json, bedomning, fields_uncertain, notes_json
```

### `Spaningsfrågor`

```text
id, question, motivering, prioritet, status, linked_case_ids,
forslag_inhamtning, created_by, created_at, updated_at, notes_json
```

### `Begrepp`

```text
id, name_sv, name_en, definition, active, sidc, sort, notes_json
```

Booleans export as `0`/`1`; null is an empty cell; `tags`, `begrepp`, `fields_uncertain`, `linked_case_ids`, and every `notes_json` cell are compact UTF-8 JSON. A note cell is an array of `{id,entity_type,entity_id,ts,text}`. Date cells carry ISO text to avoid timezone mutation by Excel. Replace-import preserves note IDs, timestamps, and entity linkage; append/merge remaps case links and inserts/deduplicates notes. Import performs a complete validation preview, duplicate detection by normalized `time_utc + mgrs + slag`, and an explicit merge-or-append choice. For an unmodified Aurora workbook, preserved IDs and JSON columns reproduce all three tables and note threads exactly. A general CSV imports/exports case rows only; a full-system round trip uses XLSX.

## Snapshot and restore safety

`teardown` first creates `exports/aurora-final-<YYYYMMDD-HHMM>.xlsx` and `.csv`. It verifies both files are non-empty before deleting working data. `--no-export` is explicit. `build --restore-latest` chooses the latest full workbook when present, migrates a fresh database, validates the workbook, and imports it. `--purge-exports` is the only lifecycle action that deletes snapshots and requires the typed phrase `RADERA AURORA`.
