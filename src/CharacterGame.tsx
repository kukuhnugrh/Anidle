import { useEffect, useState, type ReactNode } from 'react';
import { POOL_LABELS } from '../shared/catalog';
import { MODE_MAX_POINTS } from '../shared/modes';
import { api, errorMessage, type CharacterPick, type CharacterState } from './api';
import { CharacterSummary } from './AnswerSummary';
import { ConfirmButton } from './ConfirmButton';
import { fmtDate, fmtNumber } from './format';
import { RoundTabs, type RoundMark } from './GameParts';
import { CharacterInput, GuessInput } from './GuessInput';
import { HowToPlay } from './HowToPlay';
import { RoundTitle } from './RoundTitle';
import { characterShareText, ShareButton } from './share';

type Slot = CharacterState['rounds'][number]['slots'][number];
type Field = Slot['name'] | Slot['anime'];

/** A guessed round's tab: ✓ when every name and anime was right, ✗ when none was, no mark for a part-right round. */
export function characterRoundMark(round: { finished: boolean; slots: ReadonlyArray<{ name: { solved: boolean }; anime: { solved: boolean } }> }): RoundMark {
  if (!round.finished) return null;
  const right = round.slots.flatMap((s) => [s.name.solved, s.anime.solved]);
  return right.every(Boolean) ? 'won' : right.some(Boolean) ? null : 'lost';
}

/** An open field: its label and picker (a round's fields are all answered by its one Guess). */
function PickField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="char-field">
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

/** A field after the Guess: the right answer, green or red, what was picked when it differs, and what else counts. */
function ResultRow({ label, field, answer, also, picked, samePick }: { label: string; field: Field; answer: ReactNode; also: ReactNode[]; picked: string | undefined; samePick: boolean }) {
  return (
    <div className={`char-field ${field.solved ? 'ok' : 'bad'}`}>
      <div className="char-field-head">
        <span className="field-label">{label}</span>
        <span className="char-mark">{field.solved ? `✓ +${fmtNumber(field.points)}` : '✗ 0'}</span>
      </div>
      <div className="char-result">{answer}</div>
      {also.length > 0 && (
        <span className="char-also small">
          Also accepted:{' '}
          {also.map((a, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              {a}
            </span>
          ))}
        </span>
      )}
      {!picked && <span className="char-pick muted small">Not answered</span>}
      {picked && !samePick && (
        <span className="char-pick small">
          Your pick: <span className={field.solved ? '' : 'wrong'}>{picked}</span>
          {field.solved && ' (also right)'}
        </span>
      )}
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
  const empty = round.slots.length * 2 - pending.length;
  const guess = () => quiet(send(() => api.characterGuess(puzzle.id, view, pending)).then(() => setPicks({})));

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

  return (
    <div className="character-game">
      <header className="page-head game-head">
        <div>
          <span className="eyebrow">{puzzle.date ? `Daily · ${fmtDate(puzzle.date)}` : `Unlimited · ${POOL_LABELS[puzzle.pool]}`}</span>
          <div className="title-row">
            <h1>Character</h1>
            <HowToPlay mode="character" />
          </div>
          <p className="muted small">
            Four characters from four different anime, easy, medium, then hard by how well known the character is. Pick each one's name and their anime, then press Guess:
            one Guess per round, an empty field counts as wrong. Each right field is worth {fmtNumber(round.fieldPoints)} pts this round.
          </p>
        </div>
        <RoundTabs marks={puzzle.rounds.map(characterRoundMark)} current={puzzle.current} view={view} onView={setView} />
      </header>

      <RoundTitle round={view} difficulties={round.difficulties} />

      {error && <div className="error-box">{error}</div>}
      {zoomed && <Lightbox src={zoomed} onClose={() => setZoomed(null)} />}

      <div className="char-grid">
        {round.slots.map((slot, i) => (
          <article key={i} className={`card char-card${slot.answer ? (slot.name.solved && slot.anime.solved ? ' all-ok' : slot.name.solved || slot.anime.solved ? ' half-ok' : ' none-ok') : ''}`}>
            <button className="char-portrait-button" onClick={() => setZoomed(slot.portrait)} aria-label="Enlarge portrait" title="Click to enlarge">
              <img className="char-portrait" src={slot.portrait} alt="" />
            </button>
            <div className="char-fields">
              {slot.answer && (
                <>
                  <ResultRow label="Name" field={slot.name} answer={slot.answer.name} also={slot.answer.aliases} picked={slot.name.pick?.name} samePick={slot.name.solved} />
                  <ResultRow
                    label="Anime"
                    field={slot.anime}
                    answer={
                      <a href={`https://myanimelist.net/anime/${slot.answer.anime.malId}`} target="_blank" rel="noreferrer">
                        {slot.answer.anime.title}
                      </a>
                    }
                    also={slot.answer.otherShows.map((show) => (
                      <a key={show.malId} href={`https://myanimelist.net/anime/${show.malId}`} target="_blank" rel="noreferrer">
                        {show.title}
                      </a>
                    ))}
                    picked={slot.anime.pick?.title}
                    samePick={slot.anime.pick?.malId === slot.answer.anime.malId}
                  />
                </>
              )}
              {!slot.answer && isCurrent && (
                <>
                  <PickField label="Name">
                    <CharacterInput disabled={sending} onChoose={choose(i, 'name')} />
                  </PickField>
                  <PickField label="Anime">
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
          Round {view + 1}: {fmtNumber(round.points)} / {fmtNumber(round.max)} pts
        </span>
        <div className="actions">
          {isCurrent && !round.finished && (
            <ConfirmButton
              className="primary"
              disabled={sending}
              ask={empty > 0}
              title="Guess with empty fields?"
              message={`${empty} field${empty === 1 ? ' is' : 's are'} still empty and will count as wrong. This round can't be guessed again.`}
              confirmLabel="Guess anyway"
              onConfirm={guess}
            >
              Guess ({pending.length}/{round.slots.length * 2})
            </ConfirmButton>
          )}
          {round.finished && view < puzzle.current && puzzle.current < puzzle.rounds.length && (
            <sakuga-button onClick={() => setView(puzzle.current)}>Round {puzzle.current + 1}</sakuga-button>
          )}
        </div>
      </div>

      {puzzle.finished && (
        <section className="card final">
          <div>
            <span className="eyebrow">Finished</span>
            <h2>{fmtNumber(puzzle.score ?? 0)} pts</h2>
            <p className="muted small">
              {perfect} of {puzzle.rounds.length * round.slots.length} characters fully right · max {fmtNumber(MODE_MAX_POINTS.character)} pts
            </p>
          </div>
          <div className="actions">
            <ShareButton text={characterShareText(puzzle)} />
            <sakuga-button onClick={() => onNewUnlimited().catch((err: unknown) => setError(errorMessage(err)))}>Play Character unlimited</sakuga-button>
            <a className="button ghost" href="/">
              Home
            </a>
          </div>
        </section>
      )}

      {puzzle.finished && <CharacterSummary puzzle={puzzle} />}
    </div>
  );
}
