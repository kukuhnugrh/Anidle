import { createHash } from 'node:crypto';
import { CANONICAL_SQL, DIFFICULTIES, difficultyOf, type Difficulty, type GenreType } from '../shared/catalog.js';
import { CHARACTER_MIN_FAVORITES, characterAliases, characterDifficultyOf, displayName } from '../shared/characters.js';
import type { CatalogListName, CatalogLists, DbFacets } from '../shared/database.js';
import { CONNECTIONS_GROUP_SIZE, showLinks } from '../shared/connections.js';
import type { CharacterEntry, TitleEntry } from '../shared/normalize.js';
import { catalogSong, completedShowsWrites, USABLE_THEME_SQL, type CatalogListKeys, type CatalogShows, type CatalogSongRow, type CatalogTraits, type PoolMediaKind } from '../server/catalog.js';
import { all, db, one } from '../server/db.js';
import { requireEnv } from '../server/env.js';
import { contentKey } from './media.js';
import { deleteObject, putObject } from './r2.js';

const log = (...args: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...args);

interface AnimeRow {
  mal_id: number;
  canonical_id: number | null;
  franchise_id: number | null;
  title: string;
  title_en: string | null;
  title_ja: string | null;
  synonyms: string;
  year: number | null;
  media_type: string | null;
  members: number | null;
  source: string | null;
  studios: string;
  excluded: string | null;
}

/** A show's own row: its franchise's most popular entry, or itself before the franchise step ran (CANONICAL_SQL). */
const isCanonical = (a: AnimeRow) => a.canonical_id == null || Number(a.canonical_id) === Number(a.mal_id);

/**
 * Step `catalog` (every run ends with it, before `daily`): what pools filter on (catalog row 'shows'),
 * what Connections groups can share (catalog row 'traits'),
 * every completed list as shows (completed_shows), and the lists the browser loads from R2 (titles,
 * characters, facets; catalog row 'lists'). The game then reads a few rows per puzzle and none for the
 * lists, instead of whole tables (Turso bills rows read).
 */
export async function stepCatalog(): Promise<void> {
  // Every entry, excluded ones too: a popular season counts for its show even when the season itself is excluded.
  const anime = await all<AnimeRow>(
    `SELECT mal_id, canonical_id, franchise_id, title, title_en, title_ja, synonyms, year, media_type, members, source, studios, excluded
     FROM anime ORDER BY mal_id`,
  );
  const showOf = new Map(anime.map((a) => [Number(a.mal_id), Number(a.canonical_id ?? a.mal_id)]));
  const shows: CatalogShows = {};
  const canonical = anime.filter((a) => a.excluded == null && isCanonical(a));
  for (const a of canonical)
    shows[Number(a.mal_id)] = {
      franchise: a.franchise_id == null ? -Number(a.mal_id) : Number(a.franchise_id),
      difficulty: difficultyOf(a.members == null ? null : Number(a.members)),
      mediaType: a.media_type,
      genres: [],
      popular: false,
      media: { chars: false, shots: false },
      characters: [],
      songs: {},
    };

  const [genreRows, genres, popular, media, characters, songs] = await Promise.all([
    all<{ mal_id: number; genre_id: number }>('SELECT mal_id, genre_id FROM anime_genre'),
    all<{ id: number; name: string; type: GenreType }>('SELECT id, name, type FROM genre'),
    all<{ mal_id: number }>('SELECT mal_id FROM popular'),
    all<{ mal_id: number; kind: PoolMediaKind }>(`SELECT mal_id, kind FROM anime_media WHERE kind IN ('chars', 'shots') AND status = 'ok'`),
    all<{ mal_id: number; favorites: number }>('SELECT mal_id, favorites FROM anime_character WHERE favorites >= ?', [CHARACTER_MIN_FAVORITES]),
    all<CatalogSongRow & { id: number; show: number; artist: string | null }>(
      `SELECT t.id, t.kind, COALESCE(e.canonical_id, e.mal_id) AS show, e.members, t.artist, t.clip_key, t.title_spans IS NOT NULL AS scanned
       FROM ${USABLE_THEME_SQL} ORDER BY t.id`,
    ),
  ]);
  for (const g of genreRows) shows[Number(g.mal_id)]?.genres.push(Number(g.genre_id));
  for (const p of popular) {
    const id = showOf.get(Number(p.mal_id));
    const show = id === undefined ? undefined : shows[id];
    if (show) show.popular = true;
  }
  for (const m of media) {
    const show = shows[Number(m.mal_id)];
    if (show) show.media[m.kind] = true;
  }
  const characterDifficulties = new Map<number, Set<Difficulty>>();
  for (const c of characters) {
    const set = characterDifficulties.get(Number(c.mal_id)) ?? new Set<Difficulty>();
    set.add(characterDifficultyOf(Number(c.favorites)));
    characterDifficulties.set(Number(c.mal_id), set);
  }
  for (const [id, set] of characterDifficulties) {
    const show = shows[id];
    if (show) show.characters = DIFFICULTIES.filter((d) => set.has(d));
  }
  for (const s of songs) {
    const show = shows[Number(s.show)];
    if (show) show.songs[Number(s.id)] = catalogSong(s);
  }
  const traits = JSON.stringify(connectionTraits(canonical, shows, genreRows, genres, songs));

  const lists: CatalogLists = { titles: titleEntries(anime), characters: await characterEntries(), facets: facets(canonical, shows, genres) };
  const old = await one<{ value: string }>(`SELECT value FROM catalog WHERE key = 'lists'`);
  const previous = old ? (JSON.parse(old.value) as CatalogListKeys) : null;
  // Per database: a local run never deletes a list production still serves (same content = same key).
  const database = createHash('sha256').update(requireEnv('TURSO_DATABASE_URL')).digest('hex').slice(0, 8);
  const sizes: string[] = [];
  const upload = async (name: CatalogListName) => {
    const body = new TextEncoder().encode(JSON.stringify(lists[name]));
    const key = contentKey(`list/${database}/${name}`, body, 'json');
    if (key !== previous?.[name]) await putObject(key, body, 'application/json');
    sizes.push(`${name} ${Math.round(body.length / 1024)} KB`);
    return key;
  };
  const keys: Record<CatalogListName, string> = { titles: await upload('titles'), characters: await upload('characters'), facets: await upload('facets') };
  const live = new Set(Object.values(keys));
  const retired = previous ? [previous.titles, previous.characters, previous.facets].filter((key) => !live.has(key)) : [];

  await db().batch(
    [
      ...completedShowsWrites(),
      { sql: 'INSERT OR REPLACE INTO catalog (key, value) VALUES (?, ?)', args: ['shows', JSON.stringify(shows)] },
      { sql: 'INSERT OR REPLACE INTO catalog (key, value) VALUES (?, ?)', args: ['traits', traits] },
      { sql: 'INSERT OR REPLACE INTO catalog (key, value) VALUES (?, ?)', args: ['lists', JSON.stringify({ ...keys, previous: retired } satisfies CatalogListKeys)] },
    ],
    'write',
  );
  // The generation before the previous one: /api/lists stopped pointing at it a whole run ago.
  for (const key of previous?.previous ?? []) if (!live.has(key)) await deleteObject(key);
  log(`catalog: ${canonical.length} show, ${songs.length} lagu; ${sizes.join(', ')}, traits ${Math.round(traits.length / 1024)} KB`);
}

/**
 * Catalog row 'traits' (Connections): what each show can share with others (genres, themes,
 * demographic, source, studios, year, OP/ED artists), keeping only links that at least
 * CONNECTIONS_GROUP_SIZE franchises share: any other can never make a group.
 */
function connectionTraits(
  canonical: AnimeRow[],
  shows: CatalogShows,
  genreRows: Array<{ mal_id: number; genre_id: number }>,
  genres: Array<{ id: number; name: string; type: GenreType }>,
  songs: Array<{ show: number; artist: string | null }>,
): CatalogTraits {
  const genreOf = new Map(genres.map((g) => [Number(g.id), g]));
  const genresOf = Map.groupBy(genreRows, (g) => Number(g.mal_id));
  const artistsOf = new Map<number, Set<string>>();
  for (const s of songs) {
    if (!s.artist) continue;
    const set = artistsOf.get(Number(s.show)) ?? new Set<string>();
    set.add(s.artist);
    artistsOf.set(Number(s.show), set);
  }
  const linksOf = new Map<number, string[]>();
  const franchisesOf = new Map<string, Set<number>>();
  for (const a of canonical) {
    const id = Number(a.mal_id);
    const links = showLinks({
      genres: (genresOf.get(id) ?? []).flatMap((g) => genreOf.get(Number(g.genre_id)) ?? []),
      source: a.source,
      studios: JSON.parse(a.studios) as string[],
      year: a.year == null ? null : Number(a.year),
      artists: [...(artistsOf.get(id) ?? [])],
    });
    linksOf.set(id, links);
    for (const link of links) {
      const set = franchisesOf.get(link) ?? new Set<number>();
      set.add(shows[id]!.franchise);
      franchisesOf.set(link, set);
    }
  }
  const traits: CatalogTraits = {};
  for (const [id, links] of linksOf) traits[id] = links.filter((link) => franchisesOf.get(link)!.size >= CONNECTIONS_GROUP_SIZE);
  return traits;
}

/**
 * Autocomplete list: every show (one entry per franchise, named after its canonical entry but also
 * found by its other entries' names), so any pool's answer can be typed and the list itself does not
 * hint at which pool (or answer) is in play.
 */
function titleEntries(anime: AnimeRow[]): TitleEntry[] {
  // Canonical rows first (most members first), so every show exists before its other entries add their names.
  const rows = anime
    .filter((a) => a.excluded == null)
    .sort((a, b) => Number(isCanonical(b)) - Number(isCanonical(a)) || (b.members ?? -1) - (a.members ?? -1));
  const shows = new Map<number, { entry: Omit<TitleEntry, 'names'>; names: Set<string> }>();
  for (const r of rows) {
    const names = [r.title, r.title_en, r.title_ja, ...(JSON.parse(r.synonyms) as string[])].filter((n): n is string => Boolean(n));
    const show = shows.get(Number(r.canonical_id ?? r.mal_id));
    if (show) for (const n of names) show.names.add(n);
    else if (isCanonical(r))
      shows.set(Number(r.mal_id), {
        entry: { id: Number(r.mal_id), en: r.title_en && r.title_en !== r.title ? r.title_en : null, year: r.year == null ? null : Number(r.year), type: r.media_type },
        names: new Set(names),
      });
  }
  return [...shows.values()].map(({ entry, names }) => ({ ...entry, names: [...names] }));
}

/**
 * Name autocomplete: every character of every show (not only the ones asked), so the list does not
 * hint at the answers. A character listed under several titles appears once, and so do different
 * characters sharing a name (several "Rin"): they cannot be told apart without giving the anime away.
 */
async function characterEntries(): Promise<CharacterEntry[]> {
  const rows = await all<{ char_id: number; name: string; nicknames: string; aliases: string }>(
    `SELECT c.char_id, MIN(c.name) AS name, MAX(c.nicknames) AS nicknames, MAX(c.aliases) AS aliases
     FROM anime_character c JOIN anime a ON a.mal_id = c.mal_id
     WHERE a.excluded IS NULL AND ${CANONICAL_SQL} GROUP BY c.char_id ORDER BY MAX(a.members) DESC`,
  );
  // Keyed by the shown name; the id is the best known character's (rows come most popular show first).
  const byName = new Map<string, CharacterEntry>();
  for (const r of rows) {
    const shown = displayName(r.name);
    const entry = byName.get(shown.toLowerCase()) ?? { id: Number(r.char_id), names: [shown] };
    for (const n of characterAliases(r.nicknames, r.aliases, r.name)) if (!entry.names.includes(n)) entry.names.push(n);
    byName.set(shown.toLowerCase(), entry);
  }
  return [...byName.values()];
}

/** Database filter options with how many shows each has (ties by name, like SQLite's binary order). */
function facets(canonical: AnimeRow[], shows: CatalogShows, genres: Array<{ id: number; name: string; type: GenreType }>): DbFacets {
  const tally = <T>(values: Iterable<T>) => {
    const counts = new Map<T, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return counts;
  };
  const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const genreCounts = tally(Object.values(shows).flatMap((s) => s.genres));
  const studios = tally(canonical.flatMap((a) => JSON.parse(a.studios) as string[]));
  const sources = tally(canonical.flatMap((a) => (a.source == null ? [] : [a.source])));
  return {
    genres: genres
      .filter((g) => genreCounts.has(Number(g.id)))
      .map((g) => ({ id: Number(g.id), name: g.name, type: g.type, count: genreCounts.get(Number(g.id))! }))
      .sort((a, b) => byName(a.name, b.name)),
    studios: [...studios].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || byName(a.name, b.name)),
    sources: [...sources].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || byName(a.value, b.value)),
  };
}
