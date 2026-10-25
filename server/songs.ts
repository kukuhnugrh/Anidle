import { isCorrect } from '../shared/anidle.js';
import type { Pool } from '../shared/catalog.js';
import { MODE_MEDIA, ROUND_COUNT, SONG_CLUE, SONG_POINTS, type SongMode } from '../shared/modes.js';
import { all } from './db.js';
import { answerInfo, assertPlayable, loadAnidle, readPlay, writePlay, type AnswerInfo, type PuzzleRow } from './game.js';
import { HttpError } from './http.js';

// Opening / Ending: ROUND_COUNT rounds of one title. The whole song plays (streamed from AnimeThemes
// through /api/media, so the file name never reaches the browser); the player gets one guess, and may
// first open a blurred clue (the opening's video, or the cover for endings) for half the points.
// play.guesses holds StoredSong[] per round: g = guessed mal_id (0 = gave up, null = not yet), c = clue opened.

interface StoredSong {
  g: number | null;
  c: boolean;
}

export interface SongInfo {
  /** AnimeThemes slug, e.g. OP1 */
  label: string | null;
  title: string | null;
  artist: string | null;
}

export interface SongRoundState {
  /** Same-origin stream of the full song. */
  audio: string;
  clue: {
    kind: 'video' | 'cover';
    opened: boolean;
    /** Only once opened: the blurred video stream, or the cover image. */
    url: string | null;
    /** Opening clue: the cover to show (blurred) if the video does not load. */
    fallback: string | null;
  };
  guess: { malId: number; title: string } | null;
  gaveUp: boolean;
  solved: boolean;
  finished: boolean;
  points: number;
  answer: (AnswerInfo & { song: SongInfo }) | null;
}

export interface SongState {
  id: string;
  mode: SongMode;
  date: string | null;
  pool: Pool;
  points: typeof SONG_POINTS;
  rounds: SongRoundState[];
  current: number;
  finished: boolean;
  score: number | null;
  /** The player's own unlimited puzzle: an untouched round whose song does not load may be swapped. */
  canReplace: boolean;
}

export interface SongSource {
  malId: number;
  audioUrl: string;
  song: SongInfo;
}

/** AnimeThemes extracts each audio file from a video of the same name: a.…/X.ogg ↔ v.…/X.webm. */
export const videoOf = (audioUrl: string) => audioUrl.replace('://a.animethemes.moe/', '://v.animethemes.moe/').replace(/\.ogg$/, '.webm');

/** The round titles of a song puzzle with their AnimeThemes source, in round order. */
export async function songSources(puzzleId: string, mode: SongMode): Promise<SongSource[]> {
  const rows = await all<{ mal_id: number; source_url: string | null; label: string | null; song_title: string | null; artist: string | null }>(
    `SELECT r.mal_id, m.source_url, m.label, m.song_title, m.artist
     FROM puzzle_round r LEFT JOIN anime_media m ON m.mal_id = r.mal_id AND m.kind = ?
     WHERE r.puzzle_id = ? ORDER BY r.round`,
    [MODE_MEDIA[mode]!, puzzleId],
  );
  if (rows.length !== ROUND_COUNT || rows.some((r) => !r.source_url)) throw new HttpError(500, 'Puzzle data is incomplete.');
  return rows.map((r) => ({ malId: Number(r.mal_id), audioUrl: r.source_url!, song: { label: r.label, title: r.song_title, artist: r.artist } }));
}

export const storedSongs = async (puzzleId: string, playerKey: string): Promise<StoredSong[]> => {
  const play = await readPlay(puzzleId, playerKey);
  return play ? (JSON.parse(play.guesses) as StoredSong[]) : [];
};

interface Evaluated {
  state: SongState;
  solvedRounds: number;
}

async function evaluate(puzzle: PuzzleRow, mode: SongMode, playerKey: string, stored: StoredSong[]): Promise<Evaluated> {
  const sources = await songSources(puzzle.id, mode);
  const anime = await loadAnidle([...sources.map((s) => s.malId), ...stored.flatMap((s) => (s.g ? [s.g] : []))]);
  const media = (round: number, kind: 'audio' | 'video') => `/api/media?puzzle=${encodeURIComponent(puzzle.id)}&round=${round}&kind=${kind}`;
  const rounds = sources.map((s, i): SongRoundState => {
    const answer = anime.get(s.malId);
    if (!answer) throw new HttpError(500, 'An answer is missing from the database.');
    const played = stored[i] ?? { g: null, c: false };
    const guessed = played.g ? anime.get(played.g) : undefined;
    const solved = guessed !== undefined && isCorrect(answer, guessed);
    const finished = played.g !== null;
    const clueKind = SONG_CLUE[mode];
    return {
      audio: media(i, 'audio'),
      clue: {
        kind: clueKind,
        opened: played.c,
        url: played.c || finished ? (clueKind === 'video' ? media(i, 'video') : answer.cover) : null,
        fallback: played.c || finished ? answer.cover : null,
      },
      guess: played.g ? { malId: played.g, title: guessed?.title ?? `#${played.g}` } : null,
      gaveUp: played.g === 0,
      solved,
      finished,
      points: solved ? (played.c ? SONG_POINTS.withClue : SONG_POINTS.plain) : 0,
      answer: finished ? { ...answerInfo(answer), song: s.song } : null,
    };
  });
  const current = rounds.findIndex((r) => !r.finished);
  const finished = current < 0;
  return {
    state: {
      id: puzzle.id,
      mode,
      date: puzzle.date,
      pool: puzzle.pool,
      points: SONG_POINTS,
      rounds,
      current: finished ? rounds.length : current,
      finished,
      score: finished ? rounds.reduce((sum, r) => sum + r.points, 0) : null,
      canReplace: puzzle.date == null && puzzle.created_by === playerKey,
    },
    solvedRounds: rounds.filter((r) => r.solved).length,
  };
}

export async function songState(puzzle: PuzzleRow, mode: SongMode, playerKey: string): Promise<SongState> {
  return (await evaluate(puzzle, mode, playerKey, await storedSongs(puzzle.id, playerKey))).state;
}

export type SongMove = { kind: 'guess'; malId: number } | { kind: 'clue' } | { kind: 'giveUp' };

/** One move in the current round: open the clue, guess (once), or give up. */
export async function songMove(puzzle: PuzzleRow, mode: SongMode, playerKey: string, round: number, move: SongMove): Promise<SongState> {
  const stored = await storedSongs(puzzle.id, playerKey);
  const before = (await evaluate(puzzle, mode, playerKey, stored)).state;
  if (before.finished) throw new HttpError(409, 'This puzzle is already finished.');
  if (round !== before.current) throw new HttpError(409, 'That round is already over or has not started.');
  const next = Array.from({ length: ROUND_COUNT }, (_, i) => stored[i] ?? { g: null, c: false });
  const played = { ...next[round]! };
  if (move.kind === 'clue') played.c = true;
  else if (move.kind === 'giveUp') played.g = 0;
  else {
    await assertPlayable(move.malId);
    played.g = move.malId;
  }
  next[round] = played;
  const after = await evaluate(puzzle, mode, playerKey, next);
  await writePlay(puzzle.id, playerKey, { guesses: next, solved: after.solvedRounds, score: after.state.score, finished: after.state.finished });
  return after.state;
}
