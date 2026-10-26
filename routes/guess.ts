import { isRoundMode, isSongMode } from '../shared/modes.js';
import { viewer } from '../server/accounts.js';
import { characterGuess, type CharacterMove } from '../server/characters.js';
import { anidleGuess, getPuzzle } from '../server/game.js';
import { HttpError, json, readJson, route } from '../server/http.js';
import { roundMove } from '../server/rounds.js';
import { songMove, type SongMove } from '../server/songs.js';

/**
 * Anidle: { puzzleId, malId }.
 * Opening/Ending: { puzzleId, round, malId } | { puzzleId, round, clue: true } | { puzzleId, round, giveUp: true }.
 * Screenshot: { puzzleId, round, malId } | { puzzleId, round, clue: true } (next clue) | { puzzleId, round, giveUp: true }.
 * Character: { puzzleId, round, slot, charId } | { puzzleId, round, slot, malId } | { puzzleId, round, giveUp: true }.
 */
export const POST = route(async (req) => {
  const me = await viewer(req);
  const body = await readJson<{ puzzleId?: unknown; malId?: unknown; round?: unknown; slot?: unknown; charId?: unknown; giveUp?: unknown; clue?: unknown }>(req);
  if (typeof body.puzzleId !== 'string') throw new HttpError(400, 'puzzleId is required.');
  const puzzle = await getPuzzle(body.puzzleId);
  const malId = Number(body.malId);
  const round = Number(body.round);

  if (puzzle.mode === 'anidle') {
    if (!Number.isInteger(malId)) throw new HttpError(400, 'malId is required.');
    return json(await anidleGuess(puzzle, me.key, malId), {}, me.cookies);
  }
  if (!Number.isInteger(round)) throw new HttpError(400, 'round is required.');

  if (isSongMode(puzzle.mode) || isRoundMode(puzzle.mode)) {
    let move: SongMove;
    if (body.clue === true) move = { kind: 'clue' };
    else if (body.giveUp === true) move = { kind: 'giveUp' };
    else if (Number.isInteger(malId)) move = { kind: 'guess', malId };
    else throw new HttpError(400, 'Send a malId, clue, or giveUp.');
    const state = isSongMode(puzzle.mode) ? await songMove(puzzle, puzzle.mode, me.key, round, move) : await roundMove(puzzle, puzzle.mode, me.key, round, move);
    return json(state, {}, me.cookies);
  }

  const slot = Number(body.slot);
  const charId = Number(body.charId);
  let move: CharacterMove;
  if (body.giveUp === true) move = { kind: 'giveUp' };
  else if (Number.isInteger(charId) && charId > 0) move = { kind: 'name', slot, charId };
  else if (Number.isInteger(malId)) move = { kind: 'anime', slot, malId };
  else throw new HttpError(400, 'Send a charId, a malId, or giveUp.');
  return json(await characterGuess(puzzle, me.key, round, move), {}, me.cookies);
});
