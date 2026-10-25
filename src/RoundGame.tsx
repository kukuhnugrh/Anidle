import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { POOL_LABELS } from '../shared/catalog';
import { MAX_ROUND_POINTS, MODE_LABELS, roundPoints, type RoundMode } from '../shared/modes';
import { api, errorMessage, type RoundState } from './api';
import { fmtDate } from './format';
import { GuessInput } from './GuessInput';
import { PauseIcon, PlayIcon, SkipIcon } from './icons';
import { roundShareText, ShareButton } from './share';

type LoadStatus = 'loading' | 'ready' | 'error';

/** Gives up on a round whose media has not become usable in this long (a clip is ~360 KB, a portrait ~25 KB). */
const PRELOAD_TIMEOUT_MS = 20_000;

const INTRO: Record<RoundMode, string> = {
  opening: 'Guess the anime from its opening. A wrong guess or a skip unlocks a longer clip.',
  ending: 'Guess the anime from its ending. A wrong guess or a skip unlocks a longer clip.',
  screenshot: 'Guess the anime from one scene of its opening. It starts zoomed in 4×; a wrong guess or a skip zooms out.',
};

/** How a stage reads in the attempt list: "6 s", "zoom 2.5×". */
const STAGE_LABEL: Record<RoundMode, (stage: number) => string> = {
  opening: (s) => `${s} s`,
  ending: (s) => `${s} s`,
  screenshot: (s) => (s === 1 ? 'full' : `zoom ${s}×`),
};

/** The skip button: what the next stage adds. */
const SKIP_LABEL: Record<RoundMode, (unlocked: number, next: number) => string> = {
  opening: (unlocked, next) => `Skip (+${next - unlocked} s)`,
  ending: (unlocked, next) => `Skip (+${next - unlocked} s)`,
  screenshot: (_unlocked, next) => (next === 1 ? 'Skip (full image)' : `Skip (zoom ${next}×)`),
};

const isAudio = (mode: RoundMode) => mode === 'opening' || mode === 'ending';

/**
 * Loads every round's media up front so a round never waits on the network: one <audio> per round
 * for song modes, decoded images for Karakter. A round whose URLs change (replaced after an error)
 * loads again; the others keep what they have.
 */
function useRoundMedia(mode: RoundMode, media: string[][]) {
  const clips = useRef<HTMLAudioElement[]>([]);
  const loadedKey = useRef<string[]>([]);
  const [status, setStatus] = useState<LoadStatus[]>(() => media.map(() => 'loading'));

  const load = useCallback(
    (i: number, urls: string[]) => {
      loadedKey.current[i] = urls.join('|');
      setStatus((s) => s.with(i, 'loading'));
      const settle = (result: LoadStatus) => {
        clearTimeout(timer);
        if (loadedKey.current[i] === urls.join('|')) setStatus((s) => s.with(i, result));
      };
      const timer = setTimeout(() => settle('error'), PRELOAD_TIMEOUT_MS);
      let ready: Promise<unknown>;
      if (isAudio(mode)) {
        clips.current[i]?.pause();
        const audio = new Audio();
        audio.preload = 'auto';
        clips.current[i] = audio;
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        audio.oncanplaythrough = () => resolve();
        audio.onerror = () => reject(new Error('audio'));
        audio.src = urls[0]!;
        audio.load();
        ready = promise;
      } else {
        ready = Promise.all(
          urls.map((url) => {
            const img = new Image();
            img.src = url;
            return img.decode();
          }),
        );
      }
      ready.then(
        () => settle('ready'),
        () => settle('error'),
      );
    },
    [mode],
  );

  // `key` is the content of `media`, so the effect runs when a URL changes, not on every new array.
  const key = media.map((m) => m.join('|')).join('||');
  useEffect(() => {
    media.forEach((urls, i) => {
      if (loadedKey.current[i] !== urls.join('|')) load(i, urls);
    });
  }, [key, load]);
  useEffect(() => () => clips.current.forEach((a) => a.pause()), []);

  return { clips, status, retry: (i: number) => load(i, media[i]!) };
}

function ClipPlayer({ audio, seconds, stages }: { audio: HTMLAudioElement | undefined; seconds: number; stages: readonly number[] }) {
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frame = useRef(0);
  const total = stages.at(-1)!;

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    audio?.pause();
    setPlaying(false);
  }, [audio]);
  useEffect(() => stop, [stop]);
  // A new stage or round starts from the beginning again.
  useEffect(() => {
    stop();
    setPosition(0);
  }, [seconds, audio, stop]);

  const play = () => {
    if (!audio) return;
    if (playing) return stop();
    audio.currentTime = 0;
    void audio.play();
    setPlaying(true);
    const tick = () => {
      setPosition(audio.currentTime);
      if (audio.currentTime >= seconds || audio.ended) {
        stop();
        setPosition(Math.min(seconds, audio.currentTime));
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };

  const pct = (s: number) => `${(Math.min(s, total) / total) * 100}%`;
  return (
    <div className="clip">
      <button className="play-button primary" onClick={play} disabled={!audio} aria-label={playing ? 'Stop' : 'Play'}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="clip-body">
        <div className="clip-bar">
          <span className="clip-unlocked" style={{ width: pct(seconds) }} />
          <span className="clip-played" style={{ width: pct(position) }} />
          {stages.map((s) => (
            <span key={s} className={`clip-mark${s <= seconds ? ' open' : ''}`} style={{ left: pct(s) }} />
          ))}
        </div>
        <div className="clip-meta small muted">
          <span>{position.toFixed(1)} s</span>
          <span>{seconds} s unlocked</span>
        </div>
      </div>
    </div>
  );
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
  const media = useMemo(() => puzzle.rounds.map((r) => r.media), [puzzle.rounds]);
  const { clips, status, retry } = useRoundMedia(puzzle.mode, media);
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
  const audio = isAudio(puzzle.mode);

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
          <p className="muted small">{INTRO[puzzle.mode]}</p>
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
          <p>This round's media failed to load.</p>
          <div className="actions">
            <button onClick={() => retry(view)}>Try again</button>
            {puzzle.canReplace && !round.attempts.length && !round.finished && (
              <button className="primary" disabled={sending} onClick={() => send(() => api.replaceRound(puzzle.id, view))}>
                Replace with another title
              </button>
            )}
          </div>
        </div>
      ) : (
        <section className="card stage-card">
          {audio ? (
            <ClipPlayer audio={status[view] === 'ready' ? clips.current[view] : undefined} seconds={unlocked} stages={stages} />
          ) : (
            <ZoomShot url={round.media[0]!} zoom={unlocked} />
          )}
          {!round.finished && isCurrent && (
            <div className="stage-controls">
              <GuessInput exclude={exclude} disabled={sending} onPick={(malId) => send(() => api.roundGuess(puzzle.id, view, malId))} />
              <div className="stage-actions">
                <span className="muted small">
                  Attempt {round.attempts.length + 1}/{stages.length} · correct now = {roundPoints(round.attempts.length, stages.length)} pts
                </span>
                <button className="ghost" disabled={sending} onClick={() => send(() => api.roundGuess(puzzle.id, view, null))}>
                  <SkipIcon />
                  {next === undefined ? 'Give up' : SKIP_LABEL[puzzle.mode](unlocked, next)}
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
            {round.answer.song && (
              <div className="song">{[round.answer.song.label, round.answer.song.title && `“${round.answer.song.title}”`, round.answer.song.artist].filter(Boolean).join(' · ')}</div>
            )}
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
                <span className="attempt-stage">{STAGE_LABEL[puzzle.mode](stages[i]!)}</span>
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
