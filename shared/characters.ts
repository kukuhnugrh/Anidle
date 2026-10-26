import { CHARACTERS_PER_ROUND, CHARACTERS_PER_TITLE, MAX_ROUND_POINTS } from './modes.js';

// Character mode: every round shows CHARACTERS_PER_ROUND characters from different anime. For each
// one the player picks the character's name and its anime from the autocomplete, one pick per field.

export type CharacterField = 'name' | 'anime';

/** The character asked for a title: its best known one (anime_character slots go least → most favourited). */
export const CHARACTER_QUIZ_SLOT = CHARACTERS_PER_TITLE - 1;

/** A right pick: a round's 500 points split over its 4 characters × 2 fields (62.5 each). */
export const CHARACTER_FIELD_POINTS = MAX_ROUND_POINTS / (CHARACTERS_PER_ROUND * 2);

/** MAL lists names family-first ("Elric, Edward"); show them the way people say them. */
export const displayName = (name: string) => name.split(', ').reverse().join(' ');
