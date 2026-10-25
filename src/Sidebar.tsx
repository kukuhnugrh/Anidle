import type { ComponentType } from 'react';
import type { Account } from './api';
import { ClockIcon, CloseIcon, DatabaseIcon, DiscIcon, HomeIcon, ImageIcon, LogoutIcon, MusicIcon, PuzzleIcon, ShieldIcon, ShuffleIcon, TrophyIcon, UsersIcon } from './icons';
import { dailyHref, type Route } from './route';

/** Nav entry ids: a view, or `daily:<mode>` for the daily puzzle of a mode. */
const NAV: { title: string; items: { id: string; href: string; label: string; Icon: ComponentType }[] }[] = [
  { title: 'Main', items: [{ id: 'home', href: '#/', label: 'Beranda', Icon: HomeIcon }] },
  {
    title: 'Harian',
    items: [
      { id: 'daily:anidle', href: dailyHref('anidle'), label: 'Anidle', Icon: PuzzleIcon },
      { id: 'daily:opening', href: dailyHref('opening'), label: 'Opening', Icon: MusicIcon },
      { id: 'daily:ending', href: dailyHref('ending'), label: 'Ending', Icon: DiscIcon },
      { id: 'daily:character', href: dailyHref('character'), label: 'Karakter', Icon: UsersIcon },
      { id: 'daily:screenshot', href: dailyHref('screenshot'), label: 'Screenshot', Icon: ImageIcon },
    ],
  },
  {
    title: 'Bebas',
    items: [
      { id: 'unlimited', href: '#/unlimited', label: 'Unlimited', Icon: ShuffleIcon },
      { id: 'database', href: '#/database', label: 'Database', Icon: DatabaseIcon },
    ],
  },
  {
    title: 'Komunitas',
    items: [
      { id: 'leaderboard', href: '#/leaderboard', label: 'Leaderboard', Icon: TrophyIcon },
      { id: 'history', href: '#/riwayat', label: 'Riwayat', Icon: ClockIcon },
    ],
  },
];

/** Only for ADMIN_USERS (the server checks again on every admin request). */
const ADMIN_SECTION = { title: 'Admin', items: [{ id: 'admin', href: '#/admin', label: 'Review media', Icon: ShieldIcon }] };

/** An unlimited puzzle in progress belongs to the Unlimited entry. */
const navId = (route: Route) => (route.view === 'daily' ? `daily:${route.mode}` : route.view === 'play' ? 'unlimited' : route.view);

export function Brand() {
  return (
    <a className="brand" href="#/">
      <span className="brand-mark" aria-hidden="true">
        A
      </span>
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

export function Sidebar({ route, account, admin, open, onClose, onLogout }: { route: Route; account: Account | null; admin: boolean; open: boolean; onClose: () => void; onLogout: () => void }) {
  const current = navId(route);
  const sections = admin ? [...NAV, ADMIN_SECTION] : NAV;
  return (
    <>
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="sidebar-head">
          <Brand />
          <button className="icon-button sidebar-close" onClick={onClose} aria-label="Tutup menu">
            <CloseIcon />
          </button>
        </div>
        <nav className="sidebar-nav">
          {sections.map((section) => (
            <div key={section.title} className="nav-section">
              <div className="nav-title">{section.title}</div>
              {section.items.map(({ id, href, label, Icon }) => (
                <a key={id} className={`nav-item${current === id ? ' active' : ''}`} href={href} aria-current={current === id ? 'page' : undefined}>
                  <Icon />
                  {label}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          {account ? (
            <div className="account-row">
              <a className={`account-chip${current === 'account' ? ' active' : ''}`} href="#/akun" title="Akun & MAL">
                <Avatar account={account} />
                <span className="account-text">
                  <b>{account.username}</b>
                  <span className={account.mal ? 'mal-on' : 'muted'}>{account.mal ? `MAL · ${account.mal.username}` : 'MAL belum terhubung'}</span>
                </span>
              </a>
              <button className="icon-button" onClick={onLogout} title="Keluar" aria-label="Keluar">
                <LogoutIcon />
              </button>
            </div>
          ) : (
            <div className="guest">
              <p className="muted small">Main sebagai tamu. Progres tersimpan di browser ini.</p>
              <a className={`button primary block${current === 'auth' ? ' active' : ''}`} href="#/masuk">
                Masuk / Daftar
              </a>
            </div>
          )}
        </div>
      </aside>
      {open && <div className="backdrop" onClick={onClose} />}
    </>
  );
}
