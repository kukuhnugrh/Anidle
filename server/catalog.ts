import type { InStatement } from '@libsql/client';
import { difficultyOf, type Difficulty } from '../shared/catalog.js';
import type { CatalogListName } from '../shared/database.js';
import type { MediaKind, ThemeKind } from '../shared/modes.js';
import { one, run } from './db.js';
import { HttpError } from './http.js';
import { mediaUrl } from './media.js';
import { CATALOG_TTL_MS, forget, memo, POOL_TTL_MS } from './memo.js';

// Turso bills every row read, and a pool is a filter over every show: built from anime, anime_theme,
// anime_character and completed per puzzle, it read 12k–50k rows. Pipeline step `catalog`
// (pipeline/catalog.ts) writes what pools filter on into one catalog row ('shows'), and each completed
// list as its shows into completed_shows, so a new puzzle reads a handful of rows.

/**
 * FROM … WHERE of the songs that can be asked (alias t, its MAL entry e): ok, from an entry that is not
 * excluded. A song's show is COALESCE(e.canonical_id, e.mal_id); its difficulty is its entry's members.
 */
export const USABLE_THEME_SQL = `anime_theme t JOIN anime e ON e.mal_id = t.mal_id WHERE t.status = 'ok' AND e.excluded IS NULL`;

/** The anime_media kinds a pool can require (Screenshot, Character). */
export type PoolMediaKind = Exclude<MediaKind, 'cover'>;

/** A usable song: its kind, and its own entry's difficulty (song modes stage rounds by it). */
export interface CatalogSong {
  kind: ThemeKind;
  difficulty: Difficulty;
}

/** What pools filter on for one show: an anime row that is canonical and not excluded. */
export interface CatalogShow {
  /** franchise_id, or -mal_id without one: titles sharing it never meet in one puzzle. */
  franchise: number;
  difficulty: Difficulty;
  mediaType: string | null;
  /** MAL genre ids (genres, themes, demographics) of the show's own entry. */
  genres: number[];
  /** One of its entries is in MAL's popularity ranking (table popular): the `populer` pool. */
  popular: boolean;
  /** Whether its anime_media of each kind is ok. */
  media: Record<PoolMediaKind, boolean>;
  /** The difficulties of its stored characters (by their own favorites): Character mode rounds. */
  characters: Difficulty[];
  /** Usable songs (USABLE_THEME_SQL) of all its entries, by anime_theme id. */
  songs: Record<string, CatalogSong>;
}

/** Catalog row 'shows': CatalogShow by show id. */
export type CatalogShows = Record<string, CatalogShow>;

/**
 * Catalog row 'traits' (Connections): each show's link keys (shared/connections.ts), by show id, only
 * links that enough franchises share to make a group. Its own row, so other modes never parse it.
 */
export type CatalogTraits = Record<string, string[]>;

/** Catalog row 'lists': the R2 keys of the current lists, and those of the generation before. */
export type CatalogListKeys = Record<CatalogListName, string> & {
  /** Deleted by the next rebuild: clients may still hold their URLs (CDN-cached /api/lists) until then. */
  previous: string[];
};

const SHOWS_MEMO = 'catalog:shows';

/**
 * Every show of the catalog, in id order (pools draw by index, so daily seeds need a stable order).
 * One row read per instance per CATALOG_TTL_MS; admin patches drop this instance's copy.
 */
export const catalogShows = (): Promise<Map<number, CatalogShow>> =>
  memo(SHOWS_MEMO, CATALOG_TTL_MS, async () => {
    const row = await one<{ value: string }>(`SELECT value FROM catalog WHERE key = 'shows'`);
    if (!row) throw new HttpError(503, 'The catalog has not been built yet (pipeline step catalog).');
    const shows = JSON.parse(row.value) as CatalogShows;
    return new Map(
      Object.entries(shows)
        .map(([id, show]): [number, CatalogShow] => [Number(id), show])
        .sort(([a], [b]) => a - b),
    );
  });

/** Every show's Connections links; one row read per instance per CATALOG_TTL_MS. */
export const catalogTraits = (): Promise<CatalogTraits> =>
  memo('catalog:traits', CATALOG_TTL_MS, async () => {
    const row = await one<{ value: string }>(`SELECT value FROM catalog WHERE key = 'traits'`);
    if (!row) throw new HttpError(503, 'Connections needs the catalog rebuilt first (pipeline step catalog).');
    return JSON.parse(row.value) as CatalogTraits;
  });

/** The current lists' public URLs (GET /api/lists). */
export const catalogListUrls = (): Promise<Record<CatalogListName, string>> =>
  memo('catalog:lists', CATALOG_TTL_MS, async () => {
    const row = await one<{ value: string }>(`SELECT value FROM catalog WHERE key = 'lists'`);
    if (!row) throw new HttpError(503, 'The catalog has not been built yet (pipeline step catalog).');
    const keys = JSON.parse(row.value) as CatalogListKeys;
    return { titles: mediaUrl(keys.titles), characters: mediaUrl(keys.characters), facets: mediaUrl(keys.facets) };
  });

/**
 * The completed shows of each of `usernames` that has a stored list (a player whose list holds only
 * titles not yet in the database still counts, with no shows). One row per player per POOL_TTL_MS.
 */
export async function completedShows(usernames: readonly string[]): Promise<Array<Set<number>>> {
  const lists = await Promise.all(
    usernames.map((username) =>
      memo(`completed-shows:${username.toLowerCase()}`, POOL_TTL_MS, async () => {
        const row = await one<{ shows: string }>('SELECT shows FROM completed_shows WHERE username = ?', [username]);
        return row ? new Set(JSON.parse(row.shows) as number[]) : null;
      }),
    ),
  );
  return lists.filter((list) => list !== null);
}

/** Rewrites completed_shows from `completed`: one player's row, or every row (pipeline step `catalog`). */
export function completedShowsWrites(username?: string): InStatement[] {
  const args = username === undefined ? [] : [username];
  return [
    { sql: `DELETE FROM completed_shows${username === undefined ? '' : ' WHERE username = ?'}`, args },
    {
      sql: `INSERT INTO completed_shows (username, shows)
            SELECT c.username, json_group_array(DISTINCT COALESCE(x.canonical_id, x.mal_id)) FILTER (WHERE x.mal_id IS NOT NULL)
            FROM completed c LEFT JOIN anime x ON x.mal_id = c.mal_id${username === undefined ? '' : ' WHERE c.username = ?'}
            GROUP BY c.username`,
      args,
    },
  ];
}

/** Patches the 'shows' row in one statement; a show outside the catalog (merged, excluded) is left alone. */
async function patchShow(showId: number, set: string, args: Array<string | number>): Promise<void> {
  await run(`UPDATE catalog SET value = ${set} WHERE key = 'shows' AND json_type(value, ?) IS NOT NULL`, [...args, `$."${showId}"`]);
  forget(SHOWS_MEMO);
}

/** Follows an admin's reject/restore of a show's media in the catalog, without a rebuild. */
export async function setCatalogMedia(showId: number, kind: PoolMediaKind, ok: boolean): Promise<void> {
  await patchShow(showId, 'json_set(value, ?, json(?))', [`$."${showId}".media.${kind}`, String(ok)]);
}

/** Follows an admin's reject/restore of a song in the catalog, without a rebuild (songs of excluded entries are never in it). */
export async function setCatalogSong(themeId: number, ok: boolean): Promise<void> {
  const theme = await one<{ show: number; kind: ThemeKind; members: number | null }>(
    `SELECT COALESCE(e.canonical_id, e.mal_id) AS show, t.kind, e.members FROM anime_theme t JOIN anime e ON e.mal_id = t.mal_id
     WHERE t.id = ? AND e.excluded IS NULL`,
    [themeId],
  );
  if (!theme) return;
  const show = Number(theme.show);
  const path = `$."${show}".songs."${themeId}"`;
  const song: CatalogSong = { kind: theme.kind, difficulty: difficultyOf(theme.members == null ? null : Number(theme.members)) };
  if (ok) await patchShow(show, 'json_set(value, ?, json(?))', [path, JSON.stringify(song)]);
  else await patchShow(show, 'json_remove(value, ?)', [path]);
}
