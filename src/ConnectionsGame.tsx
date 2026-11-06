import { useState } from 'react';
import { POOL_LABELS } from '../shared/catalog';
import { CONNECTIONS_GROUP_SIZE } from '../shared/connections';
import { MODE_LABELS, MODE_MAX_POINTS } from '../shared/modes';
import { api, errorMessage, type ConnectionsState } from './api';
import { BetaBadge } from './BetaBadge';
import { fmtDate, fmtNumber } from './format';
import { HowToPlay } from './HowToPlay';
import { connectionsShareText, ShareButton } from './share';

type Group = ConnectionsState['groups'][number];

/** A found (or, once the board is over, revealed) group: its link and titles in the group's colour. */
function GroupBar({ group, titleOf }: { group: Group; titleOf: (malId: number) => string }) {
  return (
    <div className={`cx-group tier-${group.tier}${group.found ? '' : ' missed'}`}>
      <b>{group.label}</b>
      <span>{group.malIds.map(titleOf).join(' · ')}</span>
    </div>
  );
}

export function ConnectionsGame({ puzzle, onChange, onNewUnlimited }: { puzzle: ConnectionsState; onChange: (p: ConnectionsState) => void; onNewUnlimited: () => Promise<void> }) {
  // The board order on screen: the server's, until Shuffle.
  const [order, setOrder] = useState(() => puzzle.tiles.map((t) => t.malId));
  const [selected, setSelected] = useState<number[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tiles = new Map(puzzle.tiles.map((t) => [t.malId, t]));
  const titleOf = (malId: number) => tiles.get(malId)?.title ?? `#${malId}`;
  const grouped = new Set(puzzle.groups.flatMap((g) => g.malIds));
  const open = order.filter((id) => !grouped.has(id));
  const playing = !puzzle.finished;

  const toggle = (malId: number) =>
    setSelected((s) => (s.includes(malId) ? s.filter((id) => id !== malId) : s.length < CONNECTIONS_GROUP_SIZE ? [...s, malId] : s));

  const shuffle = () =>
    setOrder((o) => {
      const next = [...o];
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j]!, next[i]!];
      }
      return next;
    });

  const submit = async () => {
    setSending(true);
    setError(null);
    setNote(null);
    try {
      const next = await api.connectionsGuess(puzzle.id, selected);
      const last = next.guesses.at(-1)!;
      // A found group leaves the board; a miss keeps the pick so one title can be swapped.
      if (last.group !== null || next.finished) setSelected([]);
      if (last.group === null) setNote(last.oneAway ? 'One away…' : 'Not a group.');
      onChange(next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const left = puzzle.maxMistakes - puzzle.mistakes;
  return (
    <div className="connections-game">
      <header className="page-head game-head">
        <div>
          <span className="eyebrow">{puzzle.date ? `Daily · ${fmtDate(puzzle.date)}` : `Unlimited · ${POOL_LABELS[puzzle.pool]}`}</span>
          <div className="title-row">
            <h1>{MODE_LABELS[puzzle.mode]}</h1>
            <BetaBadge mode={puzzle.mode} />
            <HowToPlay mode={puzzle.mode} />
          </div>
          <p className="muted small">
            Sort the board into groups of {CONNECTIONS_GROUP_SIZE} anime that share something: a genre, theme, source, studio, year, or OP/ED artist.
          </p>
        </div>
        <div className="cx-mistakes" aria-label={`${left} mistakes left`}>
          <span className="muted small">Mistakes left</span>
          <span className="cx-dots">
            {Array.from({ length: puzzle.maxMistakes }, (_, i) => (
              <span key={i} className={`cx-dot${i < left ? ' on' : ''}`} />
            ))}
          </span>
        </div>
      </header>

      {puzzle.groups.length > 0 && (
        <div className="cx-groups">
          {puzzle.groups.map((g) => (
            <GroupBar key={g.tier} group={g} titleOf={titleOf} />
          ))}
        </div>
      )}

      {open.length > 0 && (
        <section className="card cx-card">
          <div className="cx-board">
            {open.map((malId) => {
              const t = tiles.get(malId)!;
              const on = selected.includes(malId);
              return (
                <button
                  key={malId}
                  type="button"
                  className={`cx-tile${on ? ' selected' : ''}`}
                  aria-pressed={on}
                  disabled={!playing || sending || (!on && selected.length >= CONNECTIONS_GROUP_SIZE)}
                  onClick={() => toggle(malId)}
                  title={t.titleEn ? `${t.title} (${t.titleEn})` : t.title}
                >
                  {t.cover ? <img src={t.cover} alt="" /> : <span className="cx-nocover" />}
                  <span className="cx-names">
                    <b>{t.title}</b>
                    {t.titleEn && <span>{t.titleEn}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          {playing && (
            <div className="cx-controls">
              <span className={`cx-note${note ? ' show' : ''}`} role="status">
                {note ?? `${selected.length} of ${CONNECTIONS_GROUP_SIZE} picked`}
              </span>
              <div className="actions">
                <button className="ghost" disabled={sending} onClick={shuffle}>
                  Shuffle
                </button>
                <button className="ghost" disabled={sending || !selected.length} onClick={() => setSelected([])}>
                  Deselect all
                </button>
                <button className="primary" disabled={sending || selected.length !== CONNECTIONS_GROUP_SIZE} onClick={submit}>
                  {sending ? 'Checking…' : 'Submit'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {error && <div className="error-box">{error}</div>}

      {puzzle.finished && (
        <section className="card final">
          <div>
            <span className="eyebrow">{puzzle.solved ? 'Solved' : 'Out of mistakes'}</span>
            <h2>{fmtNumber(puzzle.score ?? 0)} pts</h2>
            <p className="muted small">
              {puzzle.groups.filter((g) => g.found).length} of {puzzle.groups.length} groups · {puzzle.mistakes} {puzzle.mistakes === 1 ? 'mistake' : 'mistakes'} · max{' '}
              {fmtNumber(MODE_MAX_POINTS[puzzle.mode])} pts
            </p>
          </div>
          <div className="actions">
            <ShareButton text={connectionsShareText(puzzle)} />
            <button className="primary" onClick={() => onNewUnlimited().catch((err: unknown) => setError(errorMessage(err)))}>
              Play {MODE_LABELS[puzzle.mode]} unlimited
            </button>
            <a className="button ghost" href="/">
              Home
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
