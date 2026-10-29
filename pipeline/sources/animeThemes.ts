import type { ThemeKind } from '../../shared/modes.js';
import { getJson, Limiter } from '../limiter.js';

// AnimeThemes (https://api.animethemes.moe) answers x-ratelimit-limit: 90 per minute; stay under it.
const limiter = new Limiter('animethemes', [{ ms: 60_000, max: 80 }]);

interface ApiTheme {
  id: number;
  type: 'OP' | 'ED' | string;
  sequence: number | null;
  slug: string;
  song?: { title?: string | null; artists?: Array<{ name: string }> } | null;
  animethemeentries?: Array<{ nsfw?: boolean; videos?: Array<{ link?: string; resolution?: number | null; audio?: { link?: string } | null }> }>;
}

export interface ThemeSource {
  /** AnimeThemes animetheme id. */
  id: number;
  kind: ThemeKind;
  /** AnimeThemes sequence (OP1 = 1; unnumbered = 1). */
  seq: number;
  /** e.g. OP1, ED1-TV */
  label: string;
  title: string | null;
  artist: string | null;
  audioUrl: string;
  /** The smallest video of the same entry (clue, screenshots); null when it has none. */
  videoUrl: string | null;
}

const KINDS: Record<string, ThemeKind> = { OP: 'op', ED: 'ed' };

/**
 * Every opening and ending of one MAL entry that has an audio file. Within a theme a SFW entry is
 * preferred, but an NSFW-flagged one (the flag is about the video) still counts: its video is a
 * blurred clue anyway.
 */
export async function entryThemes(malId: number): Promise<ThemeSource[]> {
  const query = new URLSearchParams({
    'filter[has]': 'resources',
    'filter[site]': 'MyAnimeList',
    'filter[external_id]': String(malId),
    include: 'animethemes.animethemeentries.videos.audio,animethemes.song.artists',
  });
  const data = await limiter.schedule(() => getJson<{ anime?: Array<{ animethemes?: ApiTheme[] }> }>(`https://api.animethemes.moe/anime?${query}`));
  const themes: ThemeSource[] = [];
  for (const theme of data.anime?.[0]?.animethemes ?? []) {
    const kind = KINDS[theme.type];
    if (!kind) continue;
    for (const entry of [...(theme.animethemeentries ?? [])].sort((a, b) => Number(a.nsfw ?? false) - Number(b.nsfw ?? false))) {
      const link = entry.videos?.find((v) => v.audio?.link)?.audio?.link;
      if (!link) continue;
      const video = [...(entry.videos ?? [])].filter((v) => v.link).sort((a, b) => (a.resolution ?? 9999) - (b.resolution ?? 9999))[0];
      themes.push({
        id: theme.id,
        kind,
        seq: theme.sequence ?? 1,
        label: theme.slug,
        title: theme.song?.title ?? null,
        artist: theme.song?.artists?.map((a) => a.name).join(', ') || null,
        audioUrl: link,
        videoUrl: video?.link ?? null,
      });
      break;
    }
  }
  return themes;
}

/** An entry's first theme of a kind: `OP1` wins over `OP1-TV`, which wins over `OP2`. */
export function firstTheme<T extends Pick<ThemeSource, 'kind' | 'seq' | 'label'>>(themes: T[], kind: ThemeKind): T | undefined {
  return themes.filter((t) => t.kind === kind).sort((a, b) => a.seq - b.seq || a.label.length - b.label.length)[0];
}
