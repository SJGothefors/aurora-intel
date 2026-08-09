ALTER TABLE ai_jobs RENAME TO ai_jobs_legacy;

CREATE TABLE ai_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('extraction', 'questions', 'qa', 'assessment', 'overview')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled')),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  result TEXT CHECK (result IS NULL OR json_valid(result)),
  error_code TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

INSERT INTO ai_jobs (id, type, status, payload, result, error_code, created_at, started_at, finished_at)
SELECT id, type, status, payload, result, error_code, created_at, started_at, finished_at FROM ai_jobs_legacy;

DROP TABLE ai_jobs_legacy;
CREATE INDEX idx_ai_jobs_status_created ON ai_jobs(status, created_at);
