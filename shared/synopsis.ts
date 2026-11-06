// Synopsis (beta, unlimited only): ROUND_COUNT rounds of one title. Its MAL synopsis (title and
// character names masked) opens one sentence at a time; each extra sentence costs SYNOPSIS_CLUE_COST.
import { roundMaxPoints } from './modes.js';

/** Sentences a round can show; a longer synopsis keeps its first ones (the later ones give most away anyway). */
export const SYNOPSIS_MAX_SENTENCES = 5;
/** A shorter synopsis is never asked: it would leave no clue to open. */
export const SYNOPSIS_MIN_SENTENCES = 3;
/** Points off a right guess per extra sentence opened: the last one leaves a fifth of the round. */
export const SYNOPSIS_CLUE_COST = roundMaxPoints('synopsis') / SYNOPSIS_MAX_SENTENCES;

/** A (masked) synopsis as its first SYNOPSIS_MAX_SENTENCES sentences: split after . ! ? … before a capital, digit or mask. */
export function synopsisSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…]["'”’)\]]*)\s+(?=["'“‘(\[]?[\p{Lu}\p{N}▇])/u)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, SYNOPSIS_MAX_SENTENCES);
}

export const synopsisPoints = (solved: boolean, clues: number) => (solved ? roundMaxPoints('synopsis') - SYNOPSIS_CLUE_COST * clues : 0);
