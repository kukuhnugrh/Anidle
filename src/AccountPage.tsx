import { useState } from 'react';
import { api, errorMessage, type Account } from './api';
import { Avatar } from './Sidebar';

export type Notice = { kind: 'ok' | 'error'; text: string } | null;

export function AccountPage({ account, onAccount, initialNotice }: { account: Account | null; onAccount: (a: Account | null) => void; initialNotice: Notice }) {
  const [busy, setBusy] = useState<'sync' | 'unlink' | null>(null);
  const [message, setMessage] = useState<Notice>(initialNotice);

  const act = async (kind: NonNullable<typeof busy>, task: () => Promise<void>) => {
    setBusy(kind);
    setMessage(null);
    try {
      await task();
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const sync = () =>
    act('sync', async () => {
      const result = await api.sync();
      if (account?.mal) onAccount({ ...account, mal: { ...account.mal, completed: result.completed, lastSyncAt: new Date().toISOString() } });
      setMessage({
        kind: 'ok',
        text: `${result.completed} completed anime synced.${result.queued ? ` ${result.queued} new titles were queued and will be ready after the next data update.` : ''}`,
      });
    });

  const unlink = () =>
    act('unlink', async () => {
      if (!confirm('Unlink your MAL account? Your completed pools cannot be played until you link it again.')) return;
      onAccount((await api.unlinkMal()).account);
      setMessage({ kind: 'ok', text: 'MAL account unlinked.' });
    });

  const notice = message && <div className={message.kind === 'ok' ? 'ok-box' : 'error-box'}>{message.text}</div>;

  if (!account)
    return (
      <div className="stack narrow">
        <header className="page-head">
          <span className="eyebrow">Account</span>
          <h1>Account & MAL</h1>
        </header>
        {notice}
        <section className="card">
          <p className="muted">You can play without an account too. Sign in or sign up to save your progress across devices and link your MAL account.</p>
          <a className="button primary" href="#/masuk">
            Sign in / Sign up
          </a>
        </section>
      </div>
    );

  const mal = account.mal;
  return (
    <div className="stack narrow">
      <header className="page-head">
        <span className="eyebrow">Account</span>
        <h1>Account & MAL</h1>
      </header>
      {notice}

      <section className="card profile">
        <Avatar account={account} />
        <div>
          <h2>{account.username}</h2>
          <p className="muted small">Daily and unlimited progress is saved to this account.</p>
        </div>
      </section>

      <section className="card mal-card">
        <div className="mal-card-head">
          <span className="mal-mark">MAL</span>
          <div>
            <h2>MyAnimeList</h2>
            <p className="muted small">{mal ? `Linked to ${mal.username}` : 'Not linked'}</p>
          </div>
        </div>
        {mal ? (
          <>
            <div className="stats">
              <div>
                <span className="stat-value">{mal.completed.toLocaleString('en-US')}</span>
                <span className="muted small">anime completed</span>
              </div>
              <div>
                <span className="stat-value">{mal.lastSyncAt ? new Date(mal.lastSyncAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}</span>
                <span className="muted small">{mal.lastSyncAt ? `synced ${new Date(mal.lastSyncAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'never synced'}</span>
              </div>
            </div>
            <div className="actions">
              <button className="primary" disabled={busy !== null} onClick={sync}>
                {busy === 'sync' ? 'Syncing…' : 'Resync from MAL'}
              </button>
              <button className="ghost danger" disabled={busy !== null} onClick={unlink}>
                Unlink
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">Link your MAL account to unlock pools from completed lists (friends, all friends, mine). Private lists can be read too.</p>
            <a className="button mal-button" href="/api/oauth/login">
              Link MAL account
            </a>
          </>
        )}
      </section>
    </div>
  );
}
