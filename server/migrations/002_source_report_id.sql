ALTER TABLE cases ADD COLUMN source_report_id TEXT;

CREATE INDEX IF NOT EXISTS idx_cases_source_report_id ON cases(source_report_id);
