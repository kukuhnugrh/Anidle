/**
 * Folds a title for matching: case, diacritics/macrons (Shōnen → shonen), punctuation and
 * whitespace are ignored. Non-Latin scripts (葬送のフリーレン) are kept as-is.
 */
export function normalizeTitle(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** A title with every letter or digit masked except each word's first: "Naruto" → "N_____", "Shingeki no Kyojin" → "S_______ n_ K_____". */
export function titleHint(title: string): string {
  return title.replace(/[\p{L}\p{N}]+/gu, (word) => {
    const [first = '', ...rest] = word;
    return first + '_'.repeat(rest.length);
  });
}

/** Something the autocomplete can offer: an anime (TitleEntry) or a character (CharacterEntry). */
export interface SearchEntry {
  id: number;
  /** Every name it is known by; names[0] is shown, names[1] as the detail when there is no other. */
  names: string[];
}

export interface TitleEntry extends SearchEntry {
  /** Romaji title, English title, Japanese title, synonyms, then the other entries' names of the show. */
  names: string[];
  year: number | null;
  type: string | null;
}

/** id = MAL character id; names = "Edward Elric", kanji, nicknames. */
export type CharacterEntry = SearchEntry;

interface Indexed<T extends SearchEntry> {
  entry: T;
  names: Array<{ name: string; folded: string }>;
}

export function indexNames<T extends SearchEntry>(entries: T[]): Array<Indexed<T>> {
  return entries.map((entry) => ({ entry, names: entry.names.map((name) => ({ name, folded: normalizeTitle(name) })).filter((n) => n.folded) }));
}

export interface SearchHit<T extends SearchEntry> {
  entry: T;
  /** The name that matched best: another season's title or a nickname can stand for the entry. */
  name: string;
}

/**
 * Autocomplete: every query word must appear in one of the names. Ranked by
 * exact match > prefix of a name > word prefix > substring, then shorter name.
 */
export function searchNames<T extends SearchEntry>(index: Array<Indexed<T>>, query: string, limit = 8, exclude: ReadonlySet<number> = new Set()): Array<SearchHit<T>> {
  const q = normalizeTitle(query);
  if (!q) return [];
  const words = q.split(' ');
  const scored: Array<SearchHit<T> & { rank: number; length: number }> = [];
  for (const { entry, names } of index) {
    if (exclude.has(entry.id)) continue;
    let best: { name: string; rank: number; length: number } | null = null;
    for (const { name, folded } of names) {
      if (!words.every((w) => folded.includes(w))) continue;
      const rank = folded === q ? 0 : folded.startsWith(q) ? 1 : ` ${folded}`.includes(` ${words[0]}`) ? 2 : 3;
      if (!best || rank < best.rank || (rank === best.rank && folded.length < best.length)) best = { name, rank, length: folded.length };
    }
    if (best) scored.push({ entry, ...best });
  }
  scored.sort((a, b) => a.rank - b.rank || a.length - b.length);
  return scored.slice(0, limit).map(({ entry, name }) => ({ entry, name }));
}
