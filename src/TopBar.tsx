import { useEffect, useRef, useState } from 'react';
import type { Account, TodayScore } from './api';
import { fmtNumber } from './format';
import { ListIcon, LogoutIcon, SettingsIcon, ShieldIcon, UserIcon } from './icons';
import type { Route } from './route';
import { useElementEvent } from './sakuga';
import { applyTheme, currentTheme } from './theme';
import { Volume } from './VolumeControl';

/** Night/day switch; the choice is kept in a cookie (see theme.ts). */
function ThemeToggle() {
  const [theme, setTheme] = useState(currentTheme);
  const toggle = useRef<SakugaToggleElement>(null);
  useElementEvent(toggle, 'change', (el) => {
    const next = el.checked ? 'dark' : 'light';
    applyTheme(next);
    setTheme(next);
  });
  return (
    <div className="theme-row">
      {/* The switch's own label says this to screen readers. */}
      <span aria-hidden="true">Night mode</span>
      <sakuga-toggle ref={toggle} label="Night mode" checked={theme === 'dark'} />
    </div>
  );
}

function Brand() {
  return (
    <a className="brand" href="/" aria-label="Anidle home">
      <img className="brand-mark" src="/logo-128.png" alt="" />
      <span className="brand-name">Anidle</span>
    </a>
  );
}

export function Avatar({ account }: { account: Account }) {
  return account.mal?.avatar ? (
    <img className="avatar" src={account.mal.avatar} alt="" />
  ) : (
    <span className="avatar fallback">{account.username[0]?.toUpperCase()}</span>
  );
}

/**
 * The bar over every page: the brand (to Home) on the left; today's score, settings and the account on the right,
 * the last two each a native popover (light dismiss and Escape for free) that closes again on in-app navigation.
 */
export function TopBar({
  route,
  account,
  admin,
  today,
  onLogout,
}: {
  route: Route;
  account: Account | null;
  admin: boolean;
  today: TodayScore | null;
  onLogout: () => void;
}) {
  const settings = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // The volume slider draws its effects on a canvas even while hidden (at the page's corner), so it only
  // exists while the panel is open.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Every navigation sets a new route object: a link followed from a panel closes it.
  useEffect(() => {
    for (const panel of [settings.current, menu.current]) if (panel?.matches(':popover-open')) panel.hidePopover();
  }, [route]);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Brand />
        <div className="topbar-actions">
          {today && (
            <a className="today-chip" href="/" title="Points from today's five daily puzzles">
              <span className="today-label">Today</span>
              <b>{fmtNumber(today.score)}</b>
              <span className="today-max">/ {fmtNumber(today.max)}</span>
            </a>
          )}
          <button className="icon-button topbar-button" popoverTarget="settings-panel" aria-label="Settings" title="Settings">
            <SettingsIcon />
          </button>
          {account ? (
            <button className="avatar-button" popoverTarget="account-menu" aria-label="Account menu" title={account.username}>
              <Avatar account={account} />
            </button>
          ) : (
            <a className="button primary small" href="/masuk" title="Playing as a guest. Progress is saved in this browser.">
              Sign in
            </a>
          )}
        </div>
      </div>

      <div ref={settings} id="settings-panel" className="bar-panel" popover="auto" onToggle={(e) => setSettingsOpen(e.newState === 'open')}>
        <h2 className="bar-panel-title">Settings</h2>
        <div className="bar-panel-row">
          <span className="field-label">Sound</span>
          {settingsOpen && <Volume />}
        </div>
        <ThemeToggle />
      </div>

      {account && (
        <div ref={menu} id="account-menu" className="bar-panel account-menu" popover="auto">
          <div className="menu-head">
            <Avatar account={account} />
            <span className="account-text">
              <b>{account.username}</b>
              <span className={account.mal ? 'mal-on' : 'muted'}>{account.mal ? `MAL · ${account.mal.username}` : 'MAL not linked'}</span>
            </span>
          </div>
          <nav className="menu-links" aria-label="Account">
            <a className="menu-item" href="/akun" aria-current={route.view === 'account' ? 'page' : undefined}>
              <UserIcon />
              Account &amp; MAL
            </a>
            {account.mal && (
              <a className="menu-item" href="/mylist" aria-current={route.view === 'mylist' ? 'page' : undefined}>
                <ListIcon />
                My MAL list
              </a>
            )}
            {admin && (
              <a className="menu-item" href="/admin" aria-current={route.view === 'admin' ? 'page' : undefined}>
                <ShieldIcon />
                Review media
              </a>
            )}
          </nav>
          <button className="menu-item" onClick={onLogout}>
            <LogoutIcon />
            Sign out
          </button>
        </div>
      )}
    </header>
  );
}
