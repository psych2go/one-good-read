ALTER TABLE sources ADD COLUMN history_pages INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sources ADD COLUMN backfill_locked_until TEXT;
