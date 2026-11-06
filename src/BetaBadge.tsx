import { isBetaMode, type Mode } from '../shared/modes';

/** "Beta" next to a beta mode's name (unlimited only, still being tested); nothing for the others. */
export function BetaBadge({ mode }: { mode: Mode }) {
  return isBetaMode(mode) ? (
    <span className="beta-badge" title="New mode in testing: unlimited only, not in the daily puzzles or leaderboard yet">
      Beta
    </span>
  ) : null;
}
