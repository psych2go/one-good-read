-- Collapse duplicate Marginal Revolution records created by two spellings of
-- RSS tracking separators ("&" and "&#038;"). Keep the most useful processed
-- record, expire loser artifacts, then establish exact-content uniqueness.
CREATE TABLE article_url_dedup_0010 (
  loser_id TEXT PRIMARY KEY,
  keeper_id TEXT NOT NULL
);

INSERT INTO article_url_dedup_0010 (loser_id, keeper_id)
WITH normalized AS (
  SELECT
    a.id,
    CASE
      WHEN a.source_id='marginal-revolution' AND instr(a.canonical_url,'?utm_source=rss')>0
        THEN substr(a.canonical_url,1,instr(a.canonical_url,'?utm_source=rss')-1)
      ELSE a.canonical_url
    END normalized_url,
    CASE a.status
      WHEN 'recommended' THEN 0
      WHEN 'ready' THEN 1
      WHEN 'rejected' THEN 2
      WHEN 'analysis_failed' THEN 3
      WHEN 'discovered' THEN 4
      WHEN 'unavailable' THEN 5
      WHEN 'blocked' THEN 6
      ELSE 7
    END status_rank,
    coalesce((SELECT max(n.intrinsic_score) FROM analyses n WHERE n.article_id=a.id),-1) quality,
    a.created_at
  FROM articles a
), ranked AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY normalized_url ORDER BY status_rank ASC,quality DESC,created_at DESC,id ASC) position,
    first_value(id) OVER (PARTITION BY normalized_url ORDER BY status_rank ASC,quality DESC,created_at DESC,id ASC) keeper_id
  FROM normalized
)
SELECT id,keeper_id FROM ranked WHERE position>1;

UPDATE stored_objects
SET expires_at=CURRENT_TIMESTAMP
WHERE article_id IN (SELECT loser_id FROM article_url_dedup_0010) AND deleted_at IS NULL;

DELETE FROM selection_candidates WHERE article_id IN (SELECT loser_id FROM article_url_dedup_0010);
DELETE FROM articles WHERE id IN (SELECT loser_id FROM article_url_dedup_0010);

UPDATE articles
SET canonical_url=substr(canonical_url,1,instr(canonical_url,'?utm_source=rss')-1),updated_at=CURRENT_TIMESTAMP
WHERE source_id='marginal-revolution' AND instr(canonical_url,'?utm_source=rss')>0;

DROP TABLE article_url_dedup_0010;

CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_content_hash_unique
ON articles(content_hash) WHERE content_hash IS NOT NULL;
