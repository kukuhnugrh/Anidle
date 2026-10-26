import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { POOL_LABELS } from '../shared/catalog';
import { MODE_LABELS } from '../shared/modes';
import { api, errorMessage, type SongState } from './api';
import { fmtDate } from './format';
import { GuessInput } from './GuessInput';
import { PauseIcon, PlayIcon } from './icons';
import { ShareButton, songShareText } from './share';

type LoadStatus = 'loading' | 'ready' | 'error';
type Clue = SongState['rounds'][number]['clue'];

/** Gives up on a song that has not downloaded in this long (full songs are ~3–4 MB, AnimeThemes takes ~5 s to start). */
const SONG_TIMEOUT_MS = 45_000;

const clock = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––');

interface Song {
  url: string;
  audio: HTMLAudioElement | null;
  status: LoadStatus;
}

/**
 * Every round's song, downloaded whole in the background as soon as the puzzle opens. A whole file
 * seeks instantly (a seek past what a streaming <audio> buffered costs another ~5 s round trip to
 * AnimeThemes) and, unlike the Range requests <audio> makes, can come from Vercel's CDN cache. A
 * round whose URL changes (replaced after an error) downloads again; the others keep theirs.
 */
function useSongs(urls: string[]) {
  const [songs, setSongs] = useState<Song[]>(() => urls.map((url) => ({ url, audio: null, status: 'loading' })));
  const latest = useRef(songs);
  latest.current = songs;

  const load = useCallback((i: number, url: string) => {
    const update = (song: Song) => setSongs((all) => (all[i]?.url === url ? all.with(i, song) : all));
    setSongs((all) => all.with(i, { url, audio: null, status: 'loading' }));
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), SONG_TIMEOUT_MS);
    fetch(url, { signal: abort.signal })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then(
        (blob) => update({ url, audio: new Audio(URL.createObjectURL(blob)), status: 'ready' }),
        () => update({ url, audio: null, status: 'error' }),
      )
      .finally(() => clearTimeout(timer));
  }, []);
  // `key` is the content of `urls`, so the effect runs when a URL changes, not on every new array.
  const started = useRef<string[]>([]);
  const key = urls.join('|');
  useEffect(() => {
    urls.forEach((url, i) => {
      if (started.current[i] === url) return;
      started.current[i] = url;
      const old = latest.current[i]?.audio;
      if (old) {
        old.pause();
        URL.revokeObjectURL(old.src);
      }
      load(i, url);
    });
  }, [key, load]);
  useEffect(
    () => () => {
      for (const s of latest.current) {
        s.audio?.pause();
        if (s.audio) URL.revokeObjectURL(s.audio.src);
      }
    },
    [],
  );

  return { songs, retry: (i: number) => load(i, urls[i]!) };
}

/** Play/pause and a seek bar over the whole song (the clue video follows it); switching rounds pauses the previous one. */
function SongPlayer({ audio, loading }: { audio: HTMLAudioElement | null; loading: boolean }) {
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
          <span>{loading ? 'Loading song…' : clock(time)}</span>
          <span>{clock(duration)}</span>
        </div>
      </div>
    </div>
  );
}

/** A clue video that cannot show a frame in this long gives way to the blurred cover. */
const CLUE_VIDEO_TIMEOUT_MS = 20_000;
/** The video follows the song; it is pulled back when it drifts further than this (seconds). */
const MAX_DRIFT_S = 0.4;

/**
 * The opening's video, blurred and muted, following the song: the player controls (and a click on
 * the video) play, pause and seek both, so the song never runs on its own beside a looping clip.
 * The corner button shows it fullscreen.
 */
function ClueVideo({ url, audio, onFail }: { url: string; audio: HTMLAudioElement | null; onFail: () => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (shown) return;
    const timer = setTimeout(onFail, CLUE_VIDEO_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [shown, onFail]);

  useEffect(() => {
    const v = video.current;
    if (!audio || !v) return;
    const follow = () => {
      if (!v.seeking && Math.abs(v.currentTime - audio.currentTime) > MAX_DRIFT_S) v.currentTime = audio.currentTime;
      if (audio.paused) v.pause();
      else if (v.paused) void v.play().catch(() => {});
    };
    follow();
    const events = ['play', 'pause', 'seeked', 'timeupdate'] as const;
    for (const e of events) audio.addEventListener(e, follow);
    return () => {
      for (const e of events) audio.removeEventListener(e, follow);
    };
  }, [audio]);

  return (
    <div ref={frame} className="clue-frame">
      <video
        ref={video}
        className="clue-media"
        src={url}
        muted
        preload="auto"
        playsInline
        onClick={() => audio && (audio.paused ? void audio.play() : audio.pause())}
        onLoadedData={() => setShown(true)}
        onError={onFail}
      />
      {!shown && <span className="clue-status small">Loading the video…</span>}
      <button
        className="clue-fullscreen small"
        onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : frame.current?.requestFullscreen())?.catch(() => {})}
      >
        ⛶ Fullscreen
      </button>
    </div>
  );
}

/** The opened clue: the blurred opening video (blurred cover when it will not play), or the blurred cover. */
function ClueView({ clue, audio }: { clue: Clue; audio: HTMLAudioElement | null }) {
  const [videoFailed, setVideoFailed] = useState(false);
  const onFail = useCallback(() => setVideoFailed(true), []);
  if (!clue.url) return null;
  if (clue.kind === 'video' && !videoFailed) return <ClueVideo url={clue.url} audio={audio} onFail={onFail} />;
  const image = clue.kind === 'cover' ? clue.url : clue.fallback;
  return image ? <img className="clue-media cover" src={image} alt="" /> : null;
}

export function SongGame({ puzzle, onChange, onNewUnlimited }: { puzzle: SongState; onChange: (p: SongState) => void; onNewUnlimited: () => Promise<void> }) {
  const urls = useMemo(() => puzzle.rounds.map((r) => r.audio), [puzzle.rounds]);
  const { songs, retry } = useSongs(urls);
  const [view, setView] = useState(Math.min(puzzle.current, puzzle.rounds.length - 1));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const round = puzzle.rounds[view]!;
  const song = songs[view];
  const isCurrent = view === puzzle.current;
  const clueName = round.clue.kind === 'video' ? 'the blurred opening video' : 'the blurred anime cover';

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

      {song?.status === 'error' ? (
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
          <SongPlayer audio={song?.audio ?? null} loading={song?.status === 'loading'} />
          {round.clue.opened && !round.finished && <ClueView key={round.audio} clue={round.clue} audio={song?.audio ?? null} />}
          {!round.finished && isCurrent && (
            <div className="stage-controls">
              <GuessInput disabled={sending} onPick={(malId) => send(() => api.roundGuess<SongState>(puzzle.id, view, malId))} />
              <div className="stage-actions">
                <span className="muted small">One guess · right now = {round.clue.opened ? puzzle.points.withClue : puzzle.points.plain} pts</span>
                <div className="actions">
                  {!round.clue.opened && (
                    <button disabled={sending} onClick={() => send(() => api.roundClue<SongState>(puzzle.id, view))} title={`Shows ${clueName}`}>
                      Show clue (−{puzzle.points.plain - puzzle.points.withClue} pts)
                    </button>
                  )}
                  <button className="ghost danger" disabled={sending} onClick={() => confirm('Give up this round? It scores 0.') && send(() => api.roundGiveUp<SongState>(puzzle.id, view))}>
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
