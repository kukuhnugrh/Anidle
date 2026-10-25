import type { ComponentType } from 'react';
import type { Account } from './api';
import { CalendarIcon, CloseIcon, DatabaseIcon, HomeIcon, LogoutIcon, ShuffleIcon } from './icons';
import type { View } from './route';

const NAV: { title: string; items: { view: View; href: string; label: string; Icon: ComponentType }[] }[] = [
  {
    title: 'Main',
    items: [
      { view: 'home', href: '#/', label: 'Beranda', Icon: HomeIcon },
      { view: 'daily', href: '#/daily', label: 'Harian', Icon: CalendarIcon },
      { view: 'unlimited', href: '#/unlimited', label: 'Unlimited', Icon: ShuffleIcon },
    ],
  },
  {
    title: 'Jelajah',
    items: [{ view: 'database', href: '#/database', label: 'Database', Icon: DatabaseIcon }],
  },
];

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

export function Sidebar({ view, account, open, onClose, onLogout }: { view: View; account: Account | null; open: boolean; onClose: () => void; onLogout: () => void }) {
  // An unlimited puzzle in progress belongs to the Unlimited entry.
  const current = view === 'play' ? 'unlimited' : view;
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
          {NAV.map((section) => (
            <div key={section.title} className="nav-section">
              <div className="nav-title">{section.title}</div>
              {section.items.map(({ view: target, href, label, Icon }) => (
                <a key={target} className={`nav-item${current === target ? ' active' : ''}`} href={href} aria-current={current === target ? 'page' : undefined}>
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
