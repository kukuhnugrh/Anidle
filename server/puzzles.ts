import { isThemeMode } from '../shared/modes.js';
import { anidleState, type AnidleState, type PuzzleRow } from './game.js';
import { themeState, type ThemeState } from './themes.js';

export type PuzzleState = AnidleState | ThemeState;

/** The player's view of any puzzle, by mode. */
export function puzzleState(puzzle: PuzzleRow, playerKey: string): Promise<PuzzleState> {
  return isThemeMode(puzzle.mode) ? themeState(puzzle, puzzle.mode, playerKey) : anidleState(puzzle, playerKey);
}
