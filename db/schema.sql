-- Anidle schema (SQLite / Turso). Idempotent: every statement is IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS anime (
  mal_id        INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  title_en      TEXT,
  title_ja      TEXT,
  synonyms      TEXT NOT NULL DEFAULT '[]',  -- JSON string[]
  media_type    TEXT,                        -- MAL: tv, movie, ova, ona, special, tv_special, music, cm, pv, unknown
  status        TEXT,
  num_episodes  INTEGER,                     -- NULL when unknown (MAL sends 0)
  year          INTEGER,
  season        TEXT,                        -- winter | spring | summer | fall
  start_date    TEXT,
  score         REAL,
  members       INTEGER,
  source        TEXT,
  rating        TEXT,
  studios       TEXT NOT NULL DEFAULT '[]',  -- JSON string[]
  nsfw          TEXT,
  cover_src     TEXT,                        -- MAL CDN URL, replaced by an R2 key in M3
  franchise_id  INTEGER,                     -- smallest mal_id of the prequel/sequel component
  excluded      TEXT,                        -- reason this title never enters a pool, NULL = usable
  fetched_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS genre (
  id    INTEGER PRIMARY KEY,  -- MAL genre id (shared by MAL API and jikan-edge)
  name  TEXT NOT NULL,
  type  TEXT NOT NULL         -- genres | explicit_genres | themes | demographics
);

CREATE TABLE IF NOT EXISTS anime_genre (
  mal_id    INTEGER NOT NULL,
  genre_id  INTEGER NOT NULL,
  PRIMARY KEY (mal_id, genre_id)
);

CREATE TABLE IF NOT EXISTS anime_relation (
  mal_id      INTEGER NOT NULL,
  related_id  INTEGER NOT NULL,
  relation    TEXT NOT NULL,
  PRIMARY KEY (mal_id, related_id, relation)
);

CREATE TABLE IF NOT EXISTS player (
  username           TEXT PRIMARY KEY COLLATE NOCASE,
  mal_user_id        INTEGER,
  avatar             TEXT,
  access_token_enc   TEXT,
  refresh_token_enc  TEXT,
  token_expires_at   INTEGER,  -- epoch ms
  last_sync_at       TEXT,
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS completed (
  username  TEXT NOT NULL COLLATE NOCASE,
  mal_id    INTEGER NOT NULL,
  PRIMARY KEY (username, mal_id)
);
CREATE INDEX IF NOT EXISTS completed_mal_id ON completed (mal_id);

CREATE TABLE IF NOT EXISTS top_genre (
  genre_id  INTEGER NOT NULL,
  mal_id    INTEGER NOT NULL,
  rank      INTEGER NOT NULL,
  PRIMARY KEY (genre_id, mal_id)
);
CREATE INDEX IF NOT EXISTS top_genre_mal_id ON top_genre (mal_id);

-- Titles that entered a pool (e.g. through /api/sync) but have no anime row yet.
CREATE TABLE IF NOT EXISTS enrich_queue (
  mal_id    INTEGER PRIMARY KEY,
  reason    TEXT NOT NULL,
  added_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS puzzle (
  id          TEXT PRIMARY KEY,
  date        TEXT,           -- YYYY-MM-DD (WIB) for daily puzzles, NULL for unlimited
  mode        TEXT NOT NULL,
  pool        TEXT NOT NULL,
  answer_id   INTEGER NOT NULL,
  created_by  TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (date, mode)         -- NULL dates are distinct in SQLite, so unlimited puzzles never collide
);

CREATE TABLE IF NOT EXISTS play (
  puzzle_id    TEXT NOT NULL,
  username     TEXT NOT NULL COLLATE NOCASE,
  guesses      TEXT NOT NULL DEFAULT '[]',  -- JSON mal_id[] in order
  solved       INTEGER NOT NULL DEFAULT 0,
  score        INTEGER,
  finished_at  TEXT,
  PRIMARY KEY (puzzle_id, username)
);
