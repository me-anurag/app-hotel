-- Sitebox schema (Cloudflare D1). File contents live in KV under "b/<sha256>".

CREATE TABLE sites (
  slug          TEXT PRIMARY KEY,
  title         TEXT    NOT NULL DEFAULT '',
  title_locked  INTEGER NOT NULL DEFAULT 0,   -- 1 = title set by hand, don't take it from <title>
  entry         TEXT    NOT NULL DEFAULT '',
  current       INTEGER NOT NULL DEFAULT 0,   -- live version id (0 = nothing committed yet)
  next_id       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);

CREATE TABLE versions (
  slug        TEXT    NOT NULL,
  id          INTEGER NOT NULL,
  created_at  TEXT    NOT NULL,
  entry       TEXT    NOT NULL,
  files       INTEGER NOT NULL,
  bytes       INTEGER NOT NULL,
  message     TEXT    NOT NULL DEFAULT '',
  source      TEXT    NOT NULL DEFAULT '',
  PRIMARY KEY (slug, id)
);

-- Which content (hash) each path of each version points to.
CREATE TABLE files (
  slug     TEXT    NOT NULL,
  version  INTEGER NOT NULL,
  path     TEXT    NOT NULL,
  hash     TEXT    NOT NULL,
  size     INTEGER NOT NULL,
  PRIMARY KEY (slug, version, path)
);
CREATE INDEX files_by_hash ON files (hash);

-- Content stored in KV. Shared by every file/version with the same bytes.
CREATE TABLE blobs (
  hash        TEXT PRIMARY KEY,
  size        INTEGER NOT NULL,
  created_at  TEXT    NOT NULL
);

-- An upload in progress (one per site). files = JSON [{path, hash, size}].
CREATE TABLE pending (
  slug        TEXT PRIMARY KEY,
  version     INTEGER NOT NULL,
  files       TEXT    NOT NULL,
  entry       TEXT    NOT NULL,
  title       TEXT    NOT NULL DEFAULT '',
  message     TEXT    NOT NULL DEFAULT '',
  source      TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL
);

-- "rev" changes on every write, so open apps know when to refresh.
CREATE TABLE meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
INSERT INTO meta (key, value) VALUES ('rev', 0);
