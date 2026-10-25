import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { POOL_LABELS } from '../shared/catalog';
import { FIELD_POINTS } from '../shared/characters';
import { api, errorMessage, type CharacterState } from './api';
import { fmtDate } from './format';
import { GuessInput } from './GuessInput';
import { characterShareText, ShareButton } from './share';

type Slot = CharacterState['rounds'][number]['slots'][number];

/** MAL lists names family-first ("Elric, Edward"); show them the way people say them. */
const displayName = (name: string) => name.split(', ').reverse().join(' ');

function TriesLeft({ used, total, solved }: { used: number; total: number; solved: boolean }) {
  return (
    <span className="tries" aria-label={`${total - used} tries left`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`try${i < used ? (solved && i === used - 1 ? ' hit' : ' used') : ''}`} />
      ))}
    </span>
  );
}

function NameField({ slot, tries, disabled, onGuess }: { slot: Slot; tries: number; disabled: boolean; onGuess: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await onGuess(text);
      setText('');
    } catch {
      // The game shows the error; keep the text so it can be fixed.
    }
  };
  const { name } = slot;
  const misses = name.tries.filter((t, i) => t && !(name.solved && i === name.tries.length - 1));
  return (
    <div className={`char-field${name.solved ? ' ok' : name.finished ? ' bad' : ''}`}>
      <div className="char-field-head">
        <span className="field-label">Name</span>
        <TriesLeft used={name.tries.length} total={tries} solved={name.solved} />
      </div>
      {name.finished ? (
        <div className="char-result">{name.solved ? `✓ ${name.tries.at(-1)}` : '✗ Not guessed'}</div>
      ) : (
        <form className="char-name-form" onSubmit={submit}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Name or nickname" disabled={disabled} maxLength={80} />
          <button className="small" disabled={disabled || !text.trim()}>
            Guess
          </button>
        </form>
      )}
      {misses.length > 0 && (
        <div className="char-misses">
          {misses.map((t) => (
            <span key={t} className="chip miss">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AnimeField({ slot, tries, disabled, onGuess }: { slot: Slot; tries: number; disabled: boolean; onGuess: (malId: number) => void }) {
  const { anime } = slot;
  const exclude = useMemo(() => new Set(anime.tries.map((t) => t.malId)), [anime.tries]);
  const misses = anime.tries.filter((t, i) => t.malId > 0 && !(anime.solved && i === anime.tries.length - 1));
  return (
    <div className={`char-field${anime.solved ? ' ok' : anime.finished ? ' bad' : ''}`}>
      <div className="char-field-head">
        <span className="field-label">Anime</span>
        <TriesLeft used={anime.tries.length} total={tries} solved={anime.solved} />
      </div>
      {anime.finished ? (
        <div className="char-result">{anime.solved ? `✓ ${anime.tries.at(-1)?.title}` : '✗ Not guessed'}</div>
      ) : (
        <GuessInput compact exclude={exclude} disabled={disabled} onPick={onGuess} />
      )}
      {misses.length > 0 && (
        <div className="char-misses">
          {misses.map((t) => (
            <span key={t.malId} className="chip miss">
              {t.title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function CharacterGame({ puzzle, onChange, onNewUnlimited }: { puzzle: CharacterState; onChange: (p: CharacterState) => void; onNewUnlimited: () => Promise<void> }) {
  const [view, setView] = useState(Math.min(puzzle.current, puzzle.rounds.length - 1));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const round = puzzle.rounds[view]!;
  const isCurrent = view === puzzle.current;

  // Warm the cache for every portrait so later rounds show instantly.
  useEffect(() => {
    for (const r of puzzle.rounds) for (const s of r.slots) new Image().src = s.portrait;
  }, [puzzle.id]);

  /** Errors show in the banner and still reject, so the name field keeps what was typed. */
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
          <h1>Character</h1>
          <p className="muted small">
            Four characters from four different anime. Name each one (nicknames count) and pick their anime, {puzzle.tries} tries each. Name{' '}
            {FIELD_POINTS.name.join('/')} pts, anime {FIELD_POINTS.anime.join('/')} pts.
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
              <b>{r.finished ? r.points : i === puzzle.current ? '…' : '—'}</b>
            </button>
          ))}
        </div>
      </header>

      {error && <div className="error-box">{error}</div>}

      <div className="char-grid">
        {round.slots.map((slot, i) => (
          <article key={i} className={`card char-card${slot.answer ? ' done' : ''}`}>
            <img className="char-portrait" src={slot.portrait} alt="" />
            <div className="char-fields">
              {slot.answer && (
                <div className="char-answer">
                  <b>{displayName(slot.answer.name)}</b>
                  <a href={`https://myanimelist.net/anime/${slot.answer.anime.malId}`} target="_blank" rel="noreferrer">
                    {slot.answer.anime.title}
                  </a>
                  <span className="muted small">
                    {slot.name.points + slot.anime.points} pts · name {slot.name.solved ? '✓' : '✗'} · anime {slot.anime.solved ? '✓' : '✗'}
                  </span>
                </div>
              )}
              {!slot.answer && isCurrent && (
                <>
                  <NameField slot={slot} tries={puzzle.tries} disabled={sending} onGuess={(text) => send(() => api.characterName(puzzle.id, view, i, text))} />
                  <AnimeField slot={slot} tries={puzzle.tries} disabled={sending} onGuess={(malId) => quiet(send(() => api.characterAnime(puzzle.id, view, i, malId)))} />
                </>
              )}
            </div>
          </article>
        ))}
      </div>

      <div className="char-bar">
        <span className="muted">
          Round {view + 1}: {round.points} / 500 pts
        </span>
        <div className="actions">
          {isCurrent && !round.finished && (
            <button
              className="ghost danger"
              disabled={sending}
              onClick={() => confirm('Give up the rest of this round? Unanswered names and anime score 0.') && quiet(send(() => api.characterGiveUp(puzzle.id, view)))}
            >
              Give up round
            </button>
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
            <h2>{puzzle.score ?? 0} pts</h2>
            <p className="muted small">
              {perfect} of {puzzle.rounds.length * round.slots.length} characters fully right · max {puzzle.rounds.length * 500} pts
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
