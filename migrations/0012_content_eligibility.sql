-- NULL is legacy_unknown, not verified eligibility. No historical recommendations are changed.
ALTER TABLE analyses ADD COLUMN content_eligibility TEXT CHECK (content_eligibility IS NULL OR json_valid(content_eligibility));
ALTER TABLE articles ADD COLUMN content_review_reason TEXT;
