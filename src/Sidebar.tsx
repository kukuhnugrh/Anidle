import type { ComponentType } from 'react';
import { MODE_LABELS, type Mode } from '../shared/modes';
import type { Account, TodayScore } from './api';
import { fmtNumber } from './format';
import { ClockIcon, CloseIcon, DatabaseIcon, DiscIcon, HomeIcon, ImageIcon, LogoutIcon, MusicIcon, PuzzleIcon, ShieldIcon, ShuffleIcon, TrophyIcon, UsersIcon } from './icons';
import { dailyHref, type Route } from './route';

/** Nav entry ids: a view, or `daily:<mode>` for the daily puzzle of a mode (those show today's score for it). */
const NAV: { title: string; items: { id: string; href: string; label: string; Icon: ComponentType; mode?: Mode }[] }[] = [
  { title: 'Main', items: [{ id: 'home', href: '#/', label: 'Home', Icon: HomeIcon }] },
  {
    title: 'Daily',
    items: [
      { id: 'daily:anidle', href: dailyHref('anidle'), label: MODE_LABELS.anidle, Icon: PuzzleIcon, mode: 'anidle' },
      { id: 'daily:opening', href: dailyHref('opening'), label: MODE_LABELS.opening, Icon: MusicIcon, mode: 'opening' },
      { id: 'daily:ending', href: dailyHref('ending'), label: MODE_LABELS.ending, Icon: DiscIcon, mode: 'ending' },
      { id: 'daily:character', href: dailyHref('character'), label: MODE_LABELS.character, Icon: UsersIcon, mode: 'character' },
      { id: 'daily:screenshot', href: dailyHref('screenshot'), label: MODE_LABELS.screenshot, Icon: ImageIcon, mode: 'screenshot' },
    ],
  },
  {
    title: 'Free play',
    items: [
      { id: 'unlimited', href: '#/unlimited', label: 'Unlimited', Icon: ShuffleIcon },
      { id: 'database', href: '#/database', label: 'Database', Icon: DatabaseIcon },
    ],
  },
  {
    title: 'Community',
    items: [
      { id: 'leaderboard', href: '#/leaderboard', label: 'Leaderboard', Icon: TrophyIcon },
      { id: 'history', href: '#/riwayat', label: 'History', Icon: ClockIcon },
    ],
  },
];

/** Only for ADMIN_USERS (the server checks again on every admin request). */
const ADMIN_SECTION: (typeof NAV)[number] = { title: 'Admin', items: [{ id: 'admin', href: '#/admin', label: 'Review media', Icon: ShieldIcon }] };

/** An unlimited puzzle in progress belongs to the Unlimited entry. */
const navId = (route: Route) => (route.view === 'daily' ? `daily:${route.mode}` : route.view === 'play' ? 'unlimited' : route.view);

export function Brand() {
  return (
    <a className="brand" href="#/">
      <img className="brand-mark" src="/logo-128.png" alt="" />
      Anidle
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

export function Sidebar({
  route,
  account,
  today,
  admin,
  open,
  onClose,
  onLogout,
}: {
  route: Route;
  account: Account | null;
  today: TodayScore | null;
  admin: boolean;
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
}) {
  const current = navId(route);
  const sections = admin ? [...NAV, ADMIN_SECTION] : NAV;
  return (
    <>
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="sidebar-head">
          <Brand />
          <button className="icon-button sidebar-close" onClick={onClose} aria-label="Close menu">
            <CloseIcon />
          </button>
        </div>
        <nav className="sidebar-nav">
          {sections.map((section) => (
            <div key={section.title} className="nav-section">
              <div className="nav-title">{section.title}</div>
              {section.items.map(({ id, href, label, Icon, mode }) => {
                const score = mode ? today?.modes[mode] : undefined;
                return (
                  <a key={id} className={`nav-item${current === id ? ' active' : ''}`} href={href} aria-current={current === id ? 'page' : undefined}>
                    <Icon />
                    {label}
                    {score != null && (
                      <span className="nav-score" title={`Today's ${label} score`}>
                        {fmtNumber(score)}
                      </span>
                    )}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
        {today && (
          <a className="today-score" href="#/" title="Points from today's five daily puzzles">
            <span className="muted small">Today's score</span>
            <span>
              <b>{fmtNumber(today.score)}</b>
              <span className="muted small"> / {fmtNumber(today.max)}</span>
            </span>
          </a>
        )}
        <div className="sidebar-foot">
          {account ? (
            <div className="account-row">
              <a className={`account-chip${current === 'account' ? ' active' : ''}`} href="#/akun" title="Account & MAL">
                <Avatar account={account} />
                <span className="account-text">
                  <b>{account.username}</b>
                  <span className={account.mal ? 'mal-on' : 'muted'}>{account.mal ? `MAL · ${account.mal.username}` : 'MAL not linked'}</span>
                </span>
              </a>
              <button className="icon-button" onClick={onLogout} title="Sign out" aria-label="Sign out">
                <LogoutIcon />
              </button>
            </div>
          ) : (
            <div className="guest">
              <p className="muted small">Playing as a guest. Progress is saved in this browser.</p>
              <a className={`button primary block${current === 'auth' ? ' active' : ''}`} href="#/masuk">
                Sign in / Sign up
              </a>
            </div>
          )}
        </div>
      </aside>
      {open && <div className="backdrop" onClick={onClose} />}
    </>
  );
}
