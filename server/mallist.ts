import { animeList, toHttpError, type MalAuth, type MalListStatus } from './mal.js';
import { forget, memo } from './memo.js';
import { userAccessToken } from './players.js';

export type MalListCategory = MalListStatus['status'];

/** One anime on a player's MAL list, as the "My MAL list" page shows it. */
export interface MalListEntry {
  id: number;
  title: string;
  titleEn: string | null;
  picture: string | null;
  /** tv, movie, ova, ona, special, music, … */
  type: string | null;
  /** MAL airing status: finished_airing, currently_airing, not_yet_aired. */
  airing: string | null;
  episodes: number | null;
  year: number | null;
  season: string | null;
  /** MAL's community score. */
  mean: number | null;
  genres: string[];
  studios: string[];
  status: MalListCategory;
  /** The player's own score, 0 = not scored. */
  score: number;
  watched: number;
  rewatching: boolean;
  updatedAt: string;
  startedOn: string | null;
  finishedOn: string | null;
}

export interface MalList {
  username: string;
  entries: MalListEntry[];
  fetchedAt: string;
}

/** The list is read live from MAL (nothing is stored); a warm instance reuses it this long unless asked fresh. */
const LIST_TTL_MS = 2 * 60_000;

/** The whole MAL anime list of a linked player, every status. */
export function malList(malUsername: string, fresh = false): Promise<MalList> {
  const key = `mal-list:${malUsername.toLowerCase()}`;
  if (fresh) forget(key);
  return memo(key, LIST_TTL_MS, async () => {
    const token = await userAccessToken(malUsername);
    const auth: MalAuth = token ? { kind: 'user', accessToken: token } : { kind: 'client' };
    const items = await animeList(token ? '@me' : malUsername, auth).catch((err: unknown) => {
      throw toHttpError(err);
    });
    return {
      username: malUsername,
      fetchedAt: new Date().toISOString(),
      entries: items.map(({ node: n, list_status: s }) => ({
        id: n.id,
        title: n.title,
        titleEn: n.alternative_titles?.en && n.alternative_titles.en !== n.title ? n.alternative_titles.en : null,
        picture: n.main_picture?.medium ?? n.main_picture?.large ?? null,
        type: n.media_type ?? null,
        airing: n.status ?? null,
        episodes: n.num_episodes || null,
        year: n.start_season?.year ?? null,
        season: n.start_season?.season ?? null,
        mean: n.mean ?? null,
        genres: (n.genres ?? []).map((g) => g.name),
        studios: (n.studios ?? []).map((s) => s.name),
        status: s.status,
        score: s.score,
        watched: s.num_episodes_watched,
        rewatching: s.is_rewatching,
        updatedAt: s.updated_at,
        startedOn: s.start_date ?? null,
        finishedOn: s.finish_date ?? null,
      })),
    };
  });
}
