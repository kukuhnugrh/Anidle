import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { POOL_LABELS } from '../shared/catalog';
import { MAX_ROUND_POINTS, MODE_LABELS, roundPoints } from '../shared/modes';
import { api, errorMessage, type RoundState } from './api';
import { fmtDate } from './format';
import { GuessInput } from './GuessInput';
import { SkipIcon } from './icons';
import { roundShareText, ShareButton } from './share';

type LoadStatus = 'loading' | 'ready' | 'error';

/** Gives up on a round whose frame has not decoded in this long (a screenshot is ~60 KB). */
const PRELOAD_TIMEOUT_MS = 20_000;

const zoomLabel = (stage: number) => (stage === 1 ? 'full' : `zoom ${stage}×`);

/**
 * Decodes every round's frame up front so a round never waits on the network. A round whose URL
 * changes (replaced after an error) loads again; the others keep what they have.
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

/** One frame shown at `zoom` (1 = whole frame) around a focus point derived from its URL, so it stays put. */
function ZoomShot({ url, zoom }: { url: string; zoom: number }) {
  const hash = [...url].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const x = 30 + (hash % 41);
  const y = 30 + ((hash >>> 8) % 41);
  return (
    <div className="shot">
      <img src={url} alt="" style={{ transform: `scale(${zoom})`, transformOrigin: `${x}% ${y}%` }} />
      <span className="shot-zoom">{zoom === 1 ? 'full' : `${zoom}×`}</span>
    </div>
  );
}

export function RoundGame({ puzzle, onChange, onNewUnlimited }: { puzzle: RoundState; onChange: (p: RoundState) => void; onNewUnlimited: () => Promise<void> }) {
  const urls = useMemo(() => puzzle.rounds.map((r) => r.media[0]!), [puzzle.rounds]);
  const { status, retry } = useFrames(urls);
  const [view, setView] = useState(Math.min(puzzle.current, puzzle.rounds.length - 1));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settled = status.filter((s) => s !== 'loading').length;
  const round = puzzle.rounds[view]!;
  const isCurrent = view === puzzle.current;
  const stages = puzzle.stages;
  const unlocked = round.finished ? stages.at(-1)! : stages[round.attempts.length]!;
  const next = stages[round.attempts.length + 1];
  const exclude = useMemo(() => new Set(round.attempts.flatMap((a) => (a ? [a.malId] : []))), [round.attempts]);

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

  if (settled < status.length && !puzzle.finished)
    return (
      <div className="center">
        <div className="preload">
          <span className="eyebrow">Preparing {MODE_LABELS[puzzle.mode]}</span>
          <div className="preload-bar">
            <span style={{ width: `${(settled / status.length) * 100}%` }} />
          </div>
          <span className="muted small">
            Loading round {settled}/{status.length}
          </span>
        </div>
      </div>
    );

  return (
    <div className="round-game">
      <header className="page-head game-head">
        <div>
          <span className="eyebrow">{puzzle.date ? `Daily · ${fmtDate(puzzle.date)}` : `Unlimited · ${POOL_LABELS[puzzle.pool]}`}</span>
          <h1>{MODE_LABELS[puzzle.mode]}</h1>
          <p className="muted small">Guess the anime from one scene of its opening. It starts zoomed in 4×; a wrong guess or a skip zooms out.</p>
        </div>
        <div className="round-tabs" role="tablist">
          {puzzle.rounds.map((r, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === view}
              className={`round-tab${i === view ? ' active' : ''}${r.finished ? (r.solved ? ' won' : ' lost') : ''}`}
              disabled={i > puzzle.current}
              onClick={() => setView(i)}
            >
              <span>Round {i + 1}</span>
              <b>{r.finished ? `${r.points}` : i === puzzle.current ? '…' : '—'}</b>
            </button>
          ))}
        </div>
      </header>

      {status[view] === 'error' ? (
        <div className="card load-error">
          <p>This round's image failed to load.</p>
          <div className="actions">
            <button onClick={() => retry(view)}>Try again</button>
            {puzzle.canReplace && !round.attempts.length && !round.finished && (
              <button className="primary" disabled={sending} onClick={() => send(() => api.replaceRound<RoundState>(puzzle.id, view))}>
                Replace with another title
              </button>
            )}
          </div>
        </div>
      ) : (
        <section className="card stage-card">
          <ZoomShot url={round.media[0]!} zoom={unlocked} />
          {!round.finished && isCurrent && (
            <div className="stage-controls">
              <GuessInput exclude={exclude} disabled={sending} onPick={(malId) => send(() => api.roundGuess(puzzle.id, view, malId))} />
              <div className="stage-actions">
                <span className="muted small">
                  Attempt {round.attempts.length + 1}/{stages.length} · correct now = {roundPoints(round.attempts.length, stages.length)} pts
                </span>
                <button className="ghost" disabled={sending} onClick={() => send(() => api.roundGuess(puzzle.id, view, null))}>
                  <SkipIcon />
                  {next === undefined ? 'Give up' : next === 1 ? 'Skip (full image)' : `Skip (zoom ${next}×)`}
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
            <div className="muted small">{round.solved ? `Solved on attempt ${round.attempts.length}` : 'The answer:'}</div>
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
              {view < puzzle.current && puzzle.current < puzzle.rounds.length && (
                <button className="primary" onClick={() => setView(puzzle.current)}>
                  Round {puzzle.current + 1}
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {round.attempts.length > 0 && (
        <ol className="attempts">
          {round.attempts.map((a, i) => {
            const correct = round.solved && i === round.attempts.length - 1;
            return (
              <li key={i} className={correct ? 'ok' : a ? 'bad' : 'skip'}>
                <span className="attempt-stage">{zoomLabel(stages[i]!)}</span>
                <span>{a ? a.title : 'Skipped'}</span>
                <span className="attempt-mark">{correct ? '✓' : a ? '✗' : '→'}</span>
              </li>
            );
          })}
        </ol>
      )}

      {puzzle.finished && (
        <section className="card final">
          <div>
            <span className="eyebrow">Finished</span>
            <h2>{puzzle.score ?? 0} pts</h2>
            <p className="muted small">
              {puzzle.rounds.filter((r) => r.solved).length} of {puzzle.rounds.length} rounds correct · max {MAX_ROUND_POINTS * puzzle.rounds.length} pts
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
