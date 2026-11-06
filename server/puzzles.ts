import { isRoundMode, isSongMode, type BetaMode } from '../shared/modes.js';
import { characterState, type CharacterState } from './characters.js';
import { connectionsPuzzle, connectionsState, type ConnectionsState } from './connections.js';
import { anidleState, type AnidleState, type PoolSpec, type PuzzleOptions, type PuzzleRow } from './game.js';
import { higherLowerPuzzle, higherLowerState, type HigherLowerState } from './higherlower.js';
import { oddOneOutPuzzle, oddOneOutState, type OddOneOutState } from './oddoneout.js';
import { roundState, type RoundState } from './rounds.js';
import { songState, type SongState } from './songs.js';
import { synopsisPuzzle, synopsisState, type SynopsisState } from './synopsis.js';
import { timelinePuzzle, timelineState, type TimelineState } from './timeline.js';

export type PuzzleState = AnidleState | SongState | RoundState | CharacterState | ConnectionsState | SynopsisState | HigherLowerState | OddOneOutState | TimelineState;

/** The player's view of any puzzle, by mode. */
export function puzzleState(puzzle: PuzzleRow, playerKey: string): Promise<PuzzleState> {
  const mode = puzzle.mode;
  if (isSongMode(mode)) return songState(puzzle, mode, playerKey);
  if (isRoundMode(mode)) return roundState(puzzle, mode, playerKey);
  switch (mode) {
    case 'anidle':
      return anidleState(puzzle, playerKey);
    case 'character':
      return characterState(puzzle, playerKey);
    case 'connections':
      return connectionsState(puzzle, playerKey);
    case 'synopsis':
      return synopsisState(puzzle, playerKey);
    case 'higherlower':
      return higherLowerState(puzzle, playerKey);
    case 'oddoneout':
      return oddOneOutState(puzzle, playerKey);
    case 'timeline':
      return timelineState(puzzle, playerKey);
  }
}

/** New unlimited puzzles of the beta modes, which draw their own shape instead of drawRounds. */
export const BETA_PUZZLES: Record<BetaMode, (spec: PoolSpec, options: PuzzleOptions, playerKey: string) => Promise<PuzzleRow>> = {
  connections: connectionsPuzzle,
  synopsis: synopsisPuzzle,
  higherlower: higherLowerPuzzle,
  oddoneout: oddOneOutPuzzle,
  timeline: timelinePuzzle,
};
