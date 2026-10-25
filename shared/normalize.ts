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

export interface TitleEntry {
  id: number;
  /** Romaji title, English title, Japanese title, synonyms. */
  names: string[];
  year: number | null;
  type: string | null;
}

interface Indexed {
  entry: TitleEntry;
  folded: string[];
}

export function indexTitles(entries: TitleEntry[]): Indexed[] {
  return entries.map((entry) => ({ entry, folded: entry.names.map(normalizeTitle).filter(Boolean) }));
}

/**
 * Autocomplete: every query word must appear in one of the names. Ranked by
 * exact match > prefix of a name > word prefix > substring, then shorter name.
 */
export function searchTitles(index: Indexed[], query: string, limit = 8, exclude: ReadonlySet<number> = new Set()): TitleEntry[] {
  const q = normalizeTitle(query);
  if (!q) return [];
  const words = q.split(' ');
  const scored: Array<{ entry: TitleEntry; rank: number; length: number }> = [];
  for (const { entry, folded } of index) {
    if (exclude.has(entry.id)) continue;
    let best: { rank: number; length: number } | null = null;
    for (const name of folded) {
      if (!words.every((w) => name.includes(w))) continue;
      const rank = name === q ? 0 : name.startsWith(q) ? 1 : ` ${name}`.includes(` ${words[0]}`) ? 2 : 3;
      if (!best || rank < best.rank || (rank === best.rank && name.length < best.length)) best = { rank, length: name.length };
    }
    if (best) scored.push({ entry, ...best });
  }
  scored.sort((a, b) => a.rank - b.rank || a.length - b.length);
  return scored.slice(0, limit).map((s) => s.entry);
}
