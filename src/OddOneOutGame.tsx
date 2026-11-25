import { useRef, useState } from 'react';
import { LINK_KIND_LABELS } from '../shared/connections';
import { ODD_ONE_OUT_POINTS } from '../shared/oddoneout';
import { api, errorMessage, type OddOneOutState } from './api';
import { fmtNumber } from './format';
import { FinishCard, GameHeader, TitleThumb } from './GameParts';
import { landDone } from './sakuga';
import { oddOneOutShareText } from './share';

export function OddOneOutGame({ puzzle, onChange, onNewUnlimited }: { puzzle: OddOneOutState; onChange: (p: OddOneOutState) => void; onNewUnlimited: () => Promise<void> }) {
  const [roundView, setRoundView] = useState(Math.min(puzzle.current, puzzle.rounds.length - 1));
  const [selected, setSelected] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitButton = useRef<SakugaButtonElement>(null);
  const round = puzzle.rounds[roundView]!;
  const playing = roundView === puzzle.current && !round.finished;

  const submit = async () => {
    if (selected === null) return;
    setSending(true);
    setError(null);
    try {
      const next = await api.oddOneOutPick(puzzle.id, roundView, selected);
      onChange(next);
      if (next.rounds[roundView]?.solved) landDone(submitButton.current);
      setSelected(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  const tileState = (malId: number) => {
    if (!round.finished) return selected === malId ? ' selected' : '';
    if (malId === round.odd) return ' odd';
    return malId === round.pick ? ' wrong' : ' shared';
  };

  return (
    <div className="round-game big-game">
      <GameHeader
        puzzle={puzzle}
        intro={`All but one of these anime share something. Pick the one that doesn't. Links in play: ${puzzle.links.map((k) => LINK_KIND_LABELS[k]).join(' · ')}. ${fmtNumber(ODD_ONE_OUT_POINTS)} pts per round.`}
        aside={
          <div className="round-tabs" role="tablist">
            {puzzle.rounds.map((r, i) => (
              <button
                key={i}
                role="tab"
                aria-selected={i === roundView}
                className={`round-tab compact${i === roundView ? ' active' : ''}${r.finished ? (r.solved ? ' won' : ' lost') : ''}`}
                disabled={i > puzzle.current}
                onClick={() => setRoundView(i)}
              >
                <span>{i + 1}</span>
                <b>{r.finished ? (r.solved ? '✓' : '✗') : i === puzzle.current ? '…' : '—'}</b>
              </button>
            ))}
          </div>
        }
      />

      <section className="card cx-card">
        <div className="odd-board">
          {round.tiles.map((t) => (
            <button
              key={t.malId}
              type="button"
              className={`cx-tile${tileState(t.malId)}`}
              aria-pressed={selected === t.malId}
              disabled={!playing || sending}
              onClick={() => setSelected(t.malId)}
              title={t.titleEn ? `${t.title} (${t.titleEn})` : t.title}
            >
              <TitleThumb title={t} />
            </button>
          ))}
        </div>
        {playing ? (
          <div className="cx-controls">
            <span className="cx-note">{selected === null ? 'Pick the odd one out.' : 'One pick per round.'}</span>
            <sakuga-button ref={submitButton} disabled={sending || selected === null} onClick={(e) => !e.currentTarget.disabled && void submit()}>
              {sending ? 'Checking…' : "That's the odd one"}
            </sakuga-button>
          </div>
        ) : (
          <div className="odd-verdict">
            <span className={`hl-verdict ${round.solved ? 'win' : 'lose'}`}>{round.solved ? `Right! +${fmtNumber(round.points)} pts` : 'Not that one.'}</span>
            <span>
              The others share <b>{round.label}</b>.
            </span>
            {roundView < puzzle.current && puzzle.current < puzzle.rounds.length && (
              <button className="primary" onClick={() => setRoundView(puzzle.current)}>
                Round {puzzle.current + 1}
              </button>
            )}
          </div>
        )}
      </section>

      {error && <div className="error-box">{error}</div>}

      {puzzle.finished && (
        <FinishCard
          mode={puzzle.mode}
          score={puzzle.score}
          detail={`${puzzle.rounds.filter((r) => r.solved).length} of ${puzzle.rounds.length} rounds right`}
          share={oddOneOutShareText(puzzle)}
          onNewUnlimited={onNewUnlimited}
          onError={setError}
        />
      )}
    </div>
  );
}
