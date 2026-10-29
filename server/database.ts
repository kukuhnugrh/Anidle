import { CANONICAL_SQL, difficultyOf, type GenreType } from '../shared/catalog.js';
import { maskSynopsis } from '../shared/anidle.js';
import { characterAliases, characterDifficultyOf, displayName } from '../shared/characters.js';
import { DB_PAGE_SIZE, type DbDetail, type DbFacets, type DbFilters, type DbGenre, type DbItem, type DbPage, type DbSong, type DbSort } from '../shared/database.js';
import { isSongMode, MODE_MEDIA, MODES, SONG_KIND, type ThemeKind } from '../shared/modes.js';
import { titleHint } from '../shared/normalize.js';
import { all, one } from './db.js';
import { difficultySql, USABLE_THEME_SQL } from './game.js';
import { COVER_KEY_SQL, coverOf, mediaUrl } from './media.js';

const ORDER_BY: Record<DbSort, string> = {
  popularity: 'a.members IS NULL, a.members DESC',
  score: 'a.score IS NULL, a.score DESC',
  newest: 'a.start_date IS NULL, a.start_date DESC',
  oldest: 'a.start_date IS NULL, a.start_date ASC',
  title: 'a.title COLLATE NOCASE ASC',
};

function where(f: DbFilters): { sql: string; args: Array<string | number> } {
  const parts = ['a.excluded IS NULL', CANONICAL_SQL];
  const args: Array<string | number> = [];
  if (f.q) {
    // Synonyms are a JSON array of strings; a LIKE over its text is enough for a search box. Any
    // entry of the show may match: searching "Season 2" finds the show it was merged into.
    const like = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const columns = ['x.title', 'x.title_en', 'x.title_ja', 'x.synonyms'];
    parts.push(
      `EXISTS (SELECT 1 FROM anime x WHERE (x.mal_id = a.mal_id OR x.canonical_id = a.mal_id) AND (${columns.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')}))`,
    );
    args.push(...columns.map(() => like));
  }
  for (const id of f.genres) {
    parts.push('EXISTS (SELECT 1 FROM anime_genre g WHERE g.mal_id = a.mal_id AND g.genre_id = ?)');
    args.push(id);
  }
  if (f.studio) {
    parts.push('EXISTS (SELECT 1 FROM json_each(a.studios) s WHERE s.value = ?)');
    args.push(f.studio);
  }
  if (f.source) {
    parts.push('a.source = ?');
    args.push(f.source);
  }
  if (f.difficulty) parts.push(`(${difficultySql(f.difficulty)})`);
  return { sql: parts.join(' AND '), args };
}

interface Row {
  mal_id: number;
  title: string;
  title_en: string | null;
  cover_src: string | null;
  cover_key: string | null;
  year: number | null;
  score: number | null;
  members: number | null;
  rank: number | null;
  source: string | null;
  studios: string;
  entries: number;
}

const num = (v: number | null) => (v == null ? null : Number(v));

/** Card fields of a show; `entries` counts the MAL entries merged into it. */
const ITEM_SQL = `a.mal_id, a.title, a.title_en, a.cover_src, ${COVER_KEY_SQL} AS cover_key, a.year, a.score, a.members, p.rank, a.source, a.studios,
  (SELECT COUNT(*) FROM anime x WHERE x.canonical_id = a.mal_id AND x.excluded IS NULL) AS entries`;

async function genresOf(ids: number[]): Promise<Map<number, DbGenre[]>> {
  if (!ids.length) return new Map();
  const rows = await all<{ mal_id: number; id: number; name: string; type: GenreType }>(
    `SELECT ag.mal_id, g.id, g.name, g.type FROM anime_genre ag JOIN genre g ON g.id = ag.genre_id
     WHERE ag.mal_id IN (${ids.map(() => '?').join(',')}) ORDER BY g.name`,
    ids,
  );
  return new Map([...Map.groupBy(rows, (g) => Number(g.mal_id))].map(([malId, gs]) => [malId, gs.map((g) => ({ id: Number(g.id), name: g.name, type: g.type }))]));
}

function toItem(r: Row, genres: Map<number, DbGenre[]>): DbItem {
  return {
    malId: Number(r.mal_id),
    title: r.title,
    titleEn: r.title_en,
    cover: coverOf(r.cover_key, r.cover_src),
    year: num(r.year),
    score: num(r.score),
    members: num(r.members),
    popularityRank: num(r.rank),
    entries: Math.max(1, Number(r.entries)),
    difficulty: difficultyOf(num(r.members)),
    source: r.source,
    studios: JSON.parse(r.studios) as string[],
    genres: genres.get(Number(r.mal_id)) ?? [],
  };
}

export async function listAnime(f: DbFilters): Promise<DbPage> {
  const w = where(f);
  const total = Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM anime a WHERE ${w.sql}`, w.args))?.n ?? 0);
  const rows = await all<Row>(
    `SELECT ${ITEM_SQL} FROM anime a LEFT JOIN popular p ON p.mal_id = a.mal_id
     WHERE ${w.sql} ORDER BY ${ORDER_BY[f.sort]}, a.mal_id LIMIT ? OFFSET ?`,
    [...w.args, DB_PAGE_SIZE, (f.page - 1) * DB_PAGE_SIZE],
  );
  const genres = await genresOf(rows.map((r) => Number(r.mal_id)));
  return { items: rows.map((r) => toItem(r, genres)), total, page: f.page, pageSize: DB_PAGE_SIZE };
}

interface DetailRow extends Row {
  title_ja: string | null;
  synonyms: string;
  media_type: string | null;
  season: string | null;
  num_episodes: number | null;
  synopsis: string | null;
}

interface ThemeRow {
  id: number;
  kind: ThemeKind;
  label: string;
  song_title: string | null;
  artist: string | null;
  audio_url: string;
  video_url: string;
  clip_key: string | null;
  entry_id: number;
  entry_title: string;
  entry_members: number | null;
}

/**
 * One show with everything the game uses for it: Anidle's attributes and clues, songs and clue clips,
 * Character mode's characters (with the other shows accepted for them), Guess the Anime's screenshots
 * and title hint, merged entries. Any entry's id resolves to its show; null when that is not a playable
 * show. Only media the game may use (status ok) is listed; clues are built with the game's own helpers.
 */
export async function animeDetail(id: number): Promise<DbDetail | null> {
  const row = await one<DetailRow>(
    `SELECT ${ITEM_SQL}, a.title_ja, a.synonyms, a.media_type, a.season, a.num_episodes, a.synopsis
     FROM anime a LEFT JOIN popular p ON p.mal_id = a.mal_id
     WHERE a.excluded IS NULL AND ${CANONICAL_SQL} AND a.mal_id = (SELECT COALESCE(x.canonical_id, x.mal_id) FROM anime x WHERE x.mal_id = ?)`,
    [id],
  );
  if (!row) return null;
  const malId = Number(row.mal_id);
  const [genres, merged, media, themes, characters, screenshots, appearances] = await Promise.all([
    genresOf([malId]),
    all<{ mal_id: number; title: string; media_type: string | null; year: number | null; num_episodes: number | null }>(
      `SELECT mal_id, title, media_type, year, num_episodes FROM anime
       WHERE (mal_id = ? OR canonical_id = ?) AND excluded IS NULL ORDER BY start_date IS NULL, start_date, mal_id`,
      [malId, malId],
    ),
    all<{ kind: string }>("SELECT kind FROM anime_media WHERE mal_id = ? AND status = 'ok'", [malId]),
    all<ThemeRow>(
      `SELECT t.id, t.kind, t.label, t.song_title, t.artist, t.audio_url, t.video_url, t.clip_key, e.mal_id AS entry_id, e.title AS entry_title, e.members AS entry_members
       FROM ${USABLE_THEME_SQL} AND (e.mal_id = ? OR e.canonical_id = ?)
       ORDER BY e.start_date IS NULL, e.start_date, e.mal_id, t.seq, t.label`,
      [malId, malId],
    ),
    all<{ char_id: number; name: string; nicknames: string; aliases: string; role: string | null; favorites: number | null; r2_key: string }>(
      'SELECT char_id, name, nicknames, aliases, role, favorites, r2_key FROM anime_character WHERE mal_id = ? ORDER BY slot',
      [malId],
    ),
    all<{ r2_key: string }>('SELECT r2_key FROM anime_screenshot WHERE mal_id = ? ORDER BY slot', [malId]),
    // Same as Character mode's check (server/characters.ts): any show the character appears in is accepted.
    all<{ char_id: number; show: number; title: string }>(
      `SELECT DISTINCT cs.char_id, s.mal_id AS show, s.title FROM character_show cs
       JOIN anime a ON a.mal_id = cs.mal_id JOIN anime s ON s.mal_id = COALESCE(a.canonical_id, a.mal_id)
       WHERE s.excluded IS NULL AND s.mal_id <> ? AND cs.char_id IN (SELECT char_id FROM anime_character WHERE mal_id = ?) ORDER BY s.members DESC`,
      [malId, malId],
    ),
  ]);
  const alsoIn = Map.groupBy(appearances, (a) => Number(a.char_id));
  const synonyms = JSON.parse(row.synonyms) as string[];
  const ok = new Set(media.map((m) => m.kind));
  const songs = (kind: ThemeKind): DbSong[] =>
    themes
      .filter((t) => t.kind === kind)
      .map((t) => ({
        id: Number(t.id),
        label: t.label,
        title: t.song_title,
        artist: t.artist,
        entry: { malId: Number(t.entry_id), title: t.entry_title },
        difficulty: difficultyOf(num(t.entry_members)),
        audio: t.audio_url,
        // The clue's video: the 240p R2 clip when steps clips/daily made one, else the theme's AnimeThemes video (the game streams it).
        clip: t.clip_key ? mediaUrl(t.clip_key) : t.video_url || null,
      }));
  const songsByKind = { op: songs('op'), ed: songs('ed') };
  return {
    ...toItem(row, genres),
    titleJa: row.title_ja,
    synonyms,
    mediaType: row.media_type,
    season: row.season,
    episodes: num(row.num_episodes),
    synopsis: row.synopsis || null,
    merged: merged.map((e) => ({ malId: Number(e.mal_id), title: e.title, mediaType: e.media_type, year: num(e.year), episodes: num(e.num_episodes) })),
    modes: MODES.filter((m) => (isSongMode(m) ? songsByKind[SONG_KIND[m]].length > 0 : MODE_MEDIA[m] === null || ok.has(MODE_MEDIA[m]))),
    songs: songsByKind,
    characters: ok.has('chars')
      ? characters.map((c) => ({
          id: Number(c.char_id),
          name: displayName(c.name),
          nicknames: characterAliases(c.nicknames, c.aliases, c.name),
          role: c.role,
          favorites: num(c.favorites),
          difficulty: characterDifficultyOf(Number(c.favorites ?? 0)),
          portrait: mediaUrl(c.r2_key),
          alsoIn: (alsoIn.get(Number(c.char_id)) ?? []).map((s) => ({ malId: Number(s.show), title: s.title })),
        }))
      : [],
    screenshots: ok.has('shots') ? screenshots.map((s) => mediaUrl(s.r2_key)) : [],
    clues: {
      poster: coverOf(row.cover_key, row.cover_src),
      synopsis: row.synopsis ? maskSynopsis(row.synopsis, [row.title, row.title_en, row.title_ja, ...synonyms].filter((n): n is string => Boolean(n))) : null,
      // Anidle's last clue reads the two best-known stored characters (server/game.ts anidleClues).
      characters: characters
        .toSorted((a, b) => Number(b.favorites ?? 0) - Number(a.favorites ?? 0))
        .slice(0, 2)
        .map((c) => ({ name: displayName(c.name), portrait: mediaUrl(c.r2_key) })),
      titleHint: { title: titleHint(row.title), english: row.title_en && row.title_en !== row.title ? titleHint(row.title_en) : null },
    },
  };
}

/** Filter options with how many shows each has. */
export async function facets(): Promise<DbFacets> {
  const [genres, studios, sources] = await Promise.all([
    all<{ id: number; name: string; type: GenreType; count: number }>(
      `SELECT g.id, g.name, g.type, COUNT(*) AS count FROM anime_genre ag
       JOIN genre g ON g.id = ag.genre_id JOIN anime a ON a.mal_id = ag.mal_id
       WHERE a.excluded IS NULL AND ${CANONICAL_SQL} GROUP BY g.id ORDER BY g.name`,
    ),
    all<{ name: string; count: number }>(
      `SELECT s.value AS name, COUNT(*) AS count FROM anime a, json_each(a.studios) s
       WHERE a.excluded IS NULL AND ${CANONICAL_SQL} GROUP BY s.value ORDER BY count DESC, name`,
    ),
    all<{ value: string; count: number }>(
      `SELECT source AS value, COUNT(*) AS count FROM anime a WHERE a.excluded IS NULL AND ${CANONICAL_SQL} AND source IS NOT NULL GROUP BY source ORDER BY count DESC`,
    ),
  ]);
  return {
    genres: genres.map((g) => ({ id: Number(g.id), name: g.name, type: g.type, count: Number(g.count) })),
    studios: studios.map((s) => ({ name: s.name, count: Number(s.count) })),
    sources: sources.map((s) => ({ value: s.value, count: Number(s.count) })),
  };
}
