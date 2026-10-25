import { isCorrect } from '../shared/anidle.js';
import type { Pool } from '../shared/catalog.js';
import { ROUND_COUNT, ROUND_MODES, roundPoints, type RoundMode } from '../shared/modes.js';
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

// Round modes (Opening, Ending, Karakter, Screenshot): ROUND_COUNT rounds, each attempt unlocks the next
// stage of ROUND_MODES[mode].stages. Stored per player in play.guesses as number[][] (one list per round, 0 = skip).

export interface SongInfo {
  /** AnimeThemes slug, e.g. OP1 */
  label: string | null;
  title: string | null;
  artist: string | null;
}

export interface CharacterInfo {
  name: string;
  role: string | null;
}

export interface RoundAnswer extends AnswerInfo {
  /** Opening / Ending */
  song: SongInfo | null;
  /** Karakter, in reveal order */
  characters: CharacterInfo[];
}

export interface RoundPlayState {
  /** Opening/Ending: [the 30 s clip]. Karakter: portraits in reveal order. Screenshot: [one frame]. */
  media: string[];
  /** Wrong guesses, skips (null) and, when solved, the correct guess last. */
  attempts: Array<{ malId: number; title: string } | null>;
  solved: boolean;
  finished: boolean;
  points: number;
  /** Only once the round is over. */
  answer: RoundAnswer | null;
}

export interface RoundState {
  id: string;
  mode: RoundMode;
  date: string | null;
  pool: Pool;
  /** What each attempt unlocks: seconds of the clip, or number of portraits. */
  stages: readonly number[];
  rounds: RoundPlayState[];
  /** First unfinished round, rounds.length once the puzzle is over. */
  current: number;
  finished: boolean;
  score: number | null;
  /** The player's own unlimited puzzle: a round whose media does not load may be swapped. */
  canReplace: boolean;
}

interface LoadedRound {
  malId: number;
  media: string[];
  song: SongInfo | null;
  characters: CharacterInfo[];
}

async function loadRounds(puzzleId: string, mode: RoundMode): Promise<LoadedRound[]> {
  const rounds = await all<{ mal_id: number }>('SELECT mal_id FROM puzzle_round WHERE puzzle_id = ? ORDER BY round', [puzzleId]);
  const ids = rounds.map((r) => Number(r.mal_id));
  const marks = ids.map(() => '?').join(',');
  let loaded: LoadedRound[];
  if (mode === 'character') {
    const rows = await all<{ mal_id: number; name: string; role: string | null; r2_key: string }>(
      `SELECT mal_id, name, role, r2_key FROM anime_character WHERE mal_id IN (${marks}) ORDER BY slot`,
      ids,
    );
    const byTitle = Map.groupBy(rows, (r) => Number(r.mal_id));
    loaded = ids.map((malId) => {
      const chars = byTitle.get(malId) ?? [];
      return { malId, media: chars.map((c) => mediaUrl(c.r2_key)), song: null, characters: chars.map((c) => ({ name: c.name, role: c.role })) };
    });
  } else if (mode === 'screenshot') {
    const rows = await all<{ mal_id: number; r2_key: string }>(`SELECT mal_id, r2_key FROM anime_screenshot WHERE mal_id IN (${marks}) ORDER BY slot`, ids);
    const byTitle = Map.groupBy(rows, (r) => Number(r.mal_id));
    loaded = ids.map((malId) => ({ malId, media: (byTitle.get(malId) ?? []).map((s) => mediaUrl(s.r2_key)), song: null, characters: [] }));
  } else {
    const rows = await all<{ mal_id: number; r2_key: string | null; label: string | null; song_title: string | null; artist: string | null }>(
      `SELECT mal_id, r2_key, label, song_title, artist FROM anime_media WHERE kind = ? AND mal_id IN (${marks})`,
      [ROUND_MODES[mode].media, ...ids],
    );
    const byTitle = new Map(rows.map((r) => [Number(r.mal_id), r]));
    loaded = ids.map((malId) => {
      const r = byTitle.get(malId);
      return { malId, media: r?.r2_key ? [mediaUrl(r.r2_key)] : [], song: r ? { label: r.label, title: r.song_title, artist: r.artist } : null, characters: [] };
    });
  }
  if (loaded.length !== ROUND_COUNT || loaded.some((r) => !r.media.length)) throw new HttpError(500, 'Data ronde puzzle tidak lengkap.');
  return loaded;
}

interface Evaluated {
  state: RoundState;
  solvedRounds: number;
}

async function evaluate(puzzle: PuzzleRow, mode: RoundMode, playerKey: string, attempts: number[][]): Promise<Evaluated> {
  const { stages } = ROUND_MODES[mode];
  const rounds = await loadRounds(puzzle.id, mode);
  const anime = await loadAnidle([...rounds.map((r) => r.malId), ...attempts.flat().filter((id) => id > 0)]);
  const states = rounds.map((r, i): RoundPlayState => {
    const answer = anime.get(r.malId);
    if (!answer) throw new HttpError(500, 'Data jawaban hilang dari database.');
    const tries = attempts[i] ?? [];
    const solvedAt = tries.findIndex((id) => {
      const guess = anime.get(id);
      return guess !== undefined && isCorrect(answer, guess);
    });
    const solved = solvedAt >= 0;
    const finished = solved || tries.length >= stages.length;
    return {
      media: r.media,
      attempts: tries.map((id) => (id > 0 ? { malId: id, title: anime.get(id)?.title ?? `#${id}` } : null)),
      solved,
      finished,
      points: roundPoints(solved ? solvedAt : null, stages.length),
      answer: finished ? { ...answerInfo(answer), song: r.song, characters: r.characters } : null,
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
      stages,
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

export async function roundState(puzzle: PuzzleRow, mode: RoundMode, playerKey: string): Promise<RoundState> {
  return (await evaluate(puzzle, mode, playerKey, await storedAttempts(puzzle.id, playerKey))).state;
}

/** A guess (`malId`) or a skip (`null`) in `round`, which must be the current one. */
export async function roundGuess(puzzle: PuzzleRow, mode: RoundMode, playerKey: string, round: number, malId: number | null): Promise<RoundState> {
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
export async function replaceRound(puzzle: PuzzleRow, mode: RoundMode, playerKey: string, account: Account | null, round: number): Promise<RoundState> {
  if (puzzle.date != null || puzzle.created_by !== playerKey) throw new HttpError(403, 'Hanya ronde puzzle unlimited milikmu yang bisa diganti.');
  if (!Number.isInteger(round) || round < 0 || round >= ROUND_COUNT) throw new HttpError(400, 'Ronde tidak dikenal.');
  const attempts = await storedAttempts(puzzle.id, playerKey);
  if (attempts[round]?.length) throw new HttpError(409, 'Ronde yang sudah ditebak tidak bisa diganti.');

  const options: PuzzleOptions = puzzle.options ? (JSON.parse(puzzle.options) as PuzzleOptions) : {};
  const current = await all<{ mal_id: number }>('SELECT mal_id FROM puzzle_round WHERE puzzle_id = ?', [puzzle.id]);
  const taken = new Set(current.map((r) => Number(r.mal_id)));
  const franchises = [...(await loadAnidle([...taken])).values()].map((a) => a.franchiseId ?? -a.malId);
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
