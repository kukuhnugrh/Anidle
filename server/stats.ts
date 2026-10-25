import { ROUND_COUNT, todayWib, type Mode } from '../shared/modes.js';
import { all } from './db.js';

/** play.guesses holds number[] (Anidle) or number[][] (round modes); attempts = guesses + skips. */
function attemptCount(guesses: string): number {
  const parsed = JSON.parse(guesses) as Array<number | number[]>;
  return parsed.reduce<number>((n, g) => n + (Array.isArray(g) ? g.length : 1), 0);
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

/** Finished daily puzzles of `date` by accounts (anonymous players have no name to show). */
export async function leaderboard(date: string): Promise<Leaderboard> {
  const rows = await all<{ mode: Mode; username: string; avatar: string | null; score: number | null; solved: number; guesses: string; finished_at: string }>(
    `SELECT p.mode, ac.username, pr.avatar, g.score, g.solved, g.guesses, g.finished_at
     FROM puzzle p
     JOIN play g ON g.puzzle_id = p.id AND g.finished_at IS NOT NULL
     JOIN account ac ON g.username = 'u:' || ac.id
     LEFT JOIN player pr ON pr.username = ac.mal_username
     WHERE p.date = ?
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
  /** Daily puzzles finished. */
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
  const today = Date.parse(`${todayWib()}T00:00:00Z`) / DAY_MS;
  const last = days.at(-1);
  // The run ending at the last played day only counts if that day is today or yesterday.
  return { streak: last !== undefined && today - last <= 1 ? run : 0, bestStreak: best };
}

export async function history(playerKey: string): Promise<History> {
  const rows = await all<{ id: string; date: string | null; mode: Mode; answer_id: number; score: number | null; solved: number; guesses: string; finished_at: string }>(
    `SELECT p.id, p.date, p.mode, p.answer_id, g.score, g.solved, g.guesses, g.finished_at
     FROM play g JOIN puzzle p ON p.id = g.puzzle_id
     WHERE g.username = ? AND g.finished_at IS NOT NULL
     ORDER BY g.finished_at DESC`,
    [playerKey],
  );
  const recentRows = rows.slice(0, HISTORY_LIMIT);
  const ids = recentRows.map((r) => r.id);
  const rounds = ids.length
    ? await all<{ puzzle_id: string; mal_id: number }>(`SELECT puzzle_id, mal_id FROM puzzle_round WHERE puzzle_id IN (${ids.map(() => '?').join(',')}) ORDER BY round`, ids)
    : [];
  const roundsOf = Map.groupBy(rounds, (r) => r.puzzle_id);
  const answerIds = [...new Set([...recentRows.map((r) => Number(r.answer_id)), ...rounds.map((r) => Number(r.mal_id))])];
  const titles = new Map(
    answerIds.length
      ? (await all<{ mal_id: number; title: string }>(`SELECT mal_id, title FROM anime WHERE mal_id IN (${answerIds.map(() => '?').join(',')})`, answerIds)).map((t) => [Number(t.mal_id), t.title])
      : [],
  );

  const modeStats = (mode: Mode): ModeStats => {
    const daily = rows.filter((r) => r.mode === mode && r.date);
    const scores = daily.map((r) => Number(r.score ?? 0));
    return {
      played: daily.length,
      perfect: daily.filter((r) => Number(r.solved) === (mode === 'anidle' ? 1 : ROUND_COUNT)).length,
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
