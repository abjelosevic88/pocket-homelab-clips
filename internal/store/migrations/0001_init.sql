CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE api_tokens (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL DEFAULT '',
  token_hash   TEXT NOT NULL UNIQUE,
  prefix       TEXT NOT NULL DEFAULT '',
  last_used_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- Clipboard history. One row per distinct piece of content per user: copying
-- the same thing again bumps last_copied_at and copy_count instead of adding
-- a duplicate, so the list reads newest on top, with no repeats.
--   kind: text | link | color | image | file
--   content: the text itself; for images the stored file name, for files the path
CREATE TABLE clips (
  id              INTEGER PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'text',
  content         TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  title           TEXT NOT NULL DEFAULT '',
  source_app      TEXT NOT NULL DEFAULT '',
  source_device   TEXT NOT NULL DEFAULT '',
  bytes           INTEGER NOT NULL DEFAULT 0,
  chars           INTEGER NOT NULL DEFAULT 0,
  words           INTEGER NOT NULL DEFAULT 0,
  lines           INTEGER NOT NULL DEFAULT 0,
  width           INTEGER NOT NULL DEFAULT 0,
  height          INTEGER NOT NULL DEFAULT 0,
  pinned          INTEGER NOT NULL DEFAULT 0,
  copy_count      INTEGER NOT NULL DEFAULT 1,
  first_copied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_copied_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX clips_user_hash ON clips(user_id, content_hash);
CREATE INDEX clips_user_recent ON clips(user_id, pinned DESC, last_copied_at DESC);
CREATE INDEX clips_user_kind ON clips(user_id, kind, last_copied_at DESC);

-- Full-text index over the clips (external content: the row lives in clips).
CREATE VIRTUAL TABLE clips_fts USING fts5(
  content, title, source_app,
  content='clips', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER clips_ai AFTER INSERT ON clips BEGIN
  INSERT INTO clips_fts(rowid, content, title, source_app) VALUES (new.id, new.content, new.title, new.source_app);
END;
CREATE TRIGGER clips_ad AFTER DELETE ON clips BEGIN
  INSERT INTO clips_fts(clips_fts, rowid, content, title, source_app) VALUES ('delete', old.id, old.content, old.title, old.source_app);
END;
CREATE TRIGGER clips_au AFTER UPDATE OF content, title, source_app ON clips BEGIN
  INSERT INTO clips_fts(clips_fts, rowid, content, title, source_app) VALUES ('delete', old.id, old.content, old.title, old.source_app);
  INSERT INTO clips_fts(rowid, content, title, source_app) VALUES (new.id, new.content, new.title, new.source_app);
END;

-- Snippets: reusable text with a keyword and dynamic placeholders
-- ({clipboard}, {date}, {argument name="x"}, …). Private to the owner unless shared.
CREATE TABLE snippets (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  keyword      TEXT NOT NULL DEFAULT '',
  content      TEXT NOT NULL,
  folder       TEXT NOT NULL DEFAULT '',
  shared       INTEGER NOT NULL DEFAULT 0,
  pinned       INTEGER NOT NULL DEFAULT 0,
  use_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX snippets_user_keyword ON snippets(user_id, keyword) WHERE keyword <> '';
CREATE INDEX snippets_user ON snippets(user_id, pinned DESC, name);

CREATE VIRTUAL TABLE snippets_fts USING fts5(
  name, keyword, content, folder,
  content='snippets', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER snippets_ai AFTER INSERT ON snippets BEGIN
  INSERT INTO snippets_fts(rowid, name, keyword, content, folder) VALUES (new.id, new.name, new.keyword, new.content, new.folder);
END;
CREATE TRIGGER snippets_ad AFTER DELETE ON snippets BEGIN
  INSERT INTO snippets_fts(snippets_fts, rowid, name, keyword, content, folder) VALUES ('delete', old.id, old.name, old.keyword, old.content, old.folder);
END;
CREATE TRIGGER snippets_au AFTER UPDATE OF name, keyword, content, folder ON snippets BEGIN
  INSERT INTO snippets_fts(snippets_fts, rowid, name, keyword, content, folder) VALUES ('delete', old.id, old.name, old.keyword, old.content, old.folder);
  INSERT INTO snippets_fts(rowid, name, keyword, content, folder) VALUES (new.id, new.name, new.keyword, new.content, new.folder);
END;

-- Quicklinks: a URL with optional {Query} / {argument name="…"} placeholders.
-- A keyword makes it reachable as /go/<keyword>?q=… (browser search engine).
CREATE TABLE quicklinks (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  keyword      TEXT NOT NULL DEFAULT '',
  link         TEXT NOT NULL,
  icon         TEXT NOT NULL DEFAULT '',
  open_with    TEXT NOT NULL DEFAULT '',
  folder       TEXT NOT NULL DEFAULT '',
  shared       INTEGER NOT NULL DEFAULT 0,
  pinned       INTEGER NOT NULL DEFAULT 0,
  use_count    INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX quicklinks_user_keyword ON quicklinks(user_id, keyword) WHERE keyword <> '';
CREATE INDEX quicklinks_user ON quicklinks(user_id, pinned DESC, name);

CREATE VIRTUAL TABLE quicklinks_fts USING fts5(
  name, keyword, link, folder,
  content='quicklinks', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER quicklinks_ai AFTER INSERT ON quicklinks BEGIN
  INSERT INTO quicklinks_fts(rowid, name, keyword, link, folder) VALUES (new.id, new.name, new.keyword, new.link, new.folder);
END;
CREATE TRIGGER quicklinks_ad AFTER DELETE ON quicklinks BEGIN
  INSERT INTO quicklinks_fts(quicklinks_fts, rowid, name, keyword, link, folder) VALUES ('delete', old.id, old.name, old.keyword, old.link, old.folder);
END;
CREATE TRIGGER quicklinks_au AFTER UPDATE OF name, keyword, link, folder ON quicklinks BEGIN
  INSERT INTO quicklinks_fts(quicklinks_fts, rowid, name, keyword, link, folder) VALUES ('delete', old.id, old.name, old.keyword, old.link, old.folder);
  INSERT INTO quicklinks_fts(rowid, name, keyword, link, folder) VALUES (new.id, new.name, new.keyword, new.link, new.folder);
END;
