// Connections (beta, unlimited only): CONNECTIONS_GROUPS × CONNECTIONS_GROUP_SIZE titles on one board,
// split into hidden groups that each share one link (a genre, theme, studio, source, year, OP/ED artist).
// The player picks a group's titles at a time; CONNECTIONS_MAX_MISTAKES wrong picks end the board.
import type { GenreType } from './catalog.js';
import { CONNECTIONS_GROUPS, MODE_MAX_POINTS } from './modes.js';

export const CONNECTIONS_GROUP_SIZE = 4;
export const CONNECTIONS_MAX_MISTAKES = 4;
/** Points off a solved board per wrong guess; running out of mistakes scores 0. */
export const CONNECTIONS_MISTAKE_COST = MODE_MAX_POINTS.connections / CONNECTIONS_MAX_MISTAKES;

export const LINK_KINDS = ['genre', 'theme', 'demographic', 'source', 'studio', 'year', 'artist'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** What the player calls each link kind (the setup's picker, the game's intro). MAL demographics (Shounen, Seinen…) show as Tags. */
export const LINK_KIND_LABELS: Record<LinkKind, string> = {
  genre: 'Genre',
  theme: 'Theme',
  demographic: 'Tags',
  source: 'Source',
  studio: 'Studio',
  year: 'Year',
  artist: 'OP/ED artist',
};

/**
 * The kinds group n is drawn from first, easiest first (the board's yellow, green, blue, purple). A pool
 * without such a link (no artist shared by four shows, say) falls back to any kind.
 */
export const LINK_TIERS: ReadonlyArray<readonly LinkKind[]> = [['genre', 'demographic'], ['theme', 'source'], ['studio'], ['year', 'artist']];

/** MAL sources too vague to be a link. */
const VAGUE_SOURCES: Record<string, true> = { other: true, mixed_media: true, unknown: true };

const GENRE_KIND: Record<GenreType, LinkKind | null> = { genres: 'genre', themes: 'theme', demographics: 'demographic', explicit_genres: null };

/** A link as stored (catalog row 'traits', puzzle_group.link): `kind:value`, e.g. `studio:MAPPA`, `year:2019`. */
export const linkKey = (kind: LinkKind, value: string | number) => `${kind}:${value}`;

export function parseLink(key: string): { kind: LinkKind; value: string } {
  const at = key.indexOf(':');
  return { kind: key.slice(0, at) as LinkKind, value: key.slice(at + 1) };
}

/** What a show can share with others, as link keys (pipeline step `catalog`). */
export function showLinks(show: {
  genres: ReadonlyArray<{ name: string; type: GenreType }>;
  source: string | null;
  studios: readonly string[];
  year: number | null;
  artists: readonly string[];
}): string[] {
  const links = new Set<string>();
  for (const g of show.genres) {
    const kind = GENRE_KIND[g.type];
    if (kind) links.add(linkKey(kind, g.name));
  }
  if (show.source && !VAGUE_SOURCES[show.source]) links.add(linkKey('source', show.source));
  for (const s of show.studios) links.add(linkKey('studio', s));
  if (show.year != null) links.add(linkKey('year', show.year));
  for (const a of show.artists) links.add(linkKey('artist', a));
  return [...links];
}

/** A group's name once it is found: "Studio: MAPPA", "Aired in 2019". */
export function linkLabel(key: string): string {
  const { kind, value } = parseLink(key);
  switch (kind) {
    case 'genre':
      return `Genre: ${value}`;
    case 'theme':
      return `Theme: ${value}`;
    case 'demographic':
      return `Tags: ${value}`;
    case 'source':
      return value === 'original' ? 'Anime original (no source material)' : `Adapted from a ${value.replace(/_/g, ' ').replace(/^4 koma/, '4-koma')}`;
    case 'studio':
      return `Studio: ${value}`;
    case 'year':
      return `Aired in ${value}`;
    case 'artist':
      return `OP or ED by ${value}`;
  }
}

export interface BoardCandidate {
  malId: number;
  /** Titles sharing it never meet on one board. */
  franchise: number;
  links: readonly string[];
}

/** A group of a new board: its link and its titles. */
export interface BoardGroup {
  link: string;
  malIds: number[];
}

/** The candidates carrying each link, keeping only links that CONNECTIONS_GROUP_SIZE franchises share (any other can never make a group). */
export function usableLinks(candidates: readonly BoardCandidate[]): Map<string, BoardCandidate[]> {
  const members = new Map<string, BoardCandidate[]>();
  for (const c of candidates)
    for (const link of c.links) {
      const list = members.get(link);
      if (list) list.push(c);
      else members.set(link, [c]);
    }
  for (const [link, list] of members) if (new Set(list.map((c) => c.franchise)).size < CONNECTIONS_GROUP_SIZE) members.delete(link);
  return members;
}

/** `count` random titles of `from` from different franchises (partial Fisher–Yates on a copy), or null if it runs out. */
export function sampleFranchises(from: readonly BoardCandidate[], count: number, random: (size: number) => number): BoardCandidate[] | null {
  const list = [...from];
  const picked: BoardCandidate[] = [];
  const taken = new Set<number>();
  for (let i = 0; i < list.length && picked.length < count; i++) {
    const j = i + random(list.length - i);
    [list[i], list[j]] = [list[j]!, list[i]!];
    const c = list[i]!;
    if (taken.has(c.franchise)) continue;
    taken.add(c.franchise);
    picked.push(c);
  }
  return picked.length === count ? picked : null;
}

/**
 * A new board from `candidates` (a pool's shows), groups easiest first per LINK_TIERS, or null when the
 * pool cannot fill one. Every group's link is shared by its own titles and by no other title on the
 * board, so the board has exactly one solution in terms of its links. `random(size)` is an index below size.
 */
export function drawBoard(candidates: readonly BoardCandidate[], random: (size: number) => number, attempts = 200): BoardGroup[] | null {
  const members = usableLinks(candidates);
  const usable = [...members.keys()];
  const byTier = LINK_TIERS.map((kinds) => usable.filter((link) => kinds.includes(parseLink(link).kind)));

  for (let attempt = 0; attempt < attempts; attempt++) {
    const groups: BoardGroup[] = [];
    const chosen = new Set<string>();
    const onBoard: BoardCandidate[] = [];
    const franchises = new Set<number>();

    /** CONNECTIONS_GROUP_SIZE titles for `link` that carry no other chosen link, or null. */
    const fill = (link: string): BoardCandidate[] | null => {
      if (chosen.has(link) || onBoard.some((c) => c.links.includes(link))) return null;
      const eligible = members.get(link)!.filter((c) => !franchises.has(c.franchise) && !c.links.some((l) => chosen.has(l)));
      return sampleFranchises(eligible, CONNECTIONS_GROUP_SIZE, random);
    };

    for (let g = 0; g < CONNECTIONS_GROUPS; g++) {
      let group: BoardCandidate[] | null = null;
      let link = '';
      for (const from of [byTier[g] ?? [], usable]) {
        for (let n = 0; n < 20 && from.length && !group; n++) {
          link = from[random(from.length)]!;
          group = fill(link);
        }
        if (group) break;
      }
      if (!group) break;
      chosen.add(link);
      for (const c of group) {
        onBoard.push(c);
        franchises.add(c.franchise);
      }
      groups.push({ link, malIds: group.map((c) => c.malId) });
    }
    if (groups.length === CONNECTIONS_GROUPS) return groups;
  }
  return null;
}

/** A guess against the board's groups: the group it found, or whether it was one title off one. */
export function judgeGuess(groups: ReadonlyArray<readonly number[]>, guess: readonly number[]): { group: number | null; oneAway: boolean } {
  let oneAway = false;
  for (const [i, ids] of groups.entries()) {
    const hits = guess.filter((id) => ids.includes(id)).length;
    if (hits === CONNECTIONS_GROUP_SIZE) return { group: i, oneAway: false };
    if (hits === CONNECTIONS_GROUP_SIZE - 1) oneAway = true;
  }
  return { group: null, oneAway };
}

/** A solved board: the full points minus CONNECTIONS_MISTAKE_COST per wrong guess; not solved: 0. */
export const connectionsScore = (solved: boolean, mistakes: number) => (solved ? MODE_MAX_POINTS.connections - CONNECTIONS_MISTAKE_COST * mistakes : 0);
