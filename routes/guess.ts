import { HIGHER_LOWER_PICKS, type HigherLowerPick } from '../shared/higherlower.js';
import { CHARACTERS_PER_ROUND, isRoundMode, isSongMode } from '../shared/modes.js';
import { viewer } from '../server/accounts.js';
import { characterGuess, type CharacterPick } from '../server/characters.js';
import { connectionsGuess } from '../server/connections.js';
import { anidleGuess, anidleSkip, getPuzzle } from '../server/game.js';
import { higherLowerMove } from '../server/higherlower.js';
import { HttpError, json, readJson, route } from '../server/http.js';
import { oddOneOutMove } from '../server/oddoneout.js';
import { roundMove } from '../server/rounds.js';
import { songMove, type SongMove } from '../server/songs.js';
import { synopsisMove } from '../server/synopsis.js';
import { timelineMove } from '../server/timeline.js';

const isIdList = (value: unknown): value is number[] => Array.isArray(value) && value.every(Number.isInteger);

/**
 * Anidle: { puzzleId, malId } | { puzzleId, skip: true } (uses the tries up to the next clue).
 * Opening/Ending: { puzzleId, round, malId } | { puzzleId, round, clue: true } | { puzzleId, round, giveUp: true }.
 * Screenshot and Synopsis: { puzzleId, round, malId } | { puzzleId, round, clue: true } (next clue) | { puzzleId, round, giveUp: true }.
 * Character: { puzzleId, round, picks: [{ slot, field: 'name' | 'anime', id }] }: the round's one Guess; fields without a pick count as wrong.
 * Connections: { puzzleId, malIds: [four titles of the board] }.
 * Higher or Lower: { puzzleId, pick: 'higher' | 'lower' }.
 * Odd One Out: { puzzleId, round, malId } (the odd title). Timeline: { puzzleId, round, order: [the round's titles, oldest first] }.
 */
export const POST = route(async (req) => {
  const me = await viewer(req);
  const body = await readJson<{
    puzzleId?: unknown;
    malId?: unknown;
    malIds?: unknown;
    order?: unknown;
    pick?: unknown;
    round?: unknown;
    picks?: unknown;
    giveUp?: unknown;
    clue?: unknown;
    skip?: unknown;
  }>(req);
  if (typeof body.puzzleId !== 'string') throw new HttpError(400, 'puzzleId is required.');
  const puzzle = await getPuzzle(body.puzzleId);
  const malId = Number(body.malId);
  const round = Number(body.round);

  if (puzzle.mode === 'anidle') {
    if (body.skip === true) return json(await anidleSkip(puzzle, me.key), {}, me.cookies);
    if (!Number.isInteger(malId)) throw new HttpError(400, 'malId or skip is required.');
    return json(await anidleGuess(puzzle, me.key, malId), {}, me.cookies);
  }
  if (puzzle.mode === 'connections') {
    if (!isIdList(body.malIds)) throw new HttpError(400, 'malIds (a list of title ids) is required.');
    return json(await connectionsGuess(puzzle, me.key, body.malIds), {}, me.cookies);
  }
  if (puzzle.mode === 'higherlower') {
    if (!(HIGHER_LOWER_PICKS as readonly unknown[]).includes(body.pick)) throw new HttpError(400, 'pick must be higher or lower.');
    return json(await higherLowerMove(puzzle, me.key, body.pick as HigherLowerPick), {}, me.cookies);
  }
  if (!Number.isInteger(round)) throw new HttpError(400, 'round is required.');

  if (puzzle.mode === 'oddoneout') {
    if (!Number.isInteger(malId)) throw new HttpError(400, 'malId is required.');
    return json(await oddOneOutMove(puzzle, me.key, round, malId), {}, me.cookies);
  }
  if (puzzle.mode === 'timeline') {
    if (!isIdList(body.order)) throw new HttpError(400, 'order (a list of title ids) is required.');
    return json(await timelineMove(puzzle, me.key, round, body.order), {}, me.cookies);
  }

  if (isSongMode(puzzle.mode) || isRoundMode(puzzle.mode) || puzzle.mode === 'synopsis') {
    let move: SongMove;
    if (body.clue === true) move = { kind: 'clue' };
    else if (body.giveUp === true) move = { kind: 'giveUp' };
    else if (Number.isInteger(malId)) move = { kind: 'guess', malId };
    else throw new HttpError(400, 'Send a malId, clue, or giveUp.');
    const state = isSongMode(puzzle.mode)
      ? await songMove(puzzle, puzzle.mode, me.key, round, move)
      : isRoundMode(puzzle.mode)
        ? await roundMove(puzzle, puzzle.mode, me.key, round, move)
        : await synopsisMove(puzzle, me.key, round, move);
    return json(state, {}, me.cookies);
  }

  if (!Array.isArray(body.picks) || body.picks.length > 2 * CHARACTERS_PER_ROUND) throw new HttpError(400, "Send the round's picks (an empty list leaves every field empty).");
  const picks = body.picks.map((p: unknown): CharacterPick => {
    const { slot, field, id } = (p ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(slot) || (field !== 'name' && field !== 'anime') || !Number.isInteger(id)) throw new HttpError(400, 'Each pick needs slot, field (name|anime) and id.');
    return { slot: Number(slot), field, id: Number(id) };
  });
  return json(await characterGuess(puzzle, me.key, round, picks), {}, me.cookies);
});
