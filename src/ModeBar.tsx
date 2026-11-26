import { useEffect, useRef } from 'react';
import { DAILY_MODES, MODE_LABELS, type DailyMode } from '../shared/modes';
import { fmtDate } from './format';
import { BackIcon } from './icons';
import { dailyHref, go } from './route';
import { Tabs } from './sakuga';

const MODE_TABS = DAILY_MODES.map((m) => ({ value: m, label: MODE_LABELS[m] }));

/**
 * Set when a mode is picked while the tabs have focus (arrow keys move and pick at once). Picking navigates and the
 * page is built again for the new route, so the next DayBar hands focus back to its selected tab.
 */
let refocusTabs = false;

/** Above a daily puzzle: back to that day on Home, and the same day's other modes (an archive day stays that day). */
export function DayBar({ mode, date }: { mode: DailyMode; date: string | null }) {
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!refocusTabs) return;
    refocusTabs = false;
    nav.current?.querySelector('sakuga-tabs')?.shadowRoot?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }, []);
  return (
    <nav ref={nav} className="mode-bar" aria-label={date ? `Puzzles of ${fmtDate(date)}` : "Today's puzzles"}>
      <a className="button ghost small back-link" href={date ? `/?date=${date}` : '/'}>
        <BackIcon />
        {date ? fmtDate(date) : 'Today'}
      </a>
      <Tabs
        label="Mode"
        options={MODE_TABS}
        value={mode}
        onChange={(m) => {
          refocusTabs = nav.current?.contains(document.activeElement) ?? false;
          go(dailyHref(m, date));
        }}
      />
    </nav>
  );
}

/** Above an unlimited puzzle: back to the page it was started from (Unlimited, or Beta for a beta mode). */
export function UnlimitedBar({ beta }: { beta: boolean }) {
  return (
    <nav className="mode-bar" aria-label={beta ? 'Beta modes' : 'Unlimited'}>
      <a className="button ghost small back-link" href={beta ? '/beta' : '/unlimited'}>
        <BackIcon />
        {beta ? 'Beta modes' : 'Unlimited'}
      </a>
    </nav>
  );
}

/** Above the pages reached from Home (Unlimited, Database, Leaderboard…): back to Home, lined up with a `narrow` page. */
export function HomeBar({ narrow }: { narrow: boolean }) {
  return (
    <nav className={`mode-bar${narrow ? ' narrow' : ''}`} aria-label="Back">
      <a className="button ghost small back-link" href="/">
        <BackIcon />
        Home
      </a>
    </nav>
  );
}
