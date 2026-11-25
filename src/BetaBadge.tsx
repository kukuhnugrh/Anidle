import { isBetaMode, type Mode } from '../shared/modes';

/** "Beta" next to a beta mode's name (unlimited only, still being tested), with what that means on hover, focus or tap; nothing for the others. */
export function BetaBadge({ mode }: { mode: Mode }) {
  return isBetaMode(mode) ? (
    <sakuga-tooltip className="beta-tip" label="Beta" text="New mode in testing: unlimited only, not in the daily puzzles or leaderboard yet">
      <span className="beta-badge">Beta</span>
    </sakuga-tooltip>
  ) : null;
}
