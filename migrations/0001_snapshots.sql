CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 900000)
);
CREATE INDEX snapshots_created_at ON snapshots(created_at DESC, id);
CREATE TABLE active_snapshot (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  snapshot_id TEXT NOT NULL REFERENCES snapshots(id)
);
CREATE TABLE integration_runs (
  id TEXT PRIMARY KEY,
  adapter TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
  snapshot_id TEXT REFERENCES snapshots(id),
  error_code TEXT
);
CREATE INDEX integration_runs_adapter_time ON integration_runs(adapter, started_at DESC);
