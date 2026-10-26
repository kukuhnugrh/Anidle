import { CHARACTERS_PER_ROUND, isRoundMode, isSongMode } from '../shared/modes.js';
import { viewer } from '../server/accounts.js';
import { characterGuess, type CharacterMove, type CharacterPick } from '../server/characters.js';
import { anidleGuess, getPuzzle } from '../server/game.js';
import { HttpError, json, readJson, route } from '../server/http.js';
import { roundMove } from '../server/rounds.js';
import { songMove, type SongMove } from '../server/songs.js';

/**
 * Anidle: { puzzleId, malId }.
 * Opening/Ending: { puzzleId, round, malId } | { puzzleId, round, clue: true } | { puzzleId, round, giveUp: true }.
 * Screenshot: { puzzleId, round, malId } | { puzzleId, round, clue: true } (next clue) | { puzzleId, round, giveUp: true }.
 * Character: { puzzleId, round, picks: [{ slot, field: 'name' | 'anime', id }] } (one Guess for every pick made) | { puzzleId, round, giveUp: true }.
 */
export const POST = route(async (req) => {
  const me = await viewer(req);
  const body = await readJson<{ puzzleId?: unknown; malId?: unknown; round?: unknown; picks?: unknown; giveUp?: unknown; clue?: unknown }>(req);
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

  let move: CharacterMove;
  if (body.giveUp === true) move = { kind: 'giveUp' };
  else if (Array.isArray(body.picks) && body.picks.length <= 2 * CHARACTERS_PER_ROUND) {
    const picks = body.picks.map((p: unknown): CharacterPick => {
      const { slot, field, id } = (p ?? {}) as Record<string, unknown>;
      if (!Number.isInteger(slot) || (field !== 'name' && field !== 'anime') || !Number.isInteger(id)) throw new HttpError(400, 'Each pick needs slot, field (name|anime) and id.');
      return { slot: Number(slot), field, id: Number(id) };
    });
    move = { kind: 'picks', picks };
  } else throw new HttpError(400, 'Send picks or giveUp.');
  return json(await characterGuess(puzzle, me.key, round, move), {}, me.cookies);
});
