ALTER TABLE articles ADD COLUMN recommendation_retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE articles ADD COLUMN retry_eligible_at TEXT;

CREATE TABLE IF NOT EXISTS stored_objects (
  object_key TEXT PRIMARY KEY,
  article_id TEXT REFERENCES articles(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('article_body','embedding','analysis_artifact','raw_html')),
  size_bytes INTEGER NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_stored_objects_expiry ON stored_objects(kind,expires_at,deleted_at);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('warning','critical')),
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('logged','sent','failed','disabled')),
  delivery_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_alerts_dedupe ON alerts(dedupe_key,created_at DESC);
