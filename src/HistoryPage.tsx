import { useEffect, useState } from 'react';
import { MODE_LABELS, MODES, ROUND_COUNT } from '../shared/modes';
import { api, errorMessage, type Account, type History } from './api';
import { fmtDate, fmtNumber } from './format';

export function HistoryPage({ account }: { account: Account | null }) {
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.history().then(setData, (err: unknown) => setError(errorMessage(err)));
  }, []);

  return (
    <div className="stack">
      <header className="page-head">
        <span className="eyebrow">Komunitas</span>
        <h1>Riwayat</h1>
        <p className="muted">
          {account ? 'Statistik dan puzzle yang sudah kamu selesaikan.' : 'Statistik puzzle yang kamu mainkan di browser ini. Masuk supaya tersimpan di semua perangkat.'}
        </p>
      </header>

      {error && <div className="error-box">{error}</div>}
      {!data && !error && (
        <div className="center">
          <span className="spinner" />
        </div>
      )}

      {data && (
        <>
          <div className="stat-grid">
            {MODES.map((mode) => {
              const s = data.stats[mode];
              return (
                <section key={mode} className="card stat-card">
                  <h3>{MODE_LABELS[mode]}</h3>
                  <dl>
                    <div>
                      <dt>Dimainkan</dt>
                      <dd>{s.played}</dd>
                    </div>
                    <div>
                      <dt>{mode === 'anidle' ? 'Tertebak' : 'Sempurna'}</dt>
                      <dd>{s.played ? `${Math.round((s.perfect / s.played) * 100)}%` : '—'}</dd>
                    </div>
                    <div>
                      <dt>Streak</dt>
                      <dd>
                        {s.streak}
                        <span className="muted small"> / terbaik {s.bestStreak}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>Rata-rata</dt>
                      <dd>
                        {fmtNumber(s.averageScore)}
                        <span className="muted small"> / terbaik {fmtNumber(s.bestScore)}</span>
                      </dd>
                    </div>
                  </dl>
                </section>
              );
            })}
          </div>

          <section className="card">
            <h2>Terakhir dimainkan</h2>
            {!data.recent.length && <p className="muted">Belum ada puzzle yang selesai.</p>}
            <ol className="history-list">
              {data.recent.map((h) => (
                <li key={h.puzzleId}>
                  <a href={`#/play/${h.puzzleId}`}>
                    <span className="history-when">
                      <b>{MODE_LABELS[h.mode]}</b>
                      <span className="muted small">{h.date ? fmtDate(h.date) : 'Unlimited'}</span>
                    </span>
                    <span className="history-answers">{h.answers.join(' · ')}</span>
                    <span className="history-result muted small">
                      {h.mode === 'anidle' ? (h.solved ? `${h.attempts} tebakan` : 'tidak tertebak') : `${h.solved}/${ROUND_COUNT} ronde`}
                    </span>
                    <span className="history-score">{fmtNumber(h.score)}</span>
                  </a>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}
