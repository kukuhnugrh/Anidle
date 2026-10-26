import { useEffect, useState, type ReactNode } from 'react';
import { POOL_LABELS } from '../shared/catalog';
import { CHARACTER_FIELD_POINTS } from '../shared/characters';
import { MAX_ROUND_POINTS } from '../shared/modes';
import { api, errorMessage, type CharacterPick, type CharacterState } from './api';
import { fmtDate } from './format';
import { CharacterInput, GuessInput } from './GuessInput';
import { RoundTitle } from './RoundTitle';
import { characterShareText, ShareButton } from './share';

type Slot = CharacterState['rounds'][number]['slots'][number];
type Field = Slot['name'] | Slot['anime'];

/** One pick per field: the picker while open, then ✓/✗ with what was picked. */
function PickField({ label, field, shown, children }: { label: string; field: Field; shown: string | undefined; children: ReactNode }) {
  return (
    <div className={`char-field${field.solved ? ' ok' : field.finished ? ' bad' : ''}`}>
      <div className="char-field-head">
        <span className="field-label">{label}</span>
      </div>
      {field.finished ? <div className="char-result">{field.solved ? `✓ ${shown}` : shown ? `✗ ${shown}` : '✗ Not guessed'}</div> : children}
    </div>
  );
}

/** A portrait shown large over the page; a click anywhere or Escape closes it. */
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" onClick={onClose}>
      <img src={src} alt="" />
    </div>
  );
}

export function CharacterGame({ puzzle, onChange, onNewUnlimited }: { puzzle: CharacterState; onChange: (p: CharacterState) => void; onNewUnlimited: () => Promise<void> }) {
  const [view, setView] = useState(Math.min(puzzle.current, puzzle.rounds.length - 1));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState<string | null>(null);
  const round = puzzle.rounds[view]!;
  const isCurrent = view === puzzle.current;
  // Names and anime chosen in this round, not sent yet: one Guess sends them all. Key `${slot}:${field}`.
  const [picks, setPicks] = useState<Record<string, CharacterPick>>({});
  useEffect(() => setPicks({}), [view, puzzle.id]);
  const choose = (slot: number, field: CharacterPick['field']) => (id: number | null) =>
    setPicks(({ [`${slot}:${field}`]: _old, ...rest }) => (id == null ? rest : { ...rest, [`${slot}:${field}`]: { slot, field, id } }));
  const pending = Object.values(picks);

  // Warm the cache for every portrait so later rounds show instantly.
  useEffect(() => {
    for (const r of puzzle.rounds) for (const s of r.slots) new Image().src = s.portrait;
  }, [puzzle.id]);

  /** Errors show in the banner; the promise still rejects for callers that care (pickers use `quiet`). */
  const send = async (task: () => Promise<CharacterState>) => {
    setSending(true);
    setError(null);
    try {
      onChange(await task());
    } catch (err) {
      setError(errorMessage(err));
      throw err;
    } finally {
      setSending(false);
    }
  };
  const quiet = (p: Promise<void>) => void p.catch(() => {});
  const perfect = puzzle.rounds.flatMap((r) => r.slots).filter((s) => s.name.solved && s.anime.solved).length;
  const fmtPoints = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  return (
    <div className="character-game">
      <header className="page-head game-head">
        <div>
          <span className="eyebrow">{puzzle.date ? `Daily · ${fmtDate(puzzle.date)}` : `Unlimited · ${POOL_LABELS[puzzle.pool]}`}</span>
          <h1>Character</h1>
          <p className="muted small">
            Four characters from four different anime. Pick each one's name and their anime, then press Guess (fields you leave empty stay open) — one pick per field,{' '}
            {CHARACTER_FIELD_POINTS} pts each.
          </p>
        </div>
        <div className="round-tabs" role="tablist">
          {puzzle.rounds.map((r, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === view}
              className={`round-tab${i === view ? ' active' : ''}${r.finished ? ' won' : ''}`}
              disabled={i > puzzle.current}
              onClick={() => setView(i)}
            >
              <span>Round {i + 1}</span>
              <b>{r.finished ? fmtPoints(r.points) : i === puzzle.current ? '…' : '—'}</b>
            </button>
          ))}
        </div>
      </header>

      <RoundTitle round={view} difficulties={round.difficulties} />

      {error && <div className="error-box">{error}</div>}
      {zoomed && <Lightbox src={zoomed} onClose={() => setZoomed(null)} />}

      <div className="char-grid">
        {round.slots.map((slot, i) => (
          <article key={i} className={`card char-card${slot.answer ? ' done' : ''}`}>
            <button className="char-portrait-button" onClick={() => setZoomed(slot.portrait)} aria-label="Enlarge portrait" title="Click to enlarge">
              <img className="char-portrait" src={slot.portrait} alt="" />
            </button>
            <div className="char-fields">
              {slot.answer && (
                <div className="char-answer">
                  <b>{slot.answer.name}</b>
                  <a href={`https://myanimelist.net/anime/${slot.answer.anime.malId}`} target="_blank" rel="noreferrer">
                    {slot.answer.anime.title}
                  </a>
                  <span className="muted small">
                    {fmtPoints(slot.name.points + slot.anime.points)} pts · name {slot.name.solved ? '✓' : '✗'} · anime {slot.anime.solved ? '✓' : '✗'}
                  </span>
                </div>
              )}
              {!slot.answer && isCurrent && (
                <>
                  <PickField label="Name" field={slot.name} shown={slot.name.pick?.name}>
                    <CharacterInput disabled={sending} onChoose={choose(i, 'name')} />
                  </PickField>
                  <PickField label="Anime" field={slot.anime} shown={slot.anime.pick?.title}>
                    <GuessInput compact disabled={sending} onChoose={choose(i, 'anime')} />
                  </PickField>
                </>
              )}
            </div>
          </article>
        ))}
      </div>

      <div className="char-bar">
        <span className="muted">
          Round {view + 1}: {fmtPoints(round.points)} / {MAX_ROUND_POINTS} pts
        </span>
        <div className="actions">
          {isCurrent && !round.finished && (
            <>
              <button
                className="ghost danger"
                disabled={sending}
                onClick={() => confirm('Give up the rest of this round? Unanswered names and anime score 0.') && quiet(send(() => api.characterGiveUp(puzzle.id, view)))}
              >
                Give up round
              </button>
              <button className="primary" disabled={sending || !pending.length} onClick={() => quiet(send(() => api.characterGuess(puzzle.id, view, pending)).then(() => setPicks({})))}>
                Guess{pending.length ? ` (${pending.length})` : ''}
              </button>
            </>
          )}
          {round.finished && view < puzzle.current && puzzle.current < puzzle.rounds.length && (
            <button className="primary" onClick={() => setView(puzzle.current)}>
              Round {puzzle.current + 1}
            </button>
          )}
        </div>
      </div>

      {puzzle.finished && (
        <section className="card final">
          <div>
            <span className="eyebrow">Finished</span>
            <h2>{fmtPoints(puzzle.score ?? 0)} pts</h2>
            <p className="muted small">
              {perfect} of {puzzle.rounds.length * round.slots.length} characters fully right · max {puzzle.rounds.length * MAX_ROUND_POINTS} pts
            </p>
          </div>
          <div className="actions">
            <ShareButton text={characterShareText(puzzle)} />
            <button className="primary" onClick={() => onNewUnlimited().catch((err: unknown) => setError(errorMessage(err)))}>
              Play Character unlimited
            </button>
            <a className="button ghost" href="#/">
              Home
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
