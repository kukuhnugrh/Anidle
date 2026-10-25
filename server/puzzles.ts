import { isRoundMode } from '../shared/modes.js';
import { anidleState, type AnidleState, type PuzzleRow } from './game.js';
import { roundState, type RoundState } from './rounds.js';

export type PuzzleState = AnidleState | RoundState;

/** The player's view of any puzzle, by mode. */
export function puzzleState(puzzle: PuzzleRow, playerKey: string): Promise<PuzzleState> {
  return isRoundMode(puzzle.mode) ? roundState(puzzle, puzzle.mode, playerKey) : anidleState(puzzle, playerKey);
}
