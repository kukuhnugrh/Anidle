import { getJson, Limiter } from '../limiter.js';

// AnimeThemes (https://api.animethemes.moe) answers x-ratelimit-limit: 90 per minute; stay under it.
const limiter = new Limiter('animethemes', [{ ms: 60_000, max: 80 }]);

interface ApiTheme {
  type: 'OP' | 'ED' | string;
  sequence: number | null;
  slug: string;
  song?: { title?: string | null; artists?: Array<{ name: string }> } | null;
  animethemeentries?: Array<{ nsfw?: boolean; videos?: Array<{ link?: string; resolution?: number | null; audio?: { link?: string } | null }> }>;
}

export interface ThemeSource {
  /** e.g. OP1, ED1-TV */
  label: string;
  title: string | null;
  artist: string | null;
  audioUrl: string;
  /** The smallest video of the same entry (screenshots); null when it has none. */
  videoUrl: string | null;
}

export type ThemeKind = 'op' | 'ed';
export type FirstThemes = Record<ThemeKind, ThemeSource | null>;

/**
 * The first opening and ending of a MAL title that has an audio file, or null for a kind AnimeThemes
 * does not have. `OP1` wins over `OP1-TV`, which wins over `OP2`. Within a theme a SFW entry is preferred,
 * but an NSFW-flagged one (the flag is about the video) still counts: its video is a blurred clue anyway.
 */
export async function firstThemes(malId: number): Promise<FirstThemes> {
  const query = new URLSearchParams({
    'filter[has]': 'resources',
    'filter[site]': 'MyAnimeList',
    'filter[external_id]': String(malId),
    include: 'animethemes.animethemeentries.videos.audio,animethemes.song.artists',
  });
  const data = await limiter.schedule(() => getJson<{ anime?: Array<{ animethemes?: ApiTheme[] }> }>(`https://api.animethemes.moe/anime?${query}`));
  const themes = data.anime?.[0]?.animethemes ?? [];
  const pick = (type: 'OP' | 'ED'): ThemeSource | null => {
    const ordered = themes.filter((t) => t.type === type).sort((a, b) => (a.sequence ?? 1) - (b.sequence ?? 1) || a.slug.length - b.slug.length);
    for (const theme of ordered) {
      for (const entry of [...(theme.animethemeentries ?? [])].sort((a, b) => Number(a.nsfw ?? false) - Number(b.nsfw ?? false))) {
        const link = entry.videos?.find((v) => v.audio?.link)?.audio?.link;
        const video = [...(entry.videos ?? [])].filter((v) => v.link).sort((a, b) => (a.resolution ?? 9999) - (b.resolution ?? 9999))[0];
        if (link)
          return {
            label: theme.slug,
            title: theme.song?.title ?? null,
            artist: theme.song?.artists?.map((a) => a.name).join(', ') || null,
            audioUrl: link,
            videoUrl: video?.link ?? null,
          };
      }
    }
    return null;
  };
  return { op: pick('OP'), ed: pick('ED') };
}
