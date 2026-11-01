import { isCorrect } from '../shared/anidle.js';
import { difficultyOf, type Difficulty, type Pool } from '../shared/catalog.js';
import { ROUND_COUNT, roundMaxPoints, SONG_CLUE_SHARE, SONG_KIND, type SongMode } from '../shared/modes.js';
import { opaqueTag } from './crypto.js';
import { all } from './db.js';
import { answerInfo, assertPlayable, loadAnidle, readPlay, writePlay, type AnswerInfo, type PuzzleRow } from './game.js';
import { HttpError } from './http.js';
import { mediaUrl } from './media.js';

// Opening / Ending: ROUND_COUNT rounds of one title. Each round plays one song (puzzle_round.theme_id)
// of any MAL entry of the show; the whole song plays (streamed from AnimeThemes through /api/media, so
// the file name never reaches the browser); the player gets one guess, and may first open a blurred clue
// (the opening's or ending's own video) for half the points.
// play.guesses holds StoredSong[] per round: g = guessed mal_id (0 = gave up, null = not yet), c = clue opened.

interface StoredSong {
  g: number | null;
  c: boolean;
}

export interface SongInfo {
  /** AnimeThemes slug, e.g. OP1 */
  label: string;
  title: string | null;
  artist: string | null;
  /** The MAL entry the song belongs to, when it is not the show's own entry (e.g. a later season). */
  entryTitle: string | null;
}

export interface SongRoundState {
  /** The full song: its R2 copy when the daily step made one, else a same-origin stream from AnimeThemes. */
  audio: string;
  clue: {
    opened: boolean;
    /**
     * Only once opened: the theme's video, shown blurred and muted while the song plays on: the small
     * clip on R2 when the pipeline made one, else the source video streamed through /api/media.
     */
    url: string | null;
    /** Only once opened: the cover, shown blurred (Ending: beside the video; both: when the video does not load). */
    cover: string | null;
  };
  /** The song's difficulty (from its own entry's members): shown from the start, like the round's label. */
  difficulty: Difficulty;
  guess: { malId: number; title: string } | null;
  gaveUp: boolean;
  solved: boolean;
  finished: boolean;
  points: number;
  /** What a right guess is worth without the clue (roundMaxPoints; half of it with the clue). */
  max: number;
  answer: (AnswerInfo & { song: SongInfo }) | null;
}

export interface SongState {
  id: string;
  mode: SongMode;
  date: string | null;
  pool: Pool;
  rounds: SongRoundState[];
  current: number;
  finished: boolean;
  score: number | null;
  /** The player's own unlimited puzzle: an untouched round whose song does not load may be swapped. */
  canReplace: boolean;
}

export interface SongSource {
  /** The show (the answer). */
  malId: number;
  /** The song played (anime_theme.id). */
  themeId: number;
  audioUrl: string;
  /** The daily step's copy of the full song on R2 (puzzle_round.audio_key), when there is one. */
  audioKey: string | null;
  /** The theme's smallest video on AnimeThemes (none known: derived from the audio URL). */
  videoUrl: string;
  /** The 240p clue clip on R2 (pipeline steps `clips`/`daily`), when there is one. */
  clipKey: string | null;
  song: SongInfo;
  /** From the members of the song's own entry. */
  difficulty: Difficulty;
}

/** The rounds of a song puzzle with the song each plays, in round order. */
export async function songSources(puzzleId: string, mode: SongMode): Promise<SongSource[]> {
  const rows = await all<{
    mal_id: number;
    audio_key: string | null;
    theme_id: number | null;
    audio_url: string | null;
    video_url: string | null;
    clip_key: string | null;
    label: string | null;
    song_title: string | null;
    artist: string | null;
    entry_id: number | null;
    entry_title: string | null;
    entry_members: number | null;
  }>(
    `SELECT r.mal_id, r.audio_key, t.id AS theme_id, t.audio_url, t.video_url, t.clip_key, t.label, t.song_title, t.artist,
            e.mal_id AS entry_id, e.title AS entry_title, e.members AS entry_members
     FROM puzzle_round r LEFT JOIN anime_theme t ON t.id = r.theme_id AND t.kind = ? LEFT JOIN anime e ON e.mal_id = t.mal_id
     WHERE r.puzzle_id = ? ORDER BY r.round`,
    [SONG_KIND[mode], puzzleId],
  );
  if (rows.length !== ROUND_COUNT || rows.some((r) => r.theme_id == null || r.entry_id == null)) throw new HttpError(500, 'Puzzle data is incomplete.');
  return rows.map((r) => ({
    malId: Number(r.mal_id),
    themeId: Number(r.theme_id),
    audioUrl: r.audio_url!,
    audioKey: r.audio_key,
    // AnimeThemes extracts each audio file from a video of the same name: a.…/X.ogg ↔ v.…/X.webm.
    videoUrl: r.video_url || r.audio_url!.replace('://a.animethemes.moe/', '://v.animethemes.moe/').replace(/\.ogg$/, '.webm'),
    clipKey: r.clip_key || null,
    song: { label: r.label!, title: r.song_title, artist: r.artist, entryTitle: Number(r.entry_id) === Number(r.mal_id) ? null : r.entry_title },
    difficulty: difficultyOf(r.entry_members == null ? null : Number(r.entry_members)),
  }));
}

/** The `v` of a round's /api/media URL: changes when a round is replaced, so a cached copy of the old song is never played for the new one. */
export const mediaTag = (puzzleId: string, round: number, source: SongSource) => opaqueTag(`${puzzleId}:${round}:${source.malId}:${source.themeId}`);

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
  const media = (round: number, kind: 'audio' | 'video') =>
    `/api/media?puzzle=${encodeURIComponent(puzzle.id)}&round=${round}&kind=${kind}&v=${mediaTag(puzzle.id, round, sources[round]!)}`;
  const rounds = sources.map((s, i): SongRoundState => {
    const answer = anime.get(s.malId);
    if (!answer) throw new HttpError(500, 'An answer is missing from the database.');
    const played = stored[i] ?? { g: null, c: false };
    const guessed = played.g ? anime.get(played.g) : undefined;
    const solved = guessed !== undefined && isCorrect(answer, guessed);
    const finished = played.g !== null;
    const info = { ...answerInfo(answer), difficulty: s.difficulty };
    return {
      audio: s.audioKey ? mediaUrl(s.audioKey) : media(i, 'audio'),
      difficulty: s.difficulty,
      clue: {
        opened: played.c,
        url: played.c || finished ? (s.clipKey ? mediaUrl(s.clipKey) : media(i, 'video')) : null,
        cover: played.c || finished ? answer.cover : null,
      },
      guess: played.g ? { malId: played.g, title: guessed?.title ?? `#${played.g}` } : null,
      gaveUp: played.g === 0,
      solved,
      finished,
      points: solved ? roundMaxPoints(mode) * (played.c ? SONG_CLUE_SHARE : 1) : 0,
      max: roundMaxPoints(mode),
      answer: finished ? { ...info, song: s.song } : null,
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
