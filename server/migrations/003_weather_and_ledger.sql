ALTER TABLE cases ADD COLUMN source_assessment TEXT NOT NULL DEFAULT 'Okänd'
  CHECK (source_assessment IN ('Okänd', 'Låg', 'Medel', 'Hög'));
ALTER TABLE cases ADD COLUMN activity_summary TEXT;
ALTER TABLE cases ADD COLUMN traits_summary TEXT;

CREATE TABLE weather_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  forecast_at TEXT NOT NULL UNIQUE,
  temperature_c REAL,
  rain_mm REAL CHECK (rain_mm IS NULL OR rain_mm >= 0),
  humidity_pct INTEGER CHECK (humidity_pct IS NULL OR (humidity_pct >= 0 AND humidity_pct <= 100)),
  cloud_pct INTEGER CHECK (cloud_pct IS NULL OR (cloud_pct >= 0 AND cloud_pct <= 100)),
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_weather_forecast_at ON weather_entries(forecast_at);
