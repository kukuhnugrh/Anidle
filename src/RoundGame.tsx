import { useCallback, useEffect, useRef, useState } from 'react';
import { POOL_LABELS } from '../shared/catalog';
import { MODE_LABELS, SCREENSHOT_CLUES } from '../shared/modes';
import { api, errorMessage, type RoundState } from './api';
import { fmtDate } from './format';
import { GuessInput } from './GuessInput';
import { LockIcon, UnlockIcon } from './icons';
import { roundShareText, ShareButton } from './share';

type LoadStatus = 'loading' | 'ready' | 'error';
type Round = RoundState['rounds'][number];

/** Gives up on a round whose first screenshot has not decoded in this long (a screenshot is ~60 KB). */
const PRELOAD_TIMEOUT_MS = 20_000;

/** Tab labels: the screenshot shown first, then one per clue (SCREENSHOT_CLUES order). */
const VIEW_LABELS = ['Original screenshot', 'First clue', 'Second clue', 'Title clue'];
const UNLOCK_LABELS = ['', 'Unlock first clue', 'Unlock second clue', 'Unlock title clue'];

/**
 * Decodes every round's first screenshot up front so a round never waits on the network. A round
 * whose URL changes (replaced after an error) loads again; the others keep what they have.
 */
function useFrames(urls: string[]) {
  const loaded = useRef<string[]>([]);
  const [status, setStatus] = useState<LoadStatus[]>(() => urls.map(() => 'loading'));

  const load = useCallback((i: number, url: string) => {
    loaded.current[i] = url;
    setStatus((s) => s.with(i, 'loading'));
    const settle = (result: LoadStatus) => {
      clearTimeout(timer);
      if (loaded.current[i] === url) setStatus((s) => s.with(i, result));
    };
    const timer = setTimeout(() => settle('error'), PRELOAD_TIMEOUT_MS);
    const img = new Image();
    img.src = url;
    img.decode().then(
      () => settle('ready'),
      () => settle('error'),
    );
  }, []);

  // `key` is the content of `urls`, so the effect runs when a URL changes, not on every new array.
  const key = urls.join('|');
  useEffect(() => {
    urls.forEach((url, i) => {
      if (loaded.current[i] !== url) load(i, url);
    });
  }, [key, load]);

  return { status, retry: (i: number) => load(i, urls[i]!) };
}

/** What a view shows: a screenshot, or the masked title in the same frame. */
function ClueFrame({ round, view }: { round: Round; view: number }) {
  if (SCREENSHOT_CLUES[view - 1] === 'title' && round.hint)
    return (
      <div className="shot title-hint">
        <span className="field-label">Title clue</span>
        <code>{round.hint.title}</code>
        {round.hint.english && <code className="muted">{round.hint.english}</code>}
      </div>
    );
  const shot = round.media[Math.min(view, round.media.length - 1)]!;
  return (
    <div className="shot">
      <img src={shot} alt="" />
    </div>
  );
}

export function RoundGame({ puzzle, onChange, onNewUnlimited }: { puzzle: RoundState; onChange: (p: RoundState) => void; onNewUnlimited: () => Promise<void> }) {
  const { status, retry } = useFrames(puzzle.rounds.map((r) => r.media[0]!));
  const [roundView, setRoundView] = useState(Math.min(puzzle.current, puzzle.rounds.length - 1));
  const round = puzzle.rounds[roundView]!;
  // The frame on screen: 0 = original screenshot, n = clue n. Follows the newest clue when one opens.
  const [clueView, setClueView] = useState(round.clues);
  useEffect(() => setClueView(round.clues), [roundView, round.clues]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCurrent = roundView === puzzle.current;
  const playing = isCurrent && !round.finished;
  const opened = round.finished ? SCREENSHOT_CLUES.length : round.clues;
  const worth = puzzle.points.max - puzzle.points.perClue * round.clues;

  const send = async (task: () => Promise<RoundState>) => {
    setSending(true);
    setError(null);
    try {
      onChange(await task());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="round-game">
      <header className="page-head game-head">
        <div>
          <span className="eyebrow">{puzzle.date ? `Daily · ${fmtDate(puzzle.date)}` : `Unlimited · ${POOL_LABELS[puzzle.pool]}`}</span>
          <h1>{MODE_LABELS[puzzle.mode]}</h1>
          <p className="muted small">
            Guess the anime from a screenshot of its opening. One guess per round: {puzzle.points.max} pts, minus {puzzle.points.perClue} for every clue you unlock (two more
            screenshots, then the title's initials).
          </p>
        </div>
        <div className="round-tabs" role="tablist">
          {puzzle.rounds.map((r, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === roundView}
              className={`round-tab${i === roundView ? ' active' : ''}${r.finished ? (r.solved ? ' won' : ' lost') : ''}`}
              disabled={i > puzzle.current}
              onClick={() => setRoundView(i)}
            >
              <span>Round {i + 1}</span>
              <b>{r.finished ? `${r.points}` : i === puzzle.current ? '…' : '—'}</b>
            </button>
          ))}
        </div>
      </header>

      <div className="round-title">
        <h2>Round {roundView + 1}</h2>
        <span className={`difficulty ${round.difficulty}`}>{round.difficulty}</span>
      </div>

      {status[roundView] === 'error' ? (
        <div className="card load-error">
          <p>This round's image failed to load.</p>
          <div className="actions">
            <button onClick={() => retry(roundView)}>Try again</button>
            {puzzle.canReplace && !round.clues && !round.finished && (
              <button className="primary" disabled={sending} onClick={() => send(() => api.replaceRound<RoundState>(puzzle.id, roundView))}>
                Replace with another title
              </button>
            )}
          </div>
        </div>
      ) : status[roundView] === 'loading' ? (
        <section className="card stage-card">
          <div className="shot loading-shot muted small">Loading screenshot…</div>
        </section>
      ) : (
        <section className="card stage-card">
          <ClueFrame round={round} view={Math.min(clueView, opened)} />
          <div className="clue-tabs">
            {VIEW_LABELS.map((label, i) => {
              if (i <= opened)
                return (
                  <button key={i} className={`clue-tab${i === clueView ? ' active' : ''}`} onClick={() => setClueView(i)}>
                    <UnlockIcon />
                    {label}
                  </button>
                );
              const next = playing && i === opened + 1;
              return (
                <button
                  key={i}
                  className="clue-tab locked"
                  disabled={!next || sending}
                  title={next ? `−${puzzle.points.perClue} pts` : 'Unlock the previous clue first'}
                  onClick={() => send(() => api.roundClue<RoundState>(puzzle.id, roundView))}
                >
                  <LockIcon />
                  {UNLOCK_LABELS[i]}
                </button>
              );
            })}
          </div>
          {playing && (
            <div className="stage-controls">
              <GuessInput disabled={sending} onPick={(malId) => send(() => api.roundGuess<RoundState>(puzzle.id, roundView, malId))} />
              <div className="stage-actions">
                <span className="muted small">One guess · right now = {worth} pts</span>
                <button className="ghost danger" disabled={sending} onClick={() => confirm('Give up this round? It scores 0.') && send(() => api.roundGiveUp<RoundState>(puzzle.id, roundView))}>
                  Give up
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {error && <div className="error-box">{error}</div>}

      {round.answer && (
        <section className={`result ${round.solved ? 'win' : 'lose'}`}>
          {round.answer.cover && <img src={round.answer.cover} alt="" />}
          <div>
            <div className="muted small">
              {round.solved
                ? round.clues
                  ? `Right, with ${round.clues} clue${round.clues > 1 ? 's' : ''}`
                  : 'Right, no clue needed!'
                : round.gaveUp
                  ? 'You gave up. The answer:'
                  : `Not ${round.guess?.title}. The answer:`}
            </div>
            <h3>{round.answer.title}</h3>
            <div className="muted answer-meta">
              {round.answer.year ?? ''}
              <span className={`difficulty ${round.answer.difficulty}`}>{round.answer.difficulty}</span>
            </div>
            <div className="score">{round.points} pts</div>
            <div className="actions">
              <a className="button" href={`https://myanimelist.net/anime/${round.answer.malId}`} target="_blank" rel="noreferrer">
                Open on MAL ↗
              </a>
              {roundView < puzzle.current && puzzle.current < puzzle.rounds.length && (
                <button className="primary" onClick={() => setRoundView(puzzle.current)}>
                  Round {puzzle.current + 1}
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {puzzle.finished && (
        <section className="card final">
          <div>
            <span className="eyebrow">Finished</span>
            <h2>{puzzle.score ?? 0} pts</h2>
            <p className="muted small">
              {puzzle.rounds.filter((r) => r.solved).length} of {puzzle.rounds.length} rounds correct · max {puzzle.points.max * puzzle.rounds.length} pts
            </p>
          </div>
          <div className="actions">
            <ShareButton text={roundShareText(puzzle)} />
            <button className="primary" onClick={() => onNewUnlimited().catch((err: unknown) => setError(errorMessage(err)))}>
              Play {MODE_LABELS[puzzle.mode]} unlimited
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
