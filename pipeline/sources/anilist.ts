import { Limiter, UpstreamError } from '../limiter.js';

// AniList allows 90 requests a minute, but runs at 30 while degraded (Oct 2026); stay under that.
const limiter = new Limiter('anilist', [{ ms: 60_000, max: 28 }]);

export interface AniListCharacter {
  full: string | null;
  /** Alternative names, without the spoiler ones (AniList keeps those apart). */
  alternative: string[];
}

const QUERY = `query ($idMal: Int, $page: Int) {
  Media(idMal: $idMal, type: ANIME) {
    characters(page: $page, perPage: 50, sort: FAVOURITES_DESC) {
      pageInfo { hasNextPage }
      nodes { name { full alternative } }
    }
  }
}`;

interface Response {
  data?: { Media: { characters: { pageInfo: { hasNextPage: boolean }; nodes: Array<{ name: { full: string | null; alternative: Array<string | null> | null } }> } } | null };
  errors?: Array<{ message: string; status?: number }>;
}

/**
 * One page (50, best known first) of the characters AniList lists for a MAL anime entry; `more` = a next
 * page exists. An entry AniList does not know returns no characters.
 */
export async function anilistCharacters(malId: number, page: number): Promise<{ characters: AniListCharacter[]; more: boolean }> {
  const res = await limiter.schedule(async () => {
    const r = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'anidle-pipeline/0.1' },
      body: JSON.stringify({ query: QUERY, variables: { idMal: malId, page } }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await r.json().catch(() => ({}))) as Response;
    // "Not Found" for an unknown idMal comes back as a 404 error, not as a failure to retry.
    if (r.status === 404 || body.errors?.some((e) => e.status === 404)) return { data: { Media: null } } satisfies Response;
    if (!r.ok) throw new UpstreamError(r.status, `${r.status} anilist ${malId}: ${JSON.stringify(body.errors ?? '').slice(0, 200)}`);
    return body;
  });
  const characters = res.data?.Media?.characters;
  if (!characters) return { characters: [], more: false };
  return {
    characters: characters.nodes.map((n) => ({ full: n.name.full, alternative: (n.name.alternative ?? []).filter((a): a is string => Boolean(a)) })),
    more: characters.pageInfo.hasNextPage,
  };
}
