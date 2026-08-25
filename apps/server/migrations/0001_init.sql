CREATE TABLE accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT    NOT NULL UNIQUE,
  refresh_token   TEXT    NOT NULL,
  history_id      TEXT,
  backfilled_at   INTEGER,
  needs_reconnect INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
);

CREATE TABLE messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  gmail_id      TEXT    NOT NULL,
  thread_id     TEXT    NOT NULL,
  from_name     TEXT    NOT NULL DEFAULT '',
  from_email    TEXT    NOT NULL DEFAULT '',
  to_email      TEXT    NOT NULL DEFAULT '',
  subject       TEXT    NOT NULL DEFAULT '',
  snippet       TEXT    NOT NULL DEFAULT '',
  body_text     TEXT    NOT NULL DEFAULT '',
  internal_date INTEGER NOT NULL,
  label_ids     TEXT    NOT NULL DEFAULT '[]',
  is_sent       INTEGER NOT NULL DEFAULT 0,
  is_bulk       INTEGER NOT NULL DEFAULT 0,
  bulk_reason   TEXT,
  content_hash  TEXT    NOT NULL
);
CREATE UNIQUE INDEX messages_account_gmail_id ON messages (account_id, gmail_id);
CREATE INDEX messages_thread ON messages (account_id, thread_id);
CREATE INDEX messages_date  ON messages (internal_date);

CREATE TABLE threads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id      INTEGER NOT NULL REFERENCES accounts(id),
  gmail_thread_id TEXT    NOT NULL,
  subject         TEXT    NOT NULL DEFAULT '',
  last_message_at INTEGER NOT NULL,
  message_count   INTEGER NOT NULL DEFAULT 0,
  is_bulk         INTEGER NOT NULL DEFAULT 0,
  extract_state   TEXT    NOT NULL DEFAULT 'pending',
  extract_hash    TEXT,
  was_capped      INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX threads_account_gmail_id ON threads (account_id, gmail_thread_id);
CREATE INDEX threads_extract_state ON threads (extract_state);

CREATE TABLE obligations (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id         INTEGER NOT NULL REFERENCES accounts(id),
  thread_id          INTEGER NOT NULL REFERENCES threads(id),
  source_message_id  TEXT    NOT NULL DEFAULT '',
  court              TEXT    NOT NULL,
  temporal_class     TEXT    NOT NULL,
  anchor_date        TEXT,
  anchor_is_explicit INTEGER NOT NULL DEFAULT 0,
  anchor_quote       TEXT    NOT NULL DEFAULT '',
  anchor_validated   INTEGER NOT NULL DEFAULT 0,
  title              TEXT    NOT NULL,
  detail             TEXT    NOT NULL DEFAULT '',
  confidence         REAL    NOT NULL DEFAULT 0,
  completed_at       INTEGER,
  dismissed_at       INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX obligations_thread ON obligations (thread_id);
CREATE INDEX obligations_open   ON obligations (completed_at, dismissed_at);

CREATE TABLE editions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  input_hash  TEXT    NOT NULL UNIQUE,
  composed_at INTEGER NOT NULL,
  headline    TEXT    NOT NULL,
  notes       TEXT    NOT NULL DEFAULT '[]'
);

CREATE TABLE sync_runs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id       INTEGER NOT NULL REFERENCES accounts(id),
  kind             TEXT    NOT NULL,
  started_at       INTEGER NOT NULL,
  finished_at      INTEGER,
  messages_fetched INTEGER NOT NULL DEFAULT 0,
  error            TEXT
);
