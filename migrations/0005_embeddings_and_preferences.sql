CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  embedding_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  vector_object_key TEXT NOT NULL,
  projection TEXT NOT NULL,
  indexed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(article_id, embedding_version)
);
CREATE INDEX IF NOT EXISTS idx_embeddings_version ON embeddings(embedding_version, article_id);

CREATE TABLE IF NOT EXISTS preference_models (
  id TEXT PRIMARY KEY,
  model_version TEXT NOT NULL,
  embedding_version TEXT NOT NULL,
  feature_version TEXT NOT NULL,
  sample_count INTEGER NOT NULL,
  max_influence REAL NOT NULL,
  weights TEXT NOT NULL,
  metrics TEXT NOT NULL DEFAULT '{}',
  trained_through TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_preference_models_active ON preference_models(active, created_at DESC);
