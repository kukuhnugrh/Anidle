import { isCorrect } from '../shared/anidle.js';
import type { Difficulty, Pool } from '../shared/catalog.js';
import { ROUND_COUNT, SCREENSHOT_CLUES, SCREENSHOT_POINTS, SCREENSHOTS_PER_TITLE, type RoundMode } from '../shared/modes.js';
import { titleHint } from '../shared/normalize.js';
import { all } from './db.js';
import { answerInfo, assertPlayable, loadAnidle, readPlay, writePlay, type AnswerInfo, type PuzzleRow } from './game.js';
import { HttpError } from './http.js';
import { mediaUrl } from './media.js';

// Screenshot: ROUND_COUNT rounds of one title. The first screenshot shows; the player may open
// SCREENSHOT_CLUES one by one (2nd screenshot, 3rd screenshot, masked title), each costing
// SCREENSHOT_POINTS.perClue, and makes one guess. Only what is opened leaves the server.
// play.guesses holds StoredRound[]: g = guessed mal_id (0 = gave up, null = not yet), c = clues opened.

interface StoredRound {
  g: number | null;
  c: number;
}

export interface RoundPlayState {
  /** The screenshots opened so far (all of them once the round is over). */
  media: string[];
  /** Clues opened (0..SCREENSHOT_CLUES.length). */
  clues: number;
  /** The masked title ("N_____"), once its clue is opened or the round is over. */
  hint: { title: string; english: string | null } | null;
  /** The answer's difficulty: shown from the start, like the round's label. */
  difficulty: Difficulty;
  guess: { malId: number; title: string } | null;
  gaveUp: boolean;
  solved: boolean;
  finished: boolean;
  points: number;
  /** Only once the round is over. */
  answer: AnswerInfo | null;
}

export interface RoundState {
  id: string;
  mode: RoundMode;
  date: string | null;
  pool: Pool;
  points: typeof SCREENSHOT_POINTS;
  rounds: RoundPlayState[];
  /** First unfinished round, rounds.length once the puzzle is over. */
  current: number;
  finished: boolean;
  score: number | null;
  /** The player's own unlimited puzzle: an untouched round whose image does not load may be swapped. */
  canReplace: boolean;
}

interface RoundRow {
  malId: number;
  title: string;
  titleEn: string | null;
  media: string[];
}

async function loadRounds(puzzleId: string): Promise<RoundRow[]> {
  const rounds = await all<{ mal_id: number; title: string; title_en: string | null }>(
    'SELECT r.mal_id, a.title, a.title_en FROM puzzle_round r JOIN anime a ON a.mal_id = r.mal_id WHERE r.puzzle_id = ? ORDER BY r.round',
    [puzzleId],
  );
  const ids = rounds.map((r) => Number(r.mal_id));
  const rows = await all<{ mal_id: number; r2_key: string }>(`SELECT mal_id, r2_key FROM anime_screenshot WHERE mal_id IN (${ids.map(() => '?').join(',')}) ORDER BY slot`, ids);
  const byTitle = Map.groupBy(rows, (r) => Number(r.mal_id));
  const loaded = rounds.map((r) => ({ malId: Number(r.mal_id), title: r.title, titleEn: r.title_en, media: (byTitle.get(Number(r.mal_id)) ?? []).map((s) => mediaUrl(s.r2_key)) }));
  if (loaded.length !== ROUND_COUNT || loaded.some((r) => r.media.length < SCREENSHOTS_PER_TITLE)) throw new HttpError(500, 'Puzzle data is incomplete.');
  return loaded;
}

const storedRounds = async (puzzleId: string, playerKey: string): Promise<StoredRound[]> => {
  const play = await readPlay(puzzleId, playerKey);
  return play ? (JSON.parse(play.guesses) as StoredRound[]) : [];
};

interface Evaluated {
  state: RoundState;
  solvedRounds: number;
}

async function evaluate(puzzle: PuzzleRow, mode: RoundMode, playerKey: string, stored: StoredRound[]): Promise<Evaluated> {
  const rounds = await loadRounds(puzzle.id);
  const anime = await loadAnidle([...rounds.map((r) => r.malId), ...stored.flatMap((s) => (s.g ? [s.g] : []))]);
  const states = rounds.map((r, i): RoundPlayState => {
    const answer = anime.get(r.malId);
    if (!answer) throw new HttpError(500, 'An answer is missing from the database.');
    const played = stored[i] ?? { g: null, c: 0 };
    const guessed = played.g ? anime.get(played.g) : undefined;
    const solved = guessed !== undefined && isCorrect(answer, guessed);
    const finished = played.g !== null;
    const opened = finished ? SCREENSHOT_CLUES : SCREENSHOT_CLUES.slice(0, played.c);
    const info = answerInfo(answer);
    return {
      media: r.media.slice(0, 1 + opened.filter((c) => c === 'shot').length),
      clues: played.c,
      hint: opened.includes('title') ? { title: titleHint(r.title), english: r.titleEn && r.titleEn !== r.title ? titleHint(r.titleEn) : null } : null,
      difficulty: info.difficulty,
      guess: played.g ? { malId: played.g, title: guessed?.title ?? `#${played.g}` } : null,
      gaveUp: played.g === 0,
      solved,
      finished,
      points: solved ? SCREENSHOT_POINTS.max - SCREENSHOT_POINTS.perClue * played.c : 0,
      answer: finished ? info : null,
    };
  });
  const current = states.findIndex((s) => !s.finished);
  const finished = current < 0;
  return {
    state: {
      id: puzzle.id,
      mode,
      date: puzzle.date,
      pool: puzzle.pool,
      points: SCREENSHOT_POINTS,
      rounds: states,
      current: finished ? states.length : current,
      finished,
      score: finished ? states.reduce((sum, s) => sum + s.points, 0) : null,
      canReplace: puzzle.date == null && puzzle.created_by === playerKey,
    },
    solvedRounds: states.filter((s) => s.solved).length,
  };
}

export async function roundState(puzzle: PuzzleRow, mode: RoundMode, playerKey: string): Promise<RoundState> {
  return (await evaluate(puzzle, mode, playerKey, await storedRounds(puzzle.id, playerKey))).state;
}

export type RoundMove = { kind: 'guess'; malId: number } | { kind: 'clue' } | { kind: 'giveUp' };

/** One move in the current round: open the next clue, guess (once), or give up. */
export async function roundMove(puzzle: PuzzleRow, mode: RoundMode, playerKey: string, round: number, move: RoundMove): Promise<RoundState> {
  const stored = await storedRounds(puzzle.id, playerKey);
  const before = (await evaluate(puzzle, mode, playerKey, stored)).state;
  if (before.finished) throw new HttpError(409, 'This puzzle is already finished.');
  if (round !== before.current) throw new HttpError(409, 'That round is already over or has not started.');
  const next = Array.from({ length: ROUND_COUNT }, (_, i) => stored[i] ?? { g: null, c: 0 });
  const played = { ...next[round]! };
  if (move.kind === 'clue') {
    if (played.c >= SCREENSHOT_CLUES.length) throw new HttpError(409, 'Every clue is already open.');
    played.c++;
  } else if (move.kind === 'giveUp') played.g = 0;
  else {
    await assertPlayable(move.malId);
    played.g = move.malId;
  }
  next[round] = played;
  const after = await evaluate(puzzle, mode, playerKey, next);
  await writePlay(puzzle.id, playerKey, { guesses: next, solved: after.solvedRounds, score: after.state.score, finished: after.state.finished });
  return after.state;
}
