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

-- Each stored completed list as the shows it covers (JSON array of show ids: an entry counts as
-- COALESCE(canonical_id, mal_id)), so a pool reads one row per player instead of the whole list.
-- Rewritten with `completed` (server/players.ts) and by pipeline step `catalog` (franchises change).
CREATE TABLE IF NOT EXISTS completed_shows (
  username  TEXT PRIMARY KEY COLLATE NOCASE,
  shows     TEXT NOT NULL
);

-- Pipeline step `catalog` (pipeline/catalog.ts): 'shows' = what puzzle pools filter on, per show
-- (CatalogShows, server/catalog.ts; admin rejects patch it in place); 'lists' = R2 keys of the
-- autocomplete lists and Database facets. Turso bills rows read: a pool is one row, not 12k–50k.
CREATE TABLE IF NOT EXISTS catalog (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

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
  date        TEXT,           -- YYYY-MM-DD (UTC+7) for daily puzzles, NULL for unlimited
  mode        TEXT NOT NULL,
  pool        TEXT NOT NULL,
  answer_id   INTEGER NOT NULL,
  created_by  TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (date, mode)         -- NULL dates are distinct in SQLite, so unlimited puzzles never collide
);

-- Daily puzzles of a date that were thrown away and drawn again (npm run daily:reroll): the date's
-- seed becomes "<date>#<n>", so the new draw differs from the old one.
CREATE TABLE IF NOT EXISTS daily_reroll (
  date  TEXT PRIMARY KEY,
  n     INTEGER NOT NULL
);

-- Rounds of multi-round modes (opening, ending, screenshot). puzzle.answer_id repeats round 0.
-- Song rounds also store the song played (theme_id, added in pipeline/migrate.ts).
CREATE TABLE IF NOT EXISTS puzzle_round (
  puzzle_id  TEXT NOT NULL,
  round      INTEGER NOT NULL,
  mal_id     INTEGER NOT NULL,
  PRIMARY KEY (puzzle_id, round)
);

-- Character mode: per round CHARACTERS_PER_ROUND characters (char_id) from different anime (mal_id).
CREATE TABLE IF NOT EXISTS puzzle_character (
  puzzle_id  TEXT NOT NULL,
  round      INTEGER NOT NULL,
  slot       INTEGER NOT NULL,
  mal_id     INTEGER NOT NULL,
  char_id    INTEGER NOT NULL,
  PRIMARY KEY (puzzle_id, round, slot)
);

-- Media copied to R2 by the pipeline step `media`. One row per title and kind; modes that need a kind
-- only use titles whose row is ok. Songs live in anime_theme.
CREATE TABLE IF NOT EXISTS anime_media (
  mal_id      INTEGER NOT NULL,
  kind        TEXT NOT NULL,   -- cover | chars (anime_character) | shots (anime_screenshot)
  status      TEXT NOT NULL,   -- ok | missing (no source) | broken (failed processing/validation) | rejected (by an admin)
  r2_key      TEXT,            -- object key under MEDIA_BASE_URL, content-hashed
  source_url  TEXT,
  error       TEXT,
  checked_at  TEXT NOT NULL,
  PRIMARY KEY (mal_id, kind)
);
CREATE INDEX IF NOT EXISTS anime_media_usable ON anime_media (kind, status);

-- Every OP/ED of every MAL entry (pipeline step `media`, from AnimeThemes). The show is the entry's
-- canonical_id; a song's difficulty comes from its entry's members. Rejected (admin) = never asked.
CREATE TABLE IF NOT EXISTS anime_theme (
  id          INTEGER PRIMARY KEY,         -- AnimeThemes animetheme id
  mal_id      INTEGER NOT NULL,            -- the MAL entry the song belongs to
  kind        TEXT NOT NULL,               -- op | ed
  seq         INTEGER NOT NULL,            -- AnimeThemes sequence (OP1 = 1; unnumbered = 1)
  label       TEXT NOT NULL,               -- slug, e.g. OP1, ED2-TV
  song_title  TEXT,
  artist      TEXT,
  audio_url   TEXT NOT NULL,
  video_url   TEXT NOT NULL DEFAULT '',    -- the entry's smallest video ('' = none)
  clip_key    TEXT,                        -- 240p muted clue clip on R2 (steps clips/daily); '' = could not be made
  status      TEXT NOT NULL DEFAULT 'ok',  -- ok | rejected (admin) | missing (AnimeThemes no longer lists it; kept for old rounds)
  checked_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS anime_theme_entry ON anime_theme (mal_id, kind);

-- Karakter portraits (pipeline step `characters`): every character with >= CHARACTER_MIN_FAVORITES from
-- every MAL entry of the show, stored under the show id, slot 0 = best known. A title is usable when its
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
-- Portrait/nickname reuse across shows, nickname updates and the name autocomplete all look up by char_id.
CREATE INDEX IF NOT EXISTS anime_character_char ON anime_character (char_id);

-- Every show a character appears in (characters with ≥ CHARACTER_MIN_FAVORITES, pipeline step
-- `characters`, not only the ones kept as portraits): Character mode accepts any of them as the anime.
CREATE TABLE IF NOT EXISTS character_show (
  char_id  INTEGER NOT NULL,
  mal_id   INTEGER NOT NULL,
  PRIMARY KEY (char_id, mal_id)
);
CREATE INDEX IF NOT EXISTS character_show_show ON character_show (mal_id);

-- Screenshot mode: frames from the first opening's video (pipeline step `screenshots`). A title is
-- usable when its anime_media row of kind 'shots' is ok.
CREATE TABLE IF NOT EXISTS anime_screenshot (
  mal_id      INTEGER NOT NULL,
  slot        INTEGER NOT NULL,
  r2_key      TEXT NOT NULL,
  at_seconds  REAL NOT NULL,
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

-- Replaced by `popular` (Oct 2026).
DROP TABLE IF EXISTS top_genre;
