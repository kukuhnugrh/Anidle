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
  cover_src     TEXT,                        -- MAL CDN URL; the R2 copy lives in anime_media (kind cover)
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

-- MAL popularity ranking down to POPULAR_MIN_MEMBERS (shared/catalog.ts): the "populer" pool.
CREATE TABLE IF NOT EXISTS popular (
  mal_id  INTEGER PRIMARY KEY,
  rank    INTEGER NOT NULL
);

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

-- Rounds of multi-round modes (opening, ending). puzzle.answer_id repeats round 0.
CREATE TABLE IF NOT EXISTS puzzle_round (
  puzzle_id  TEXT NOT NULL,
  round      INTEGER NOT NULL,
  mal_id     INTEGER NOT NULL,
  PRIMARY KEY (puzzle_id, round)
);

-- Media copied to R2 by the pipeline step `media`. One row per title and kind; modes that need a kind
-- only use titles whose row is ok.
CREATE TABLE IF NOT EXISTS anime_media (
  mal_id      INTEGER NOT NULL,
  kind        TEXT NOT NULL,   -- cover | op | ed | chars (portraits in anime_character)
  status      TEXT NOT NULL,   -- ok | missing (no source) | broken (source failed processing/validation)
  r2_key      TEXT,            -- object key under MEDIA_BASE_URL, content-hashed
  source_url  TEXT,
  label       TEXT,            -- AnimeThemes slug, e.g. OP1
  song_title  TEXT,
  artist      TEXT,
  error       TEXT,
  checked_at  TEXT NOT NULL,
  PRIMARY KEY (mal_id, kind)
);
CREATE INDEX IF NOT EXISTS anime_media_usable ON anime_media (kind, status);

-- Karakter portraits (pipeline step `characters`), shown slot 0 first. A title is usable when its
-- anime_media row of kind 'chars' is ok.
CREATE TABLE IF NOT EXISTS anime_character (
  mal_id     INTEGER NOT NULL,
  slot       INTEGER NOT NULL,
  char_id    INTEGER NOT NULL,
  name       TEXT NOT NULL,
  role       TEXT,
  favorites  INTEGER,
  r2_key     TEXT NOT NULL,
  PRIMARY KEY (mal_id, slot)
);

CREATE TABLE IF NOT EXISTS play (
  puzzle_id    TEXT NOT NULL,
  username     TEXT NOT NULL COLLATE NOCASE,  -- player key: 'u:<account id>' or 'a:<anonymous hex id>'
  guesses      TEXT NOT NULL DEFAULT '[]',  -- JSON mal_id[] in order
  solved       INTEGER NOT NULL DEFAULT 0,
  score        INTEGER,
  finished_at  TEXT,
  PRIMARY KEY (puzzle_id, username)
);

-- Web accounts (username + password). Linking MAL is optional and unlocks the completed-list pools.
CREATE TABLE IF NOT EXISTS account (
  id             INTEGER PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,                 -- scrypt$N$r$p$salt$hash
  mal_username   TEXT UNIQUE COLLATE NOCASE,    -- player.username once linked
  created_at     TEXT NOT NULL
);

-- Replaced by `popular` (Oct 2026). Old unlimited puzzles keep working under the new pool name.
DROP TABLE IF EXISTS top_genre;
UPDATE puzzle SET pool = 'populer' WHERE pool = 'top';

-- Backfill for rows enriched before unaired titles were excluded (shared/catalog.ts exclusionReason).
UPDATE anime SET excluded = 'status:not_yet_aired' WHERE status = 'not_yet_aired' AND excluded IS NULL;
