import { useRef, useState, type PointerEvent } from 'react';
import { TIMELINE_POINT } from '../shared/timeline';
import { api, errorMessage, type TimelineState } from './api';
import { fmtNumber } from './format';
import { FinishCard, GameHeader, TitleThumb } from './GameParts';
import { timelineShareText } from './share';

export function TimelineGame({ puzzle, onChange, onNewUnlimited }: { puzzle: TimelineState; onChange: (p: TimelineState) => void; onNewUnlimited: () => Promise<void> }) {
  const [roundView, setRoundView] = useState(Math.min(puzzle.current, puzzle.rounds.length - 1));
  const round = puzzle.rounds[roundView]!;
  // The player's order for the round on screen, reset when another round shows.
  const [order, setOrder] = useState({ round: roundView, ids: round.tiles.map((t) => t.malId) });
  const ids = order.round === roundView ? order.ids : round.tiles.map((t) => t.malId);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playing = roundView === puzzle.current && !round.finished;
  const tiles = new Map(round.tiles.map((t) => [t.malId, t]));

  /** Moves the title at `from` to `to`, shifting the ones between (a swap for neighbours). */
  const move = (from: number, to: number) => {
    const next = [...ids];
    next.splice(to, 0, ...next.splice(from, 1));
    setOrder({ round: roundView, ids: next });
  };

  // Drag to reorder (mouse anywhere on a row; touch on its grip, so the page still scrolls). The row
  // follows the pointer: once it is over another row, it takes that row's place.
  const rows = useRef<Array<HTMLLIElement | null>>([]);
  const [dragging, setDragging] = useState<number | null>(null);
  const dragStart = (e: PointerEvent<HTMLLIElement>, malId: number) => {
    const target = e.target as Element;
    if (!playing || sending || e.button !== 0 || target.closest('button')) return;
    if (e.pointerType !== 'mouse' && !target.closest('.tl-grip')) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(malId);
  };
  const dragMove = (e: PointerEvent<HTMLLIElement>) => {
    if (dragging === null) return;
    const from = ids.indexOf(dragging);
    const to = rows.current.findIndex((row) => {
      const box = row?.getBoundingClientRect();
      return box !== undefined && e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
    });
    if (to >= 0 && to !== from) move(from, to);
  };

  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      onChange(await api.timelineOrder(puzzle.id, roundView, ids));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const shown = round.finished ? round.tiles.map((t) => t.malId) : ids;
  return (
    <div className="round-game big-game">
      <GameHeader
        puzzle={puzzle}
        intro={`Put the anime in the order they started airing, oldest first: drag them, or use the arrows. ${fmtNumber(TIMELINE_POINT)} pts for every title in its right place.`}
        aside={
          <div className="round-tabs" role="tablist">
            {puzzle.rounds.map((r, i) => (
              <button
                key={i}
                role="tab"
                aria-selected={i === roundView}
                className={`round-tab${i === roundView ? ' active' : ''}${r.finished ? (r.placed === r.tiles.length ? ' won' : r.placed ? '' : ' lost') : ''}`}
                disabled={i > puzzle.current}
                onClick={() => setRoundView(i)}
              >
                <span>Round {i + 1}</span>
                <b>{r.finished ? fmtNumber(r.points) : i === puzzle.current ? '…' : '—'}</b>
              </button>
            ))}
          </div>
        }
      />

      <section className="card cx-card">
        {/* Wide screens lay the titles out left to right, phones top to bottom (styles.css). */}
        <div className="tl-axis muted small">
          <span>Oldest</span>
          <span className="tl-axis-end">Newest →</span>
        </div>
        <ol className="tl-list">
          {shown.map((malId, i) => {
            const t = tiles.get(malId)!;
            const right = round.answer?.[i] === malId;
            return (
              <li
                key={malId}
                ref={(row) => {
                  rows.current[i] = row;
                }}
                className={`tl-row${round.finished ? (right ? ' right' : ' wrong') : ''}${playing ? ' draggable' : ''}${dragging === malId ? ' dragging' : ''}`}
                onPointerDown={(e) => dragStart(e, malId)}
                onPointerMove={dragMove}
                onPointerUp={() => setDragging(null)}
                onPointerCancel={() => setDragging(null)}
              >
                {playing && (
                  <span className="tl-grip" aria-hidden="true">
                    ⠿
                  </span>
                )}
                <span className="tl-pos">{i + 1}</span>
                <TitleThumb title={t} />
                {round.years ? (
                  <span className="tl-year">
                    {round.years[malId]}
                    <span className="small">{right ? ' ✓' : ' ✗'}</span>
                  </span>
                ) : (
                  playing && (
                    <span className="tl-moves">
                      <button className="ghost small" disabled={i === 0 || sending} onClick={() => move(i, i - 1)} aria-label={`Move ${t.title} earlier`}>
                        <span className="tl-arrow">▲</span>
                      </button>
                      <button className="ghost small" disabled={i === shown.length - 1 || sending} onClick={() => move(i, i + 1)} aria-label={`Move ${t.title} later`}>
                        <span className="tl-arrow">▼</span>
                      </button>
                    </span>
                  )
                )}
              </li>
            );
          })}
        </ol>
        <span className="muted small tl-axis-bottom">Newest</span>
        {playing ? (
          <div className="cx-controls">
            <span className="cx-note">One submission per round.</span>
            <button className="primary" disabled={sending} onClick={submit}>
              {sending ? 'Checking…' : 'Lock in order'}
            </button>
          </div>
        ) : (
          round.answer && (
            <div className="odd-verdict">
              <span className={`hl-verdict ${round.placed === round.tiles.length ? 'win' : round.placed ? '' : 'lose'}`}>
                {round.placed} of {round.tiles.length} in place · +{fmtNumber(round.points)} pts
              </span>
              {round.placed < round.tiles.length && (
                <span className="small">Right order: {round.answer.map((id) => `${tiles.get(id)?.title} (${round.years?.[id]})`).join(' → ')}</span>
              )}
              {roundView < puzzle.current && puzzle.current < puzzle.rounds.length && (
                <button className="primary" onClick={() => setRoundView(puzzle.current)}>
                  Round {puzzle.current + 1}
                </button>
              )}
            </div>
          )
        )}
      </section>

      {error && <div className="error-box">{error}</div>}

      {puzzle.finished && (
        <FinishCard
          mode={puzzle.mode}
          score={puzzle.score}
          detail={`${puzzle.rounds.reduce((sum, r) => sum + r.placed, 0)} of ${puzzle.rounds.reduce((sum, r) => sum + r.tiles.length, 0)} titles in place`}
          share={timelineShareText(puzzle)}
          onNewUnlimited={onNewUnlimited}
          onError={setError}
        />
      )}
    </div>
  );
}
