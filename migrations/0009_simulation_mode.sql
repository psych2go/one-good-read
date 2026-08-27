CREATE TABLE IF NOT EXISTS simulation_recommendations (
  simulation_date TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id),
  selection_run_id TEXT NOT NULL REFERENCES selection_runs(id),
  why_worth_reading TEXT NOT NULL,
  why_today TEXT NOT NULL,
  public_keywords TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_simulation_article ON simulation_recommendations(article_id);
