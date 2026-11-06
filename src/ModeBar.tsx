import { DAILY_MODES, MODE_LABELS, type DailyMode } from '../shared/modes';
import { fmtDate } from './format';
import { BackIcon } from './icons';
import { dailyHref } from './route';

/** Above a daily puzzle: back to that day on Home, and the same day's other modes (an archive day stays that day). */
export function DayBar({ mode, date }: { mode: DailyMode; date: string | null }) {
  return (
    <nav className="mode-bar" aria-label={date ? `Puzzles of ${fmtDate(date)}` : "Today's puzzles"}>
      <a className="button ghost small back-link" href={date ? `/?date=${date}` : '/'}>
        <BackIcon />
        {date ? fmtDate(date) : 'Today'}
      </a>
      <div className="mode-chips">
        {DAILY_MODES.map((m) => (
          <a key={m} className={`mode-chip${m === mode ? ' active' : ''}`} href={dailyHref(m, date)} aria-current={m === mode ? 'page' : undefined}>
            {MODE_LABELS[m]}
          </a>
        ))}
      </div>
    </nav>
  );
}

/** Above an unlimited puzzle: back to the Unlimited settings. */
export function UnlimitedBar() {
  return (
    <nav className="mode-bar" aria-label="Unlimited">
      <a className="button ghost small back-link" href="/unlimited">
        <BackIcon />
        Unlimited
      </a>
    </nav>
  );
}
