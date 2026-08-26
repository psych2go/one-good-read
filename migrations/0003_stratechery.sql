UPDATE sources SET index_url='https://aswathdamodaran.blogspot.com/feeds/posts/default?alt=rss&max-results=10', updated_at=CURRENT_TIMESTAMP WHERE id='aswath-damodaran';
INSERT OR IGNORE INTO sources (id, name, kind, index_url, author_scope, adapter) VALUES
  ('stratechery', 'Stratechery', 'author', 'https://stratechery.com/feed/', '["Ben Thompson"]', 'rss');
