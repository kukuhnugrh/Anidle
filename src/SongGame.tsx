import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { POOL_LABELS } from '../shared/catalog';
import { MODE_LABELS } from '../shared/modes';
import { api, errorMessage, type SongState } from './api';
import { fmtDate } from './format';
import { GuessInput } from './GuessInput';
import { PauseIcon, PlayIcon } from './icons';
import { ShareButton, songShareText } from './share';

type LoadStatus = 'loading' | 'ready' | 'error';

/** Gives up on a song that has not become playable in this long (full songs are ~3–4 MB). */
const PRELOAD_TIMEOUT_MS = 30_000;

const clock = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––');

/**
 * One <audio> per round, loaded up front so a round never waits on the network. A round whose URL
 * changes (replaced after an error) loads again; the others keep their element.
 */
function useSongs(urls: string[]) {
  const songs = useRef<HTMLAudioElement[]>([]);
  const [status, setStatus] = useState<LoadStatus[]>(() => urls.map(() => 'loading'));

  const load = useCallback((i: number, url: string) => {
    songs.current[i]?.pause();
    const audio = new Audio();
    audio.preload = 'auto';
    songs.current[i] = audio;
    setStatus((s) => s.with(i, 'loading'));
    const settle = (result: LoadStatus) => {
      clearTimeout(timer);
      audio.oncanplaythrough = audio.onerror = null;
      if (songs.current[i] === audio) setStatus((s) => s.with(i, result));
    };
    const timer = setTimeout(() => settle('error'), PRELOAD_TIMEOUT_MS);
    audio.oncanplaythrough = () => settle('ready');
    audio.onerror = () => settle('error');
    audio.src = url;
    audio.load();
  }, []);

  // `key` is the content of `urls`, so the effect runs when a URL changes, not on every new array.
  const key = urls.join('|');
  useEffect(() => {
    urls.forEach((url, i) => {
      if (!songs.current[i]?.src.endsWith(url)) load(i, url);
    });
  }, [key, load]);
  useEffect(() => () => songs.current.forEach((a) => a.pause()), []);

  return { songs, status, retry: (i: number) => load(i, urls[i]!) };
}

/** Plays the whole song with a seek bar; switching rounds pauses the previous one. */
function SongPlayer({ audio }: { audio: HTMLAudioElement | undefined }) {
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(NaN);

  useEffect(() => {
    if (!audio) return;
    const sync = () => {
      setPlaying(!audio.paused);
      setTime(audio.currentTime);
      setDuration(audio.duration);
    };
    sync();
    const events = ['play', 'pause', 'timeupdate', 'durationchange', 'ended'] as const;
    for (const e of events) audio.addEventListener(e, sync);
    return () => {
      audio.pause();
      for (const e of events) audio.removeEventListener(e, sync);
    };
  }, [audio]);

  return (
    <div className="clip">
      <button className="play-button primary" disabled={!audio} onClick={() => (audio?.paused ? void audio.play() : audio?.pause())} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="clip-body">
        <input
          className="seek"
          type="range"
          min={0}
          max={Number.isFinite(duration) ? duration : 0}
          step={0.1}
          value={time}
          disabled={!audio}
          onChange={(e) => {
            if (audio) audio.currentTime = Number(e.target.value);
          }}
          aria-label="Seek"
        />
        <div className="clip-meta small muted">
          <span>{clock(time)}</span>
          <span>{clock(duration)}</span>
        </div>
      </div>
    </div>
  );
}

/** A clue video that cannot start playing in this long gives way to the blurred cover. */
const CLUE_VIDEO_TIMEOUT_MS = 15_000;

/** The opened clue, blurred: the opening's video (cover if the video will not play), or the cover. */
function Clue({ clue }: { clue: SongState['rounds'][number]['clue'] }) {
  const [videoFailed, setVideoFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (clue.kind !== 'video') return;
    const timer = setTimeout(() => {
      if ((video.current?.readyState ?? 0) < HTMLMediaElement.HAVE_CURRENT_DATA) setVideoFailed(true);
    }, CLUE_VIDEO_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [clue.kind, clue.url]);
  if (!clue.url) return null;
  if (clue.kind === 'video' && !videoFailed)
    return <video ref={video} className="clue-media" src={clue.url} muted autoPlay loop playsInline onError={() => setVideoFailed(true)} />;
  const image = clue.kind === 'cover' ? clue.url : clue.fallback;
  return image ? <img className="clue-media cover" src={image} alt="" /> : null;
}

export function SongGame({ puzzle, onChange, onNewUnlimited }: { puzzle: SongState; onChange: (p: SongState) => void; onNewUnlimited: () => Promise<void> }) {
  const urls = useMemo(() => puzzle.rounds.map((r) => r.audio), [puzzle.rounds]);
  const { songs, status, retry } = useSongs(urls);
  const [view, setView] = useState(Math.min(puzzle.current, puzzle.rounds.length - 1));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settled = status.filter((s) => s !== 'loading').length;
  const round = puzzle.rounds[view]!;
  const isCurrent = view === puzzle.current;
  const clueName = round.clue.kind === 'video' ? 'the blurred opening video' : 'the blurred anime cover';
  const noExclusions = useMemo(() => new Set<number>(), []);

  const send = async (task: () => Promise<SongState>) => {
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
            Loading song {settled}/{status.length}
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
          <p className="muted small">
            Listen to the whole {puzzle.mode === 'opening' ? 'opening' : 'ending'} and make one guess: {puzzle.points.plain} pts if right, {puzzle.points.withClue} pts if you opened the clue, 0 if wrong.
          </p>
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
          <p>This song failed to load.</p>
          <div className="actions">
            <button onClick={() => retry(view)}>Try again</button>
            {puzzle.canReplace && !round.clue.opened && !round.finished && (
              <button className="primary" disabled={sending} onClick={() => send(() => api.replaceRound<SongState>(puzzle.id, view))}>
                Replace with another song
              </button>
            )}
          </div>
        </div>
      ) : (
        <section className="card stage-card">
          <SongPlayer audio={status[view] === 'ready' ? songs.current[view] : undefined} />
          {round.clue.opened && !round.finished && <Clue key={round.audio} clue={round.clue} />}
          {!round.finished && isCurrent && (
            <div className="stage-controls">
              <GuessInput exclude={noExclusions} disabled={sending} onPick={(malId) => send(() => api.songGuess(puzzle.id, view, malId))} />
              <div className="stage-actions">
                <span className="muted small">One guess · right now = {round.clue.opened ? puzzle.points.withClue : puzzle.points.plain} pts</span>
                <div className="actions">
                  {!round.clue.opened && (
                    <button disabled={sending} onClick={() => send(() => api.songClue(puzzle.id, view))} title={`Shows ${clueName}`}>
                      Show clue (−{puzzle.points.plain - puzzle.points.withClue} pts)
                    </button>
                  )}
                  <button className="ghost danger" disabled={sending} onClick={() => confirm('Give up this round? It scores 0.') && send(() => api.songGiveUp(puzzle.id, view))}>
                    Give up
                  </button>
                </div>
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
              {round.solved ? (round.clue.opened ? 'Right, with the clue' : 'Right!') : round.gaveUp ? 'You gave up. The answer:' : `Not ${round.guess?.title}. The answer:`}
            </div>
            <h3>{round.answer.title}</h3>
            <div className="song">
              {[round.answer.song.label, round.answer.song.title && `“${round.answer.song.title}”`, round.answer.song.artist].filter(Boolean).join(' · ')}
            </div>
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

      {puzzle.finished && (
        <section className="card final">
          <div>
            <span className="eyebrow">Finished</span>
            <h2>{puzzle.score ?? 0} pts</h2>
            <p className="muted small">
              {puzzle.rounds.filter((r) => r.solved).length} of {puzzle.rounds.length} right · max {puzzle.points.plain * puzzle.rounds.length} pts
            </p>
          </div>
          <div className="actions">
            <ShareButton text={songShareText(puzzle)} />
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
