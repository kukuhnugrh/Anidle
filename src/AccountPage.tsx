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
        text: `${result.completed} anime completed tersinkron.${result.queued ? ` ${result.queued} judul baru masuk antrean dan siap setelah update data berikutnya.` : ''}`,
      });
    });

  const unlink = () =>
    act('unlink', async () => {
      if (!confirm('Putuskan akun MAL? Pool completed-mu tidak bisa dimainkan sampai dihubungkan lagi.')) return;
      onAccount((await api.unlinkMal()).account);
      setMessage({ kind: 'ok', text: 'Akun MAL diputus.' });
    });

  const notice = message && <div className={message.kind === 'ok' ? 'ok-box' : 'error-box'}>{message.text}</div>;

  if (!account)
    return (
      <div className="stack narrow">
        <header className="page-head">
          <span className="eyebrow">Akun</span>
          <h1>Akun & MAL</h1>
        </header>
        {notice}
        <section className="card">
          <p className="muted">Main tanpa akun juga bisa. Masuk atau daftar untuk menyimpan progres di semua perangkat dan menghubungkan akun MAL.</p>
          <a className="button primary" href="#/masuk">
            Masuk / Daftar
          </a>
        </section>
      </div>
    );

  const mal = account.mal;
  return (
    <div className="stack narrow">
      <header className="page-head">
        <span className="eyebrow">Akun</span>
        <h1>Akun & MAL</h1>
      </header>
      {notice}

      <section className="card profile">
        <Avatar account={account} />
        <div>
          <h2>{account.username}</h2>
          <p className="muted small">Progres harian dan unlimited tersimpan di akun ini.</p>
        </div>
      </section>

      <section className="card mal-card">
        <div className="mal-card-head">
          <span className="mal-mark">MAL</span>
          <div>
            <h2>MyAnimeList</h2>
            <p className="muted small">{mal ? `Terhubung ke ${mal.username}` : 'Belum terhubung'}</p>
          </div>
        </div>
        {mal ? (
          <>
            <div className="stats">
              <div>
                <span className="stat-value">{mal.completed.toLocaleString('id-ID')}</span>
                <span className="muted small">anime completed</span>
              </div>
              <div>
                <span className="stat-value">{mal.lastSyncAt ? new Date(mal.lastSyncAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '—'}</span>
                <span className="muted small">{mal.lastSyncAt ? `sinkron ${new Date(mal.lastSyncAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}` : 'belum pernah sinkron'}</span>
              </div>
            </div>
            <div className="actions">
              <button className="primary" disabled={busy !== null} onClick={sync}>
                {busy === 'sync' ? 'Menyinkron…' : 'Sinkron ulang dari MAL'}
              </button>
              <button className="ghost danger" disabled={busy !== null} onClick={unlink}>
                Putuskan
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">Hubungkan akun MAL untuk membuka pool dari list completed (teman, bareng, saya). List private juga bisa dibaca.</p>
            <a className="button mal-button" href="/api/oauth/login">
              Hubungkan akun MAL
            </a>
          </>
        )}
      </section>
    </div>
  );
}
