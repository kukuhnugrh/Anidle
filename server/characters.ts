import { isCorrect } from '../shared/anidle.js';
import { CANONICAL_SQL, type Pool } from '../shared/catalog.js';
import { CHARACTER_FIELD_POINTS, displayName } from '../shared/characters.js';
import { ROUND_COUNT } from '../shared/modes.js';
import type { CharacterEntry } from '../shared/normalize.js';
import { all } from './db.js';
import { answerInfo, assertPlayable, loadAnidle, readPlay, writePlay, type AnswerInfo, type PuzzleRow } from './game.js';
import { HttpError } from './http.js';
import { mediaUrl } from './media.js';

// Character mode: ROUND_COUNT rounds of CHARACTERS_PER_ROUND characters from different anime. For each
// character the player picks its name (a character id) and its anime (a mal_id), one pick each.
// play.guesses holds StoredRound[]: per round, per character, the picked ids; 0 = given up.

interface StoredSlot {
  n: number | null;
  a: number | null;
}
type StoredRound = StoredSlot[];

export interface FieldState<T> {
  /** The pick, or null while open; a given-up field is finished with a null pick. */
  pick: T | null;
  solved: boolean;
  finished: boolean;
  points: number;
}

export interface CharacterSlotState {
  portrait: string;
  name: FieldState<{ charId: number; name: string }>;
  anime: FieldState<{ malId: number; title: string }>;
  /** Once both fields are over. */
  answer: { name: string; nicknames: string[]; anime: AnswerInfo } | null;
}

export interface CharacterRoundState {
  slots: CharacterSlotState[];
  finished: boolean;
  points: number;
}

export interface CharacterState {
  id: string;
  mode: 'character';
  date: string | null;
  pool: Pool;
  rounds: CharacterRoundState[];
  /** First unfinished round, rounds.length once the puzzle is over. */
  current: number;
  finished: boolean;
  score: number | null;
}

interface SlotRow {
  round: number;
  slot: number;
  mal_id: number;
  char_id: number;
  name: string;
  nicknames: string;
  r2_key: string;
}

async function loadSlots(puzzleId: string): Promise<SlotRow[][]> {
  const rows = await all<SlotRow>(
    `SELECT p.round, p.slot, p.mal_id, p.char_id, c.name, c.nicknames, c.r2_key
     FROM puzzle_character p JOIN anime_character c ON c.mal_id = p.mal_id AND c.char_id = p.char_id
     WHERE p.puzzle_id = ? ORDER BY p.round, p.slot`,
    [puzzleId],
  );
  const rounds = Array.from({ length: ROUND_COUNT }, (_, r) => rows.filter((s) => Number(s.round) === r));
  if (rounds.some((r) => !r.length)) throw new HttpError(500, 'Puzzle data is incomplete.');
  return rounds;
}

/** Names of picked characters (a character listed under several titles has the same name in each). */
async function characterNames(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await all<{ char_id: number; name: string }>(`SELECT char_id, MIN(name) AS name FROM anime_character WHERE char_id IN (${ids.map(() => '?').join(',')}) GROUP BY char_id`, ids);
  return new Map(rows.map((r) => [Number(r.char_id), r.name]));
}

function field<T>(pick: T | null, given: boolean, solved: boolean): FieldState<T> {
  return { pick, solved, finished: given, points: solved ? CHARACTER_FIELD_POINTS : 0 };
}

interface Evaluated {
  state: CharacterState;
  /** Characters with both name and anime right (play.solved). */
  perfect: number;
}

async function evaluate(puzzle: PuzzleRow, stored: StoredRound[]): Promise<Evaluated> {
  const slots = await loadSlots(puzzle.id);
  const picks = stored.flat();
  const anime = await loadAnidle([...slots.flat().map((s) => Number(s.mal_id)), ...picks.flatMap((s) => (s.a ? [s.a] : []))]);
  const names = await characterNames(picks.flatMap((s) => (s.n ? [s.n] : [])));
  let perfect = 0;
  const rounds = slots.map((roundSlots, r): CharacterRoundState => {
    const states = roundSlots.map((s, i): CharacterSlotState => {
      const answer = anime.get(Number(s.mal_id));
      if (!answer) throw new HttpError(500, 'An answer is missing from the database.');
      const tried = stored[r]?.[i] ?? { n: null, a: null };
      const name = field(tried.n ? { charId: tried.n, name: displayName(names.get(tried.n) ?? `#${tried.n}`) } : null, tried.n != null, tried.n === Number(s.char_id));
      const guessed = tried.a ? anime.get(tried.a) : undefined;
      const animeField = field(tried.a ? { malId: tried.a, title: guessed?.title ?? `#${tried.a}` } : null, tried.a != null, guessed !== undefined && isCorrect(answer, guessed));
      if (name.solved && animeField.solved) perfect++;
      const done = name.finished && animeField.finished;
      return {
        portrait: mediaUrl(s.r2_key),
        name,
        anime: animeField,
        answer: done ? { name: displayName(s.name), nicknames: JSON.parse(s.nicknames) as string[], anime: answerInfo(answer) } : null,
      };
    });
    return { slots: states, finished: states.every((s) => s.answer), points: states.reduce((sum, s) => sum + s.name.points + s.anime.points, 0) };
  });
  const current = rounds.findIndex((r) => !r.finished);
  const finished = current < 0;
  return {
    state: {
      id: puzzle.id,
      mode: 'character',
      date: puzzle.date,
      pool: puzzle.pool,
      rounds,
      current: finished ? rounds.length : current,
      finished,
      score: finished ? rounds.reduce((sum, r) => sum + r.points, 0) : null,
    },
    perfect,
  };
}

const storedOf = async (puzzleId: string, playerKey: string): Promise<StoredRound[]> => {
  const play = await readPlay(puzzleId, playerKey);
  return play ? (JSON.parse(play.guesses) as StoredRound[]) : [];
};

export async function characterState(puzzle: PuzzleRow, playerKey: string): Promise<CharacterState> {
  return (await evaluate(puzzle, await storedOf(puzzle.id, playerKey))).state;
}

export type CharacterMove = { kind: 'name'; slot: number; charId: number } | { kind: 'anime'; slot: number; malId: number } | { kind: 'giveUp' };

/** One pick in the current round: a character, an anime, or giving up on every field left in it. */
export async function characterGuess(puzzle: PuzzleRow, playerKey: string, round: number, move: CharacterMove): Promise<CharacterState> {
  const stored = await storedOf(puzzle.id, playerKey);
  const before = (await evaluate(puzzle, stored)).state;
  if (before.finished) throw new HttpError(409, 'This puzzle is already finished.');
  if (round !== before.current) throw new HttpError(409, 'That round is already over or has not started.');
  const slots: StoredRound = before.rounds[round]!.slots.map((_, i) => ({ n: stored[round]?.[i]?.n ?? null, a: stored[round]?.[i]?.a ?? null }));

  if (move.kind === 'giveUp') {
    for (const s of slots) {
      s.n ??= 0;
      s.a ??= 0;
    }
  } else {
    const slot = slots[move.slot];
    if (!slot) throw new HttpError(400, 'Unknown character.');
    if (move.kind === 'name') {
      if (slot.n != null) throw new HttpError(409, "That character's name is already settled.");
      if (!(await characterNames([move.charId])).size) throw new HttpError(400, 'Unknown character.');
      slot.n = move.charId;
    } else {
      if (slot.a != null) throw new HttpError(409, "That character's anime is already settled.");
      await assertPlayable(move.malId);
      slot.a = move.malId;
    }
  }

  const next = [...stored];
  next[round] = slots;
  const after = await evaluate(puzzle, next);
  await writePlay(puzzle.id, playerKey, { guesses: next, solved: after.perfect, score: after.state.score, finished: after.state.finished });
  return after.state;
}

/**
 * Name autocomplete: every character of every show (not only the ones asked), so the list does not
 * hint at the answers. A character listed under several titles appears once.
 */
export async function characterEntries(): Promise<CharacterEntry[]> {
  const rows = await all<{ char_id: number; name: string; name_kanji: string | null; nicknames: string }>(
    `SELECT c.char_id, MIN(c.name) AS name, MAX(c.name_kanji) AS name_kanji, MAX(c.nicknames) AS nicknames
     FROM anime_character c JOIN anime a ON a.mal_id = c.mal_id
     WHERE a.excluded IS NULL AND ${CANONICAL_SQL} GROUP BY c.char_id ORDER BY MAX(a.members) DESC`,
  );
  return rows.map((r) => ({
    id: Number(r.char_id),
    names: [...new Set([displayName(r.name), r.name_kanji, ...(JSON.parse(r.nicknames) as string[])].filter((n): n is string => Boolean(n)))],
  }));
}
