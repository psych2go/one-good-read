PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  index_url TEXT NOT NULL,
  author_scope TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','blocked')),
  adapter TEXT NOT NULL,
  last_scanned_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  canonical_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  published_at TEXT,
  discovered_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered','rejected','ready','recommended','blocked','unavailable','analysis_failed')),
  access_state TEXT NOT NULL DEFAULT 'unknown' CHECK (access_state IN ('unknown','free','paywalled','registration_required','partial_preview','unavailable')),
  rejection_reason TEXT,
  content_hash TEXT,
  body_key TEXT,
  word_count INTEGER,
  reading_minutes INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_articles_source_status ON articles(source_id, status);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at DESC);

CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  analysis_version TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  intrinsic_score REAL NOT NULL,
  long_term_value REAL NOT NULL,
  idea_density REAL NOT NULL,
  argument_quality REAL NOT NULL,
  originality REAL NOT NULL,
  clarity_structure REAL NOT NULL,
  extraction_confidence REAL NOT NULL,
  analysis_confidence REAL NOT NULL,
  primary_theme TEXT NOT NULL,
  secondary_themes TEXT NOT NULL DEFAULT '[]',
  keywords TEXT NOT NULL DEFAULT '[]',
  evidence TEXT NOT NULL DEFAULT '[]',
  risk_notes TEXT NOT NULL DEFAULT '[]',
  context_summary TEXT NOT NULL,
  analysis_object_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(article_id, analysis_version)
);
CREATE INDEX IF NOT EXISTS idx_analyses_quality ON analyses(analysis_version, intrinsic_score DESC);

CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY,
  recommendation_date TEXT NOT NULL UNIQUE,
  article_id TEXT NOT NULL REFERENCES articles(id),
  selection_run_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','withdrawn')),
  why_worth_reading TEXT NOT NULL,
  why_today TEXT NOT NULL,
  public_keywords TEXT NOT NULL DEFAULT '[]',
  published_at TEXT NOT NULL,
  replaced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_recommendations_date ON recommendations(recommendation_date DESC);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  recommendation_id TEXT NOT NULL REFERENCES recommendations(id),
  kind TEXT NOT NULL CHECK (kind IN ('valuable','good','not_for_me','unfinished','later')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_feedback_recommendation ON feedback(recommendation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS selection_runs (
  id TEXT PRIMARY KEY,
  recommendation_date TEXT NOT NULL,
  selection_version TEXT NOT NULL,
  analysis_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','complete','failed','degraded')),
  winner_article_id TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS selection_candidates (
  selection_run_id TEXT NOT NULL REFERENCES selection_runs(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES articles(id),
  rank INTEGER NOT NULL,
  intrinsic_score REAL NOT NULL,
  dynamic_score REAL NOT NULL,
  freshness_bonus REAL NOT NULL,
  exploration_bonus REAL NOT NULL,
  author_penalty REAL NOT NULL,
  theme_penalty REAL NOT NULL,
  connection_bonus REAL NOT NULL,
  personal_fit REAL NOT NULL,
  explanation TEXT NOT NULL,
  PRIMARY KEY(selection_run_id, article_id)
);

CREATE TABLE IF NOT EXISTS system_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO sources (id, name, kind, index_url, author_scope, adapter) VALUES
  ('paul-graham', 'Paul Graham Essays', 'author', 'https://paulgraham.com/articles.html', '["Paul Graham"]', 'paul_graham'),
  ('marginal-revolution', 'Marginal Revolution', 'site', 'https://marginalrevolution.com/feed', '["Tyler Cowen","Alex Tabarrok"]', 'marginal_revolution'),
  ('howard-marks', 'Howard Marks Memos', 'author', 'https://www.oaktreecapital.com/insights/memos', '["Howard Marks"]', 'howard_marks');
