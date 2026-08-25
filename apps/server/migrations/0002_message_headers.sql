-- The bulk filter needs List-Unsubscribe / Precedence / Auto-Submitted, which
-- the first ingest didn't retain. Stored as a small JSON map rather than the
-- full header block: these are the only ones we classify on.
ALTER TABLE messages ADD COLUMN headers TEXT NOT NULL DEFAULT '{}';
ALTER TABLE messages ADD COLUMN headers_fetched INTEGER NOT NULL DEFAULT 0;
CREATE INDEX messages_headers_pending ON messages (headers_fetched);
