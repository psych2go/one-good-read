-- Old/old-Worker inserts remain historical: their recovery is unknown, not resolved.
ALTER TABLE alerts ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'historical'
  CHECK (lifecycle_status IN ('historical','open','acknowledged','resolved'));
ALTER TABLE alerts ADD COLUMN last_seen_at TEXT;
ALTER TABLE alerts ADD COLUMN occurrence_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE alerts ADD COLUMN acknowledged_at TEXT;
ALTER TABLE alerts ADD COLUMN resolved_at TEXT;
ALTER TABLE alerts ADD COLUMN managed_condition TEXT;
-- Only new unresolved episodes participate; migration does not rewrite history.
CREATE UNIQUE INDEX idx_alerts_active_incident ON alerts(dedupe_key)
  WHERE lifecycle_status IN ('open','acknowledged');
