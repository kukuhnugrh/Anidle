import type { Difficulty } from './catalog.js';
import { CHARACTERS_PER_ROUND } from './modes.js';

// Character mode: every round shows CHARACTERS_PER_ROUND characters from different anime. For each
// one the player picks the character's name and its anime from the autocomplete; one Guess per round.

export type CharacterField = 'name' | 'anime';

/**
 * A character's difficulty comes from its own MAL favorites, not its anime's popularity: Naruto
 * himself is easy, Rock Lee medium, Chouji hard, all from an easy show.
 */
export const CHARACTER_EASY_MIN_FAVORITES = 5_000;
export const CHARACTER_MEDIUM_MIN_FAVORITES = 500;
/**
 * Below this almost nobody knows the character: never stored or asked. Every character of a show at or above it is kept.
 * 100 left 46 medium shows (200k–500k members) without a single character, their best known at 82–99 (Nov 2026).
 */
export const CHARACTER_MIN_FAVORITES = 50;

export function characterDifficultyOf(favorites: number): Difficulty {
  if (favorites >= CHARACTER_EASY_MIN_FAVORITES) return 'easy';
  if (favorites >= CHARACTER_MEDIUM_MIN_FAVORITES) return 'medium';
  return 'hard';
}

/** Character difficulty asked in each round: easy, medium, hard. */
export const CHARACTER_ROUND_DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

/** A right pick is worth an equal share of the round's points: 4 characters × 2 fields. */
export const CHARACTER_FIELDS_PER_ROUND = CHARACTERS_PER_ROUND * 2;

/** MAL lists names family-first ("Elric, Edward"); show them the way people say them. */
export const displayName = (name: string) => name.split(', ').reverse().join(' ');

/**
 * Character names are answered in romaji only: a nickname in kana, kanji, hangul or any other non-Latin
 * script ("宮村 伊澄") is not offered or accepted. Digits, punctuation and macrons (Ōta) are fine.
 */
export const isRomaji = (name: string) => /^[\p{Script=Latin}\p{N}\p{P}\p{S}\p{Zs}\p{M}]+$/u.test(name);

/** Lowercase name words without accents or punctuation: "Monkey D., Luffy" → monkey, d, luffy. */
const nameWords = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * Whether AniList's name for a character ("Luffy Monkey", given name first) is MAL's ("Monkey D.,
 * Luffy"): one name's words are all in the other's, in any order. A one-word name must match exactly,
 * so "Luffy" alone never claims "Monkey D., Luffy" (and ties are left unmatched by the caller).
 */
export function sameCharacterName(malName: string, anilistName: string): boolean {
  const a = nameWords(malName);
  const b = nameWords(anilistName);
  if (!a.length || !b.length) return false;
  if (a.length === 1 || b.length === 1) return a.length === b.length && a[0] === b[0];
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.every((w) => long.includes(w));
}

/** An AniList alternative name as an alias: "Bon Clay (ボンクーレイ)" → "Bon Clay"; null when not romaji. */
export function aliasOf(alternative: string): string | null {
  const name = alternative.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  return name && isRomaji(name) ? name : null;
}

/** Every alias of a character, once each (case-insensitive): MAL nicknames, then AniList alternative names. */
export function characterAliases(nicknames: string, aliases: string, name: string): string[] {
  const seen = new Set([displayName(name).toLowerCase()]);
  const out: string[] = [];
  for (const n of [...(JSON.parse(nicknames) as string[]), ...(JSON.parse(aliases) as string[])]) {
    if (seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out;
}
