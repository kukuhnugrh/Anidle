import { useCallback, useEffect, useRef, useState } from 'react';
import { POOL_LABELS } from '../shared/catalog';
import { MODE_LABELS, MODE_MAX_POINTS, roundMaxPoints, SCREENSHOT_CLUE_COST, SCREENSHOT_CLUES } from '../shared/modes';
import { api, errorMessage, type RoundState } from './api';
import { RoundsSummary } from './AnswerSummary';
import { ConfirmButton } from './ConfirmButton';
import { fmtDate, fmtNumber } from './format';
import { GuessInput } from './GuessInput';
import { HowToPlay } from './HowToPlay';
import { LockIcon, UnlockIcon } from './icons';
import { RoundTitle } from './RoundTitle';
import { roundShareText, ShareButton } from './share';

type LoadStatus = 'loading' | 'ready' | 'error';

/** Gives up on a round whose first screenshot has not decoded in this long (a screenshot is ~60 KB). */
const PRELOAD_TIMEOUT_MS = 20_000;

/** Screenshot tabs: the original, then the screenshot clues (SCREENSHOT_CLUES order); the title clue is shown below them. */
const SHOT_LABELS = ['Original screenshot', 'First clue', 'Second clue'];
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

/** The masked title (Guess the Anime keeps it under the screenshots so every screenshot stays one click away; Synopsis under the text). */
export function TitleHint({ hint }: { hint: { title: string; english: string | null } }) {
  return (
    <div className="title-hint">
      <span className="field-label">Title clue</span>
      <code>{hint.title}</code>
      {hint.english && <code className="muted">{hint.english}</code>}
    </div>
  );
}

export function RoundGame({ puzzle, onChange, onNewUnlimited }: { puzzle: RoundState; onChange: (p: RoundState) => void; onNewUnlimited: () => Promise<void> }) {
  const { status, retry } = useFrames(puzzle.rounds.map((r) => r.media[0]!));
  const [roundView, setRoundView] = useState(Math.min(puzzle.current, puzzle.rounds.length - 1));
  const round = puzzle.rounds[roundView]!;
  // The screenshot on screen: 0 = original, n = screenshot clue n. Follows the newest screenshot when one opens.
  const lastShot = round.media.length - 1;
  const [shotView, setShotView] = useState(lastShot);
  useEffect(() => setShotView(lastShot), [roundView, lastShot]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCurrent = roundView === puzzle.current;
  const playing = isCurrent && !round.finished;
  const opened = round.finished ? SCREENSHOT_CLUES.length : round.clues;
  const perClue = round.max * SCREENSHOT_CLUE_COST;
  const worth = round.max - perClue * round.clues;

  /** `beforeShow` may hold the new state back a moment (a right guess's check landing on the Guess button). */
  const send = async (task: () => Promise<RoundState>, beforeShow?: (next: RoundState) => Promise<void> | undefined) => {
    setSending(true);
    setError(null);
    try {
      const next = await task();
      await beforeShow?.(next);
      onChange(next);
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
          <div className="title-row">
            <h1>{MODE_LABELS[puzzle.mode]}</h1>
            <HowToPlay mode={puzzle.mode} />
          </div>
          <p className="muted small">
            Guess the anime from a screenshot of its opening or ending. One guess per round ({fmtNumber(roundMaxPoints(puzzle.mode))} pts); every clue you unlock (two more
            screenshots, then the title's initials) takes {fmtNumber(roundMaxPoints(puzzle.mode) * SCREENSHOT_CLUE_COST)} off.
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
              <b>{r.finished ? fmtNumber(r.points) : i === puzzle.current ? '…' : '—'}</b>
            </button>
          ))}
        </div>
      </header>

      <RoundTitle round={roundView} difficulties={[round.difficulty]} />

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
          <div className="shot">
            <img src={round.media[Math.min(shotView, lastShot)]} alt="" />
          </div>
          <div className="clue-tabs">
            {/* 0 = original screenshot, i = clue i; an opened title clue shows below instead of as a tab. */}
            {UNLOCK_LABELS.map((_, i) => {
                if (i <= opened) {
                  if (SCREENSHOT_CLUES[i - 1] === 'title') return null;
                  return (
                    <button key={i} className={`clue-tab${i === shotView ? ' active' : ''}`} onClick={() => setShotView(i)}>
                      <UnlockIcon />
                      {SHOT_LABELS[i]}
                    </button>
                  );
                }
                const next = playing && i === opened + 1;
                return (
                  <button
                    key={i}
                    className="clue-tab locked"
                    disabled={!next || sending}
                    title={next ? `−${fmtNumber(perClue)} pts` : 'Unlock the previous clue first'}
                    onClick={() => send(() => api.roundClue<RoundState>(puzzle.id, roundView))}
                  >
                    <LockIcon />
                    {UNLOCK_LABELS[i]}
                  </button>
                );
            })}
          </div>
          {round.hint && <TitleHint hint={round.hint} />}
          {playing && (
            <div className="stage-controls">
              <GuessInput
                fullNamesOnly
                disabled={sending}
                onPick={(malId, land) => void send(() => api.roundGuess<RoundState>(puzzle.id, roundView, malId), (p) => (p.rounds[roundView]?.solved ? land() : undefined))}
              />
              <div className="stage-actions">
                <span className="muted small">One guess · right now = {fmtNumber(worth)} pts</span>
                <ConfirmButton
                  className="ghost danger"
                  disabled={sending}
                  danger
                  title="Give up this round?"
                  message="The answer is shown and the round scores 0."
                  confirmLabel="Give up"
                  onConfirm={() => send(() => api.roundGiveUp<RoundState>(puzzle.id, roundView))}
                >
                  Give up
                </ConfirmButton>
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
            {round.answer.titleEn && <div className="answer-en">{round.answer.titleEn}</div>}
            <div className="muted answer-meta">
              {round.answer.year ?? ''}
              <span className={`difficulty ${round.answer.difficulty}`}>{round.answer.difficulty}</span>
            </div>
            <div className="score">{fmtNumber(round.points)} pts</div>
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
            <h2>{fmtNumber(puzzle.score ?? 0)} pts</h2>
            <p className="muted small">
              {puzzle.rounds.filter((r) => r.solved).length} of {puzzle.rounds.length} rounds correct · max {fmtNumber(MODE_MAX_POINTS[puzzle.mode])} pts
            </p>
          </div>
          <div className="actions">
            <ShareButton text={roundShareText(puzzle)} />
            <sakuga-button onClick={() => onNewUnlimited().catch((err: unknown) => setError(errorMessage(err)))}>Play {MODE_LABELS[puzzle.mode]} unlimited</sakuga-button>
            <a className="button ghost" href="/">
              Home
            </a>
          </div>
        </section>
      )}

      {puzzle.finished && (
        <RoundsSummary
          rounds={puzzle.rounds.flatMap((r) =>
            r.answer
              ? [{ answer: r.answer, detail: null, guess: r.guess, solved: r.solved, gaveUp: r.gaveUp, clueNote: r.clues ? `with ${r.clues} clue${r.clues > 1 ? 's' : ''}` : null, points: r.points, max: r.max }]
              : [],
          )}
        />
      )}
    </div>
  );
}
