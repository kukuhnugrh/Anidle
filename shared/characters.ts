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
/** Below this almost nobody knows the character: never stored or asked. */
export const CHARACTER_MIN_FAVORITES = 100;

export function characterDifficultyOf(favorites: number): Difficulty {
  if (favorites >= CHARACTER_EASY_MIN_FAVORITES) return 'easy';
  if (favorites >= CHARACTER_MEDIUM_MIN_FAVORITES) return 'medium';
  return 'hard';
}

/** The pipeline keeps up to this many characters per difficulty per show (the best known of each). */
export const CHARACTERS_PER_DIFFICULTY = 3;

/** Character difficulty asked in each round: easy, medium, hard. */
export const CHARACTER_ROUND_DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

/** A right pick is worth an equal share of the round's points: 4 characters × 2 fields. */
export const CHARACTER_FIELDS_PER_ROUND = CHARACTERS_PER_ROUND * 2;

/** MAL lists names family-first ("Elric, Edward"); show them the way people say them. */
export const displayName = (name: string) => name.split(', ').reverse().join(' ');
