import { isCorrect } from '../shared/anidle.js';
import { CANONICAL_SQL, DIFFICULTIES, type Difficulty, type Pool } from '../shared/catalog.js';
import { CHARACTER_FIELDS_PER_ROUND, characterDifficultyOf, displayName, type CharacterField } from '../shared/characters.js';
import { ROUND_COUNT, ROUND_MAX_POINTS } from '../shared/modes.js';
import type { CharacterEntry } from '../shared/normalize.js';
import { all } from './db.js';
import { answerInfo, assertPlayable, loadAnidle, readPlay, writePlay, type AnswerInfo, type PuzzleRow } from './game.js';
import { HttpError } from './http.js';
import { mediaUrl } from './media.js';

// Character mode: ROUND_COUNT rounds of CHARACTERS_PER_ROUND characters from different anime. For each
// character the player picks its name (a character id) and its anime (a mal_id); one Guess answers the
// whole round, an empty field counting as wrong. play.guesses holds StoredRound[]: per round, per
// character, the picked ids; 0 = left empty.

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
  /** Difficulties of the round's characters by their own popularity (one per kind, usually just one), shown from the start. */
  difficulties: Difficulty[];
  finished: boolean;
  points: number;
  /** All 8 fields right (ROUND_MAX_POINTS). */
  max: number;
  /** One right field (max / 8). */
  fieldPoints: number;
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
  favorites: number | null;
  r2_key: string;
}

async function loadSlots(puzzleId: string): Promise<SlotRow[][]> {
  const rows = await all<SlotRow>(
    `SELECT p.round, p.slot, p.mal_id, p.char_id, c.name, c.nicknames, c.favorites, c.r2_key
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

function field<T>(pick: T | null, given: boolean, solved: boolean, worth: number): FieldState<T> {
  return { pick, solved, finished: given, points: solved ? worth : 0 };
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
  // Shows (canonical entries, as the autocomplete offers them) each asked character appears in: any of them is right.
  const charIds = slots.flat().map((s) => Number(s.char_id));
  const appearances = await all<{ char_id: number; show: number }>(
    `SELECT cs.char_id, COALESCE(a.canonical_id, a.mal_id) AS show FROM character_show cs JOIN anime a ON a.mal_id = cs.mal_id
     WHERE cs.char_id IN (${charIds.map(() => '?').join(',')})`,
    charIds,
  );
  const showsOf = Map.groupBy(appearances, (r) => Number(r.char_id));
  let perfect = 0;
  const rounds = slots.map((roundSlots, r): CharacterRoundState => {
    const difficulties: Difficulty[] = [];
    const worth = ROUND_MAX_POINTS[r]! / CHARACTER_FIELDS_PER_ROUND;
    const states = roundSlots.map((s, i): CharacterSlotState => {
      const answer = anime.get(Number(s.mal_id));
      if (!answer) throw new HttpError(500, 'An answer is missing from the database.');
      const info = answerInfo(answer);
      // The character's own popularity, not its anime's, sets the difficulty.
      difficulties.push(characterDifficultyOf(Number(s.favorites ?? 0)));
      const tried = stored[r]?.[i] ?? { n: null, a: null };
      const picked = tried.n ? names.get(tried.n) : undefined;
      // Graded by name, not char_id: the autocomplete offers same-named characters as one entry.
      const nameRight = picked !== undefined && displayName(picked).toLowerCase() === displayName(s.name).toLowerCase();
      const name = field(tried.n ? { charId: tried.n, name: displayName(picked ?? `#${tried.n}`) } : null, tried.n != null, nameRight, worth);
      const guessed = tried.a ? anime.get(tried.a) : undefined;
      const animeRight = guessed !== undefined && (isCorrect(answer, guessed) || (showsOf.get(Number(s.char_id)) ?? []).some((row) => Number(row.show) === guessed.malId));
      const animeField = field(tried.a ? { malId: tried.a, title: guessed?.title ?? `#${tried.a}` } : null, tried.a != null, animeRight, worth);
      if (name.solved && animeField.solved) perfect++;
      const done = name.finished && animeField.finished;
      return {
        portrait: mediaUrl(s.r2_key),
        name,
        anime: animeField,
        answer: done ? { name: displayName(s.name), nicknames: JSON.parse(s.nicknames) as string[], anime: info } : null,
      };
    });
    return {
      slots: states,
      difficulties: DIFFICULTIES.filter((d) => difficulties.includes(d)),
      finished: states.every((s) => s.answer),
      points: states.reduce((sum, s) => sum + s.name.points + s.anime.points, 0),
      max: ROUND_MAX_POINTS[r]!,
      fieldPoints: worth,
    };
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

export interface CharacterPick {
  slot: number;
  field: CharacterField;
  /** char_id for a name, mal_id for an anime. */
  id: number;
}

/**
 * The round's one Guess: every pick made (possibly none); each field left empty is answered wrong, so
 * the round is over and cannot be guessed again.
 */
export async function characterGuess(puzzle: PuzzleRow, playerKey: string, round: number, picks: CharacterPick[]): Promise<CharacterState> {
  const stored = await storedOf(puzzle.id, playerKey);
  const before = (await evaluate(puzzle, stored)).state;
  if (before.finished) throw new HttpError(409, 'This puzzle is already finished.');
  if (round !== before.current) throw new HttpError(409, 'That round is already over or has not started.');
  const slots: StoredRound = before.rounds[round]!.slots.map(() => ({ n: 0, a: 0 }));
  const names = await characterNames(picks.filter((p) => p.field === 'name').map((p) => p.id));
  for (const pick of picks) {
    const slot = slots[pick.slot];
    if (!slot) throw new HttpError(400, 'Unknown character.');
    if (pick.field === 'name') {
      if (!names.has(pick.id)) throw new HttpError(400, 'Unknown character.');
      slot.n = pick.id;
    } else {
      await assertPlayable(pick.id);
      slot.a = pick.id;
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
 * hint at the answers. A character listed under several titles appears once, and so do different
 * characters sharing a name (several "Rin"): they cannot be told apart without giving the anime away.
 */
export async function characterEntries(): Promise<CharacterEntry[]> {
  const rows = await all<{ char_id: number; name: string; name_kanji: string | null; nicknames: string }>(
    `SELECT c.char_id, MIN(c.name) AS name, MAX(c.name_kanji) AS name_kanji, MAX(c.nicknames) AS nicknames
     FROM anime_character c JOIN anime a ON a.mal_id = c.mal_id
     WHERE a.excluded IS NULL AND ${CANONICAL_SQL} GROUP BY c.char_id ORDER BY MAX(a.members) DESC`,
  );
  // Keyed by the shown name; the id is the best known character's (rows come most popular show first).
  const byName = new Map<string, CharacterEntry>();
  for (const r of rows) {
    const shown = displayName(r.name);
    const entry = byName.get(shown.toLowerCase()) ?? { id: Number(r.char_id), names: [shown] };
    for (const n of [r.name_kanji, ...(JSON.parse(r.nicknames) as string[])]) if (n && !entry.names.includes(n)) entry.names.push(n);
    byName.set(shown.toLowerCase(), entry);
  }
  return [...byName.values()];
}
