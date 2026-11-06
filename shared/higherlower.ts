// Higher or Lower (beta, unlimited only): a run of HIGHER_LOWER_STEPS + 1 titles. Each step shows the
// last title's MAL score and asks whether the next one scores higher or lower; the first miss ends it.
import { HIGHER_LOWER_STEPS, MODE_MAX_POINTS } from './modes.js';

export const HIGHER_LOWER_PICKS = ['higher', 'lower'] as const;
export type HigherLowerPick = (typeof HIGHER_LOWER_PICKS)[number];

/** Points per right pick: a full run is worth the mode's maximum. */
export const HIGHER_LOWER_POINT = MODE_MAX_POINTS.higherlower / HIGHER_LOWER_STEPS;
/** Neighbours in a run differ by at least this much MAL score, so a step is never a coin toss on 0.01. */
export const HIGHER_LOWER_MIN_GAP = 0.1;

/** Whether `pick` is right for a step from score `from` to score `to` (never equal in a run). */
export const higherLowerRight = (pick: HigherLowerPick, from: number, to: number) => (pick === 'higher' ? to > from : to < from);
