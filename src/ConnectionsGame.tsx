import { useState } from 'react';
import { CONNECTIONS_GROUP_SIZE, LINK_KIND_LABELS } from '../shared/connections';
import { api, errorMessage, type ConnectionsState } from './api';
import { FinishCard, GameHeader, TitleThumb } from './GameParts';
import { connectionsShareText } from './share';

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
    <div className="connections-game big-game">
      <GameHeader
        puzzle={puzzle}
        intro={`Sort the board into groups of ${CONNECTIONS_GROUP_SIZE} anime that share something. Links in play: ${puzzle.links.map((k) => LINK_KIND_LABELS[k]).join(' · ')}.`}
        aside={
          <div className="cx-mistakes" aria-label={`${left} mistakes left`}>
            <span className="muted small">Mistakes left</span>
            <span className="cx-dots">
              {Array.from({ length: puzzle.maxMistakes }, (_, i) => (
                <span key={i} className={`cx-dot${i < left ? ' on' : ''}`} />
              ))}
            </span>
          </div>
        }
      />

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
                  <TitleThumb title={t} />
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
        <FinishCard
          mode={puzzle.mode}
          eyebrow={puzzle.solved ? 'Solved' : 'Out of mistakes'}
          score={puzzle.score}
          detail={`${puzzle.groups.filter((g) => g.found).length} of ${puzzle.groups.length} groups · ${puzzle.mistakes} ${puzzle.mistakes === 1 ? 'mistake' : 'mistakes'}`}
          share={connectionsShareText(puzzle)}
          onNewUnlimited={onNewUnlimited}
          onError={setError}
        />
      )}
    </div>
  );
}
