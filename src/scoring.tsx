import type { ReactNode } from 'react';
import { ANIDLE_MAX_GUESSES } from '../shared/catalog';
import { CHARACTER_FIELDS_PER_ROUND } from '../shared/characters';
import { CONNECTIONS_MAX_MISTAKES, CONNECTIONS_MISTAKE_COST } from '../shared/connections';
import {
  CHARACTERS_PER_ROUND,
  DAILY_MAX_POINTS,
  DAILY_MODES,
  MODE_LABELS,
  MODE_MAX_POINTS,
  ROUND_COUNT,
  roundMaxPoints,
  SCREENSHOT_CLUE_COST,
  SCREENSHOT_CLUES,
  SONG_CLUE_SHARE,
  type DailyMode,
  type Mode,
} from '../shared/modes';
import { fmtNumber } from './format';

// How each mode scores, in words, from the same constants the server scores with.

const pts = (n: number) => `${fmtNumber(n)} pts`;
const anidleStep = MODE_MAX_POINTS.anidle / ANIDLE_MAX_GUESSES;
const anidleAt = (tries: number) => MODE_MAX_POINTS.anidle - anidleStep * (tries - 1);
const shotRound = roundMaxPoints('screenshot');
const shotCost = shotRound * SCREENSHOT_CLUE_COST;

const songRules = (mode: 'opening' | 'ending'): ReactNode[] => [
  <>
    {ROUND_COUNT} rounds × {pts(roundMaxPoints(mode))}.
  </>,
  <>
    Right without the clue: {pts(roundMaxPoints(mode))}. Right after opening the clue: {pts(roundMaxPoints(mode) * SONG_CLUE_SHARE)}.
  </>,
  <>Wrong or gave up: 0.</>,
];

/** The scoring of each mode as short points (the "?" dialog lists them all). */
export const SCORING_RULES: Record<Mode, ReactNode[]> = {
  anidle: [
    <>Solved on the first try: {pts(MODE_MAX_POINTS.anidle)}.</>,
    <>
      Every extra try takes {pts(anidleStep)} off (skipped tries count): {pts(anidleAt(2))} on the 2nd, {pts(anidleAt(10))} on the 10th, {pts(anidleAt(ANIDLE_MAX_GUESSES))} on the{' '}
      {ANIDLE_MAX_GUESSES}th.
    </>,
    <>Not solved: 0.</>,
  ],
  opening: songRules('opening'),
  ending: songRules('ending'),
  screenshot: [
    <>
      {ROUND_COUNT} rounds × {pts(shotRound)}.
    </>,
    <>
      Right with no clue: {pts(shotRound)}. Every clue you open takes {pts(shotCost)} off:{' '}
      {SCREENSHOT_CLUES.map((_, i) => fmtNumber(shotRound - shotCost * (i + 1))).join(' / ')} after 1 / 2 / 3 clues.
    </>,
    <>Wrong or gave up: 0.</>,
  ],
  character: [
    <>
      {ROUND_COUNT} rounds × {pts(roundMaxPoints('character'))}.
    </>,
    <>
      Each round has {CHARACTERS_PER_ROUND} characters with 2 answers each (name and anime): {pts(roundMaxPoints('character') / CHARACTER_FIELDS_PER_ROUND)} per right answer.
    </>,
    <>Wrong or empty: 0.</>,
  ],
  connections: [
    <>Every group found with no mistake: {pts(MODE_MAX_POINTS.connections)}.</>,
    <>
      Every mistake takes {pts(CONNECTIONS_MISTAKE_COST)} off a solved board: {pts(MODE_MAX_POINTS.connections - CONNECTIONS_MISTAKE_COST * (CONNECTIONS_MAX_MISTAKES - 1))} with{' '}
      {CONNECTIONS_MAX_MISTAKES - 1} mistakes.
    </>,
    <>The {CONNECTIONS_MAX_MISTAKES}th mistake ends the board: 0.</>,
  ],
};

/** One line per daily mode for the Home overview. */
const SUMMARY: Record<DailyMode, string> = {
  anidle: `${pts(MODE_MAX_POINTS.anidle)} on the first try, ${fmtNumber(anidleStep)} less per extra try`,
  opening: `${ROUND_COUNT} × ${fmtNumber(roundMaxPoints('opening'))}, half with the clue`,
  ending: `${ROUND_COUNT} × ${fmtNumber(roundMaxPoints('ending'))}, half with the clue`,
  character: `${ROUND_COUNT} × ${fmtNumber(roundMaxPoints('character'))}, ${fmtNumber(roundMaxPoints('character') / CHARACTER_FIELDS_PER_ROUND)} per right name or anime`,
  screenshot: `${ROUND_COUNT} × ${fmtNumber(shotRound)}, ${fmtNumber(shotCost)} less per clue`,
};

/** Home: every mode's maximum and how it is earned, adding up to the day's total (folded, so Home stays one screen). */
export function ScoringGuide() {
  return (
    <details className="scoring-guide">
      <summary>
        <span className="scoring-title">How scoring works</span>
        <span className="muted small">{pts(DAILY_MAX_POINTS)} a day over five puzzles</span>
      </summary>
      <table className="scoring-table">
        <thead>
          <tr>
            <th>Mode</th>
            <th className="num">Max</th>
            <th>How</th>
          </tr>
        </thead>
        <tbody>
          {DAILY_MODES.map((mode) => (
            <tr key={mode}>
              <td>{MODE_LABELS[mode]}</td>
              <td className="num">{fmtNumber(MODE_MAX_POINTS[mode])}</td>
              <td>{SUMMARY[mode]}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td className="num">{fmtNumber(DAILY_MAX_POINTS)}</td>
            <td className="muted">only puzzles finished on their own day (UTC+7) count for the leaderboard</td>
          </tr>
        </tfoot>
      </table>
    </details>
  );
}
