CREATE TABLE IF NOT EXISTS simulation_feedback (
  id TEXT PRIMARY KEY,
  simulation_date TEXT NOT NULL REFERENCES simulation_recommendations(simulation_date) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('valuable','good','not_for_me','unfinished','later')),
  retry_eligible_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_simulation_feedback_date ON simulation_feedback(simulation_date,created_at DESC);
