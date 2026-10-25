import { isCorrect } from '../shared/anidle.js';
import type { Pool } from '../shared/catalog.js';
import { characterAnswers, FIELD_POINTS, FIELD_TRIES, matchesCharacter, type CharacterField } from '../shared/characters.js';
import { ROUND_COUNT } from '../shared/modes.js';
import { all } from './db.js';
import { answerInfo, assertPlayable, loadAnidle, readPlay, writePlay, type AnswerInfo, type PuzzleRow } from './game.js';
import { HttpError } from './http.js';
import { mediaUrl } from './media.js';

// Character mode: ROUND_COUNT rounds of CHARACTERS_PER_ROUND characters from different anime. For each
// character the player types its name (nicknames count) and picks its anime, FIELD_TRIES tries each.
// play.guesses holds StoredRound[]: per round, per character, the typed names and the anime ids tried.
// Giving up fills the remaining tries with '' / 0.

interface StoredSlot {
  n: string[];
  a: number[];
}
type StoredRound = StoredSlot[];

export interface FieldState<T> {
  tries: T[];
  solved: boolean;
  finished: boolean;
  points: number;
}

export interface CharacterSlotState {
  portrait: string;
  name: FieldState<string>;
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
  tries: number;
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
  name: string;
  nicknames: string;
  name_kanji: string | null;
  r2_key: string;
}

async function loadSlots(puzzleId: string): Promise<SlotRow[][]> {
  const rows = await all<SlotRow>(
    `SELECT p.round, p.slot, p.mal_id, c.name, c.nicknames, c.name_kanji, c.r2_key
     FROM puzzle_character p JOIN anime_character c ON c.mal_id = p.mal_id AND c.char_id = p.char_id
     WHERE p.puzzle_id = ? ORDER BY p.round, p.slot`,
    [puzzleId],
  );
  const rounds = Array.from({ length: ROUND_COUNT }, (_, r) => rows.filter((s) => Number(s.round) === r));
  if (rounds.some((r) => !r.length)) throw new HttpError(500, 'Puzzle data is incomplete.');
  return rounds;
}

/** The try index of the first hit, or -1. */
const firstHit = <T>(tries: T[], hit: (t: T) => boolean) => tries.findIndex(hit);

function field<T>(tries: T[], solvedAt: number, kind: CharacterField): FieldState<T> {
  const solved = solvedAt >= 0;
  return { tries, solved, finished: solved || tries.length >= FIELD_TRIES, points: solved ? (FIELD_POINTS[kind][solvedAt] ?? 0) : 0 };
}

interface Evaluated {
  state: CharacterState;
  /** Characters with both name and anime right (play.solved). */
  perfect: number;
}

async function evaluate(puzzle: PuzzleRow, stored: StoredRound[]): Promise<Evaluated> {
  const slots = await loadSlots(puzzle.id);
  const ids = [...slots.flat().map((s) => Number(s.mal_id)), ...stored.flat().flatMap((s) => s.a.filter((id) => id > 0))];
  const anime = await loadAnidle(ids);
  let perfect = 0;
  const rounds = slots.map((roundSlots, r): CharacterRoundState => {
    const states = roundSlots.map((s, i): CharacterSlotState => {
      const answer = anime.get(Number(s.mal_id));
      if (!answer) throw new HttpError(500, 'An answer is missing from the database.');
      const nicknames = JSON.parse(s.nicknames) as string[];
      const accepted = characterAnswers({ name: s.name, nicknames, nameKanji: s.name_kanji });
      const tried = stored[r]?.[i] ?? { n: [], a: [] };
      const name = field(tried.n, firstHit(tried.n, (t) => matchesCharacter(t, accepted)), 'name');
      const animeField = field(
        tried.a.map((id) => ({ malId: id, title: id > 0 ? (anime.get(id)?.title ?? `#${id}`) : '' })),
        firstHit(tried.a, (id) => {
          const guess = anime.get(id);
          return guess !== undefined && isCorrect(answer, guess);
        }),
        'anime',
      );
      if (name.solved && animeField.solved) perfect++;
      const done = name.finished && animeField.finished;
      return {
        portrait: mediaUrl(s.r2_key),
        name,
        anime: animeField,
        answer: done ? { name: s.name, nicknames, anime: answerInfo(answer) } : null,
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
      tries: FIELD_TRIES,
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

export type CharacterMove = { kind: 'name'; slot: number; text: string } | { kind: 'anime'; slot: number; malId: number } | { kind: 'giveUp' };

/** One try in the current round: a typed name, a picked anime, or giving up on everything left in it. */
export async function characterGuess(puzzle: PuzzleRow, playerKey: string, round: number, move: CharacterMove): Promise<CharacterState> {
  const stored = await storedOf(puzzle.id, playerKey);
  const before = (await evaluate(puzzle, stored)).state;
  if (before.finished) throw new HttpError(409, 'This puzzle is already finished.');
  if (round !== before.current) throw new HttpError(409, 'That round is already over or has not started.');
  const roundState = before.rounds[round]!;
  const slots: StoredRound = roundState.slots.map((_, i) => ({ n: [...(stored[round]?.[i]?.n ?? [])], a: [...(stored[round]?.[i]?.a ?? [])] }));

  if (move.kind === 'giveUp') {
    slots.forEach((s, i) => {
      const st = roundState.slots[i]!;
      if (!st.name.finished) while (s.n.length < FIELD_TRIES) s.n.push('');
      if (!st.anime.finished) while (s.a.length < FIELD_TRIES) s.a.push(0);
    });
  } else {
    const slot = slots[move.slot];
    const st = roundState.slots[move.slot];
    if (!slot || !st) throw new HttpError(400, 'Unknown character.');
    if (move.kind === 'name') {
      const text = move.text.trim().slice(0, 80);
      if (!text) throw new HttpError(400, 'Type a name first.');
      if (st.name.finished) throw new HttpError(409, "That character's name is already settled.");
      if (slot.n.some((t) => t.toLowerCase() === text.toLowerCase())) throw new HttpError(409, 'You already tried that name.');
      slot.n.push(text);
    } else {
      if (st.anime.finished) throw new HttpError(409, "That character's anime is already settled.");
      if (slot.a.includes(move.malId)) throw new HttpError(409, 'You already tried that anime for this character.');
      await assertPlayable(move.malId);
      slot.a.push(move.malId);
    }
  }

  const next = [...stored];
  next[round] = slots;
  const after = await evaluate(puzzle, next);
  await writePlay(puzzle.id, playerKey, { guesses: next, solved: after.perfect, score: after.state.score, finished: after.state.finished });
  return after.state;
}
