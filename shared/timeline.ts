// Timeline (beta, unlimited only): ROUND_COUNT rounds of TIMELINE_SIZE titles from different years,
// put in the order they started airing. One submission per round; each title in its right place scores.
import { roundMaxPoints, TIMELINE_SIZE } from './modes.js';

/** Points per title in its right place. */
export const TIMELINE_POINT = roundMaxPoints('timeline') / TIMELINE_SIZE;

/** How many titles of `order` sit where `answer` (oldest first) has them. */
export const timelinePlaced = (order: readonly number[], answer: readonly number[]) => order.filter((id, i) => answer[i] === id).length;
