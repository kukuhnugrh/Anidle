import { DAILY_MAX_POINTS, PERFECT_SOLVED, todayUtc, type Mode } from '../shared/modes.js';
import { all } from './db.js';

/** Anidle guesses (play.guesses is number[] there). The round modes report rounds solved instead, so this is unused for them. */
function attemptCount(guesses: string): number {
  return (JSON.parse(guesses) as unknown[]).length;
}

/**
 * SQL (play `g`, puzzle `p`): a daily play finished on its own day (UTC; finished_at is an ISO UTC time).
 * Replaying an earlier day from the archive is just for fun: it stays out of leaderboards, streaks and stats.
 */
const ON_THE_DAY = 'substr(g.finished_at, 1, 10) = p.date';

export interface TodayScore {
  score: number;
  max: number;
  /** Points per mode for today's finished daily puzzles; a mode not finished yet is absent. */
  modes: Partial<Record<Mode, number>>;
}

/** The player's points over today's daily puzzles (out of DAILY_MAX_POINTS), in total and per mode. */
export async function todayScore(playerKey: string): Promise<TodayScore> {
  const rows = await all<{ mode: Mode; score: number | null }>(
    'SELECT p.mode, g.score FROM play g JOIN puzzle p ON p.id = g.puzzle_id WHERE g.username = ? AND p.date = ? AND g.finished_at IS NOT NULL',
    [playerKey, todayUtc()],
  );
  const modes = Object.fromEntries(rows.map((r) => [r.mode, Number(r.score ?? 0)]));
  return { score: rows.reduce((sum, r) => sum + Number(r.score ?? 0), 0), max: DAILY_MAX_POINTS, modes };
}

export interface LeaderboardEntry {
  username: string;
  avatar: string | null;
  score: number;
  /** Anidle: 1 if solved. Round modes: rounds solved. */
  solved: number;
  attempts: number;
  finishedAt: string;
}

export interface Leaderboard {
  date: string;
  modes: Record<Mode, LeaderboardEntry[]>;
  /** Sum over the modes each player finished that day. */
  total: Array<{ username: string; avatar: string | null; score: number; modes: number }>;
}

/** Daily puzzles of `date` finished that same day by accounts (anonymous players have no name to show). */
export async function leaderboard(date: string): Promise<Leaderboard> {
  const rows = await all<{ mode: Mode; username: string; avatar: string | null; score: number | null; solved: number; guesses: string; finished_at: string }>(
    `SELECT p.mode, ac.username, pr.avatar, g.score, g.solved, g.guesses, g.finished_at
     FROM puzzle p
     JOIN play g ON g.puzzle_id = p.id AND g.finished_at IS NOT NULL
     JOIN account ac ON g.username = 'u:' || ac.id
     LEFT JOIN player pr ON pr.username = ac.mal_username
     WHERE p.date = ? AND ${ON_THE_DAY}
     ORDER BY g.score DESC, g.finished_at ASC`,
    [date],
  );
  const modes: Record<Mode, LeaderboardEntry[]> = { anidle: [], opening: [], ending: [], character: [], screenshot: [] };
  const totals = new Map<string, { username: string; avatar: string | null; score: number; modes: number }>();
  for (const r of rows) {
    const entry: LeaderboardEntry = {
      username: r.username,
      avatar: r.avatar,
      score: Number(r.score ?? 0),
      solved: Number(r.solved),
      attempts: attemptCount(r.guesses),
      finishedAt: r.finished_at,
    };
    modes[r.mode].push(entry);
    const t = totals.get(r.username) ?? { username: r.username, avatar: r.avatar, score: 0, modes: 0 };
    t.score += entry.score;
    t.modes++;
    totals.set(r.username, t);
  }
  return { date, modes, total: [...totals.values()].sort((a, b) => b.score - a.score || b.modes - a.modes) };
}

export interface HistoryEntry {
  puzzleId: string;
  /** null = unlimited */
  date: string | null;
  mode: Mode;
  score: number;
  solved: number;
  attempts: number;
  answers: string[];
  finishedAt: string;
}

export interface ModeStats {
  /** Daily puzzles finished on their own day (archive replays do not count). */
  played: number;
  /** Anidle solved, or round-mode puzzles with every round solved. */
  perfect: number;
  averageScore: number;
  bestScore: number;
  /** Consecutive daily puzzles finished, ending today (or yesterday if today is not played yet). */
  streak: number;
  bestStreak: number;
}

export interface History {
  stats: Record<Mode, ModeStats>;
  recent: HistoryEntry[];
}

const HISTORY_LIMIT = 60;
const DAY_MS = 86_400_000;

function streaks(dates: string[]): { streak: number; bestStreak: number } {
  const days = [...new Set(dates)].map((d) => Date.parse(`${d}T00:00:00Z`) / DAY_MS).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] === days[i - 1]! + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  const today = Date.parse(`${todayUtc()}T00:00:00Z`) / DAY_MS;
  const last = days.at(-1);
  // The run ending at the last played day only counts if that day is today or yesterday.
  return { streak: last !== undefined && today - last <= 1 ? run : 0, bestStreak: best };
}

export async function history(playerKey: string): Promise<History> {
  const rows = await all<{ id: string; date: string | null; mode: Mode; answer_id: number; score: number | null; solved: number; guesses: string; finished_at: string; on_the_day: number }>(
    `SELECT p.id, p.date, p.mode, p.answer_id, g.score, g.solved, g.guesses, g.finished_at, (p.date IS NOT NULL AND ${ON_THE_DAY}) AS on_the_day
     FROM play g JOIN puzzle p ON p.id = g.puzzle_id
     WHERE g.username = ? AND g.finished_at IS NOT NULL
     ORDER BY g.finished_at DESC`,
    [playerKey],
  );
  const recentRows = rows.slice(0, HISTORY_LIMIT);
  const ids = recentRows.map((r) => r.id);
  const marks = ids.map(() => '?').join(',');
  const rounds = ids.length
    ? await all<{ puzzle_id: string; mal_id: number }>(
        `SELECT puzzle_id, mal_id, round, 0 AS slot FROM puzzle_round WHERE puzzle_id IN (${marks})
         UNION ALL SELECT puzzle_id, mal_id, round, slot FROM puzzle_character WHERE puzzle_id IN (${marks})
         ORDER BY round, slot`,
        [...ids, ...ids],
      )
    : [];
  const roundsOf = Map.groupBy(rounds, (r) => r.puzzle_id);
  const answerIds = [...new Set([...recentRows.map((r) => Number(r.answer_id)), ...rounds.map((r) => Number(r.mal_id))])];
  const titles = new Map(
    answerIds.length
      ? (await all<{ mal_id: number; title: string }>(`SELECT mal_id, title FROM anime WHERE mal_id IN (${answerIds.map(() => '?').join(',')})`, answerIds)).map((t) => [Number(t.mal_id), t.title])
      : [],
  );

  const modeStats = (mode: Mode): ModeStats => {
    const daily = rows.filter((r) => r.mode === mode && Number(r.on_the_day));
    const scores = daily.map((r) => Number(r.score ?? 0));
    return {
      played: daily.length,
      perfect: daily.filter((r) => Number(r.solved) === PERFECT_SOLVED[mode]).length,
      averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      bestScore: scores.length ? Math.max(...scores) : 0,
      ...streaks(daily.map((r) => r.date!)),
    };
  };
  const stats: Record<Mode, ModeStats> = {
    anidle: modeStats('anidle'),
    opening: modeStats('opening'),
    ending: modeStats('ending'),
    character: modeStats('character'),
    screenshot: modeStats('screenshot'),
  };

  return {
    stats,
    recent: recentRows.map((r) => ({
      puzzleId: r.id,
      date: r.date,
      mode: r.mode,
      score: Number(r.score ?? 0),
      solved: Number(r.solved),
      attempts: attemptCount(r.guesses),
      answers: (roundsOf.get(r.id)?.map((x) => Number(x.mal_id)) ?? [Number(r.answer_id)]).map((id) => titles.get(id) ?? `#${id}`),
      finishedAt: r.finished_at,
    })),
  };
}
