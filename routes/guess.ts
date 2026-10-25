import { isRoundMode, isSongMode } from '../shared/modes.js';
import { viewer } from '../server/accounts.js';
import { characterGuess, type CharacterMove } from '../server/characters.js';
import { anidleGuess, getPuzzle } from '../server/game.js';
import { HttpError, json, readJson, route } from '../server/http.js';
import { roundGuess } from '../server/rounds.js';
import { songMove, type SongMove } from '../server/songs.js';

/**
 * Anidle: { puzzleId, malId }.
 * Opening/Ending: { puzzleId, round, malId } | { puzzleId, round, clue: true } | { puzzleId, round, giveUp: true }.
 * Screenshot: { puzzleId, round, malId } or { puzzleId, round, skip: true }.
 * Character: { puzzleId, round, slot, name } | { puzzleId, round, slot, malId } | { puzzleId, round, giveUp: true }.
 */
export const POST = route(async (req) => {
  const me = await viewer(req);
  const body = await readJson<{ puzzleId?: unknown; malId?: unknown; round?: unknown; skip?: unknown; slot?: unknown; name?: unknown; giveUp?: unknown; clue?: unknown }>(req);
  if (typeof body.puzzleId !== 'string') throw new HttpError(400, 'puzzleId is required.');
  const puzzle = await getPuzzle(body.puzzleId);
  const malId = Number(body.malId);
  const round = Number(body.round);

  if (puzzle.mode === 'anidle') {
    if (!Number.isInteger(malId)) throw new HttpError(400, 'malId is required.');
    return json(await anidleGuess(puzzle, me.key, malId), {}, me.cookies);
  }
  if (!Number.isInteger(round)) throw new HttpError(400, 'round is required.');

  if (isSongMode(puzzle.mode)) {
    let move: SongMove;
    if (body.clue === true) move = { kind: 'clue' };
    else if (body.giveUp === true) move = { kind: 'giveUp' };
    else if (Number.isInteger(malId)) move = { kind: 'guess', malId };
    else throw new HttpError(400, 'Send a malId, clue, or giveUp.');
    return json(await songMove(puzzle, puzzle.mode, me.key, round, move), {}, me.cookies);
  }

  if (isRoundMode(puzzle.mode)) {
    const skip = body.skip === true;
    if (!skip && !Number.isInteger(malId)) throw new HttpError(400, 'malId is required.');
    return json(await roundGuess(puzzle, puzzle.mode, me.key, round, skip ? null : malId), {}, me.cookies);
  }

  const slot = Number(body.slot);
  let move: CharacterMove;
  if (body.giveUp === true) move = { kind: 'giveUp' };
  else if (typeof body.name === 'string') move = { kind: 'name', slot, text: body.name };
  else if (Number.isInteger(malId)) move = { kind: 'anime', slot, malId };
  else throw new HttpError(400, 'Send a name, a malId, or giveUp.');
  return json(await characterGuess(puzzle, me.key, round, move), {}, me.cookies);
});
