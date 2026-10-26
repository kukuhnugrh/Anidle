import { useEffect, useState } from 'react';
import { MODE_LABELS, MODES, todayUtc, type Mode } from '../shared/modes';
import { api, errorMessage, type Account, type Leaderboard } from './api';
import { DatePicker } from './DatePicker';
import { fmtNumber, resultText } from './format';

type Tab = Mode | 'total';

function readDate(): string {
  const date = new URLSearchParams(location.hash.split('?')[1] ?? '').get('date');
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayUtc();
}

interface Row {
  username: string;
  avatar: string | null;
  score: number;
  detail: string;
}

function rowsOf(data: Leaderboard, tab: Tab): Row[] {
  if (tab === 'total') return data.total.map((t) => ({ ...t, detail: `${t.modes} ${t.modes === 1 ? 'mode' : 'modes'}` }));
  return data.modes[tab].map((e) => ({
    ...e,
    detail: resultText(tab, e.solved, e.attempts),
  }));
}

export function LeaderboardPage({ account }: { account: Account | null }) {
  const [date, setDate] = useState(readDate);
  const [tab, setTab] = useState<Tab>('total');
  const [data, setData] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = todayUtc();

  useEffect(() => {
    history.replaceState(null, '', `#/leaderboard${date === today ? '' : `?date=${date}`}`);
    let cancelled = false;
    setError(null);
    api.leaderboard(date).then(
      (d) => !cancelled && setData(d),
      (err: unknown) => !cancelled && setError(errorMessage(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [date, today]);

  const rows = data && data.date === date ? rowsOf(data, tab) : null;
  return (
    <div className="stack">
      <header className="page-head">
        <span className="eyebrow">Community</span>
        <h1>Leaderboard</h1>
        <p className="muted">Daily puzzle scores by date, played on the day itself. Only players with an account are shown.</p>
      </header>

      <div className="board-bar">
        <DatePicker date={date} onChange={setDate} />
        <div className="tabs-inline" role="tablist">
          {(['total', ...MODES] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'total' ? 'Total' : MODE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}
      {!account && (
        <p className="muted small">
          <a href="#/masuk">Sign in or sign up</a> to get your score listed here.
        </p>
      )}

      <section className="card board">
        {!rows && !error && <div className="center board-empty"><span className="spinner" /></div>}
        {rows && !rows.length && <p className="muted board-empty">Nobody has finished a {tab === 'total' ? '' : `${MODE_LABELS[tab]} `}puzzle on this date yet.</p>}
        {rows && rows.length > 0 && (
          <ol className="board-list">
            {rows.map((r, i) => (
              <li key={r.username} className={`board-row${r.username === account?.username ? ' me' : ''}${i < 3 ? ` top${i + 1}` : ''}`}>
                <span className="board-rank">{i + 1}</span>
                {r.avatar ? <img className="avatar" src={r.avatar} alt="" /> : <span className="avatar fallback">{r.username[0]?.toUpperCase()}</span>}
                <span className="board-name">
                  <b>{r.username}</b>
                  <span className="muted small">{r.detail}</span>
                </span>
                <span className="board-score">{fmtNumber(r.score)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
