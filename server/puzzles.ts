import { isRoundMode, isSongMode } from '../shared/modes.js';
import { characterState, type CharacterState } from './characters.js';
import { anidleState, type AnidleState, type PuzzleRow } from './game.js';
import { roundState, type RoundState } from './rounds.js';
import { songState, type SongState } from './songs.js';

export type PuzzleState = AnidleState | SongState | RoundState | CharacterState;

/** The player's view of any puzzle, by mode. */
export function puzzleState(puzzle: PuzzleRow, playerKey: string): Promise<PuzzleState> {
  if (isSongMode(puzzle.mode)) return songState(puzzle, puzzle.mode, playerKey);
  if (isRoundMode(puzzle.mode)) return roundState(puzzle, puzzle.mode, playerKey);
  return puzzle.mode === 'character' ? characterState(puzzle, playerKey) : anidleState(puzzle, playerKey);
}
