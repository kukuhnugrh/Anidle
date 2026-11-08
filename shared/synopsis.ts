// Synopsis (beta, unlimited only): ROUND_COUNT rounds of one title, easy → medium → hard. Its MAL synopsis
// (title and character names masked) opens one sentence at a time, then SYNOPSIS_EXTRA_CLUES; the player
// has SYNOPSIS_GUESSES guesses. Every clue opened and every wrong guess costs SYNOPSIS_STEP_COST.
import { roundMaxPoints } from './modes.js';

/** Sentences a round can show; a longer synopsis keeps its first ones (the later ones give most away anyway). */
export const SYNOPSIS_MAX_SENTENCES = 5;
/** A shorter synopsis is never asked: it would leave no sentence to open. */
export const SYNOPSIS_MIN_SENTENCES = 3;
/** Clues after the last sentence: the show's year, studio and genres, then its title's first letters. */
export const SYNOPSIS_EXTRA_CLUES = ['facts', 'title'] as const;
/** Guesses per round: a wrong one leaves the round open until the last. */
export const SYNOPSIS_GUESSES = 3;
/**
 * Points off a right guess per clue opened and per wrong guess before it. Every clue (4 sentences + 2
 * extra) and both wrong guesses leave a fifth of the round, so a right guess always scores.
 */
export const SYNOPSIS_STEP_COST = roundMaxPoints('synopsis') / 10;

/** Clues a round of `sentences` sentences has: every sentence after the first, then SYNOPSIS_EXTRA_CLUES. */
export const synopsisClueCount = (sentences: number) => sentences - 1 + SYNOPSIS_EXTRA_CLUES.length;

/** A (masked) synopsis as its first SYNOPSIS_MAX_SENTENCES sentences: split after . ! ? … before a capital, digit or mask. */
export function synopsisSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…]["'”’)\]]*)\s+(?=["'“‘(\[]?[\p{Lu}\p{N}▇])/u)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, SYNOPSIS_MAX_SENTENCES);
}

export const synopsisPoints = (solved: boolean, clues: number, misses: number) => (solved ? roundMaxPoints('synopsis') - SYNOPSIS_STEP_COST * (clues + misses) : 0);
