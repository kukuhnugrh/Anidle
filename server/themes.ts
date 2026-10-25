import { isCorrect } from '../shared/anidle.js';
import type { Pool } from '../shared/catalog.js';
import { CLIP_STAGES, roundPoints, THEME_MEDIA, THEME_ROUNDS, type ThemeMode } from '../shared/modes.js';
import type { Account } from './accounts.js';
import { all, db } from './db.js';
import {
  answerInfo,
  assertPlayable,
  loadAnidle,
  pickTitles,
  poolSpec,
  poolTitles,
  randomDraw,
  readPlay,
  writePlay,
  type AnswerInfo,
  type PuzzleOptions,
  type PuzzleRow,
} from './game.js';
import { HttpError } from './http.js';
import { mediaUrl } from './media.js';

// Opening / Ending: THEME_ROUNDS rounds, each a 30 s clip unlocked in CLIP_STAGES steps. Stored per
// player in play.guesses as number[][] (one list per round, 0 = skip).

export interface SongInfo {
  /** AnimeThemes slug, e.g. OP1 */
  label: string | null;
  title: string | null;
  artist: string | null;
}

export interface ThemeRoundState {
  /** The 30 s clip; the player only hears the unlocked stage until the round is over. */
  audio: string;
  /** Wrong guesses, skips (null) and, when solved, the correct guess last. */
  attempts: Array<{ malId: number; title: string } | null>;
  solved: boolean;
  finished: boolean;
  points: number;
  /** Only once the round is over. */
  answer: (AnswerInfo & { song: SongInfo }) | null;
}

export interface ThemeState {
  id: string;
  mode: ThemeMode;
  date: string | null;
  pool: Pool;
  clipStages: readonly number[];
  rounds: ThemeRoundState[];
  /** First unfinished round, rounds.length once the puzzle is over. */
  current: number;
  finished: boolean;
  score: number | null;
  /** The player's own unlimited puzzle: a round whose audio does not load may be swapped. */
  canReplace: boolean;
}

interface RoundRow {
  round: number;
  mal_id: number;
  r2_key: string | null;
  label: string | null;
  song_title: string | null;
  artist: string | null;
}

async function loadRounds(puzzleId: string, mode: ThemeMode): Promise<RoundRow[]> {
  const rows = await all<RoundRow>(
    `SELECT r.round, r.mal_id, m.r2_key, m.label, m.song_title, m.artist
     FROM puzzle_round r LEFT JOIN anime_media m ON m.mal_id = r.mal_id AND m.kind = ?
     WHERE r.puzzle_id = ? ORDER BY r.round`,
    [THEME_MEDIA[mode], puzzleId],
  );
  if (rows.length !== THEME_ROUNDS || rows.some((r) => !r.r2_key)) throw new HttpError(500, 'Data ronde puzzle tidak lengkap.');
  return rows;
}

interface Evaluated {
  state: ThemeState;
  solvedRounds: number;
}

async function evaluate(puzzle: PuzzleRow, mode: ThemeMode, playerKey: string, attempts: number[][]): Promise<Evaluated> {
  const rounds = await loadRounds(puzzle.id, mode);
  const anime = await loadAnidle([...rounds.map((r) => Number(r.mal_id)), ...attempts.flat().filter((id) => id > 0)]);
  const states = rounds.map((r, i): ThemeRoundState => {
    const answer = anime.get(Number(r.mal_id));
    if (!answer) throw new HttpError(500, 'Data jawaban hilang dari database.');
    const tries = attempts[i] ?? [];
    const solvedAt = tries.findIndex((id) => {
      const guess = anime.get(id);
      return guess !== undefined && isCorrect(answer, guess);
    });
    const solved = solvedAt >= 0;
    const finished = solved || tries.length >= CLIP_STAGES.length;
    return {
      audio: mediaUrl(r.r2_key!),
      attempts: tries.map((id) => (id > 0 ? { malId: id, title: anime.get(id)?.title ?? `#${id}` } : null)),
      solved,
      finished,
      points: roundPoints(solved ? solvedAt : null),
      answer: finished ? { ...answerInfo(answer), song: { label: r.label, title: r.song_title, artist: r.artist } } : null,
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
      clipStages: CLIP_STAGES,
      rounds: states,
      current: finished ? states.length : current,
      finished,
      score: finished ? states.reduce((sum, s) => sum + s.points, 0) : null,
      canReplace: puzzle.date == null && puzzle.created_by === playerKey,
    },
    solvedRounds: states.filter((s) => s.solved).length,
  };
}

const storedAttempts = async (puzzleId: string, playerKey: string): Promise<number[][]> => {
  const play = await readPlay(puzzleId, playerKey);
  return play ? (JSON.parse(play.guesses) as number[][]) : [];
};

export async function themeState(puzzle: PuzzleRow, mode: ThemeMode, playerKey: string): Promise<ThemeState> {
  return (await evaluate(puzzle, mode, playerKey, await storedAttempts(puzzle.id, playerKey))).state;
}

/** A guess (`malId`) or a skip (`null`) in `round`, which must be the current one. */
export async function themeGuess(puzzle: PuzzleRow, mode: ThemeMode, playerKey: string, round: number, malId: number | null): Promise<ThemeState> {
  const attempts = await storedAttempts(puzzle.id, playerKey);
  const before = (await evaluate(puzzle, mode, playerKey, attempts)).state;
  if (before.finished) throw new HttpError(409, 'Puzzle ini sudah selesai.');
  if (round !== before.current) throw new HttpError(409, 'Ronde itu sudah selesai atau belum dimulai.');
  const tries = attempts[round] ?? [];
  if (malId != null) {
    if (tries.includes(malId)) throw new HttpError(409, 'Judul itu sudah kamu tebak di ronde ini.');
    await assertPlayable(malId);
  }
  attempts[round] = [...tries, malId ?? 0];
  const after = await evaluate(puzzle, mode, playerKey, attempts);
  await writePlay(puzzle.id, playerKey, { guesses: attempts, solved: after.solvedRounds, score: after.state.score, finished: after.state.finished });
  return after.state;
}

/** Swaps an untouched round of the player's own unlimited puzzle for another title from the same pool. */
export async function replaceRound(puzzle: PuzzleRow, mode: ThemeMode, playerKey: string, account: Account | null, round: number): Promise<ThemeState> {
  if (puzzle.date != null || puzzle.created_by !== playerKey) throw new HttpError(403, 'Hanya ronde puzzle unlimited milikmu yang bisa diganti.');
  const attempts = await storedAttempts(puzzle.id, playerKey);
  if (!Number.isInteger(round) || round < 0 || round >= THEME_ROUNDS) throw new HttpError(400, 'Ronde tidak dikenal.');
  if (attempts[round]?.length) throw new HttpError(409, 'Ronde yang sudah ditebak tidak bisa diganti.');

  const options: PuzzleOptions = puzzle.options ? (JSON.parse(puzzle.options) as PuzzleOptions) : {};
  const rounds = await loadRounds(puzzle.id, mode);
  const current = await loadAnidle(rounds.map((r) => Number(r.mal_id)));
  const taken = new Set(rounds.map((r) => Number(r.mal_id)));
  const franchises = [...current.values()].map((a) => a.franchiseId ?? -a.malId);
  const titles = (await poolTitles(poolSpec(puzzle.pool, account, mode, options))).filter((t) => !taken.has(t.malId));
  const [replacement] = pickTitles(titles, 1, randomDraw, franchises);
  await db().batch(
    [
      { sql: 'UPDATE puzzle_round SET mal_id = ? WHERE puzzle_id = ? AND round = ?', args: [replacement!, puzzle.id, round] },
      ...(round === 0 ? [{ sql: 'UPDATE puzzle SET answer_id = ? WHERE id = ?', args: [replacement!, puzzle.id] }] : []),
    ],
    'write',
  );
  return (await evaluate(puzzle, mode, playerKey, attempts)).state;
}
