import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { POOL_LABELS } from '../shared/catalog';
import { MODE_LABELS, ROUND_POINTS } from '../shared/modes';
import { api, errorMessage, type ThemeState } from './api';
import { fmtDate } from './format';
import { GuessInput } from './GuessInput';
import { PauseIcon, PlayIcon, SkipIcon } from './icons';

type LoadStatus = 'loading' | 'ready' | 'error';

/** Gives up on a clip that has not become playable in this long (the file is ~360 KB). */
const PRELOAD_TIMEOUT_MS = 20_000;

/**
 * One <audio> per round, loaded up front so a round never waits on the network. A round whose URL
 * changes (replaced after an error) is loaded again; the others keep their element.
 */
function useClips(urls: string[]) {
  const clips = useRef<HTMLAudioElement[]>([]);
  const [status, setStatus] = useState<LoadStatus[]>(() => urls.map(() => 'loading'));

  const load = useCallback((i: number, url: string) => {
    clips.current[i]?.pause();
    const audio = new Audio();
    audio.preload = 'auto';
    clips.current[i] = audio;
    setStatus((s) => s.with(i, 'loading'));
    const settle = (result: LoadStatus) => {
      clearTimeout(timer);
      audio.oncanplaythrough = audio.onerror = null;
      if (clips.current[i] === audio) setStatus((s) => s.with(i, result));
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
      if (clips.current[i]?.src !== url) load(i, url);
    });
  }, [key, load]);
  useEffect(() => () => clips.current.forEach((a) => a.pause()), []);

  return { clips, status, retry: (i: number) => load(i, urls[i]!) };
}

function ClipPlayer({ audio, seconds, stages, total }: { audio: HTMLAudioElement | undefined; seconds: number; stages: readonly number[]; total: number }) {
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frame = useRef(0);

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
      <button className="play-button primary" onClick={play} disabled={!audio} aria-label={playing ? 'Berhenti' : 'Putar'}>
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
          <span>{position.toFixed(1)} dtk</span>
          <span>terbuka {seconds} dtk</span>
        </div>
      </div>
    </div>
  );
}

export function ThemeGame({ puzzle, onChange, onNewUnlimited }: { puzzle: ThemeState; onChange: (p: ThemeState) => void; onNewUnlimited: () => Promise<void> }) {
  const urls = useMemo(() => puzzle.rounds.map((r) => r.audio), [puzzle.rounds]);
  const { clips, status, retry } = useClips(urls);
  const [view, setView] = useState(Math.min(puzzle.current, puzzle.rounds.length - 1));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loaded = status.filter((s) => s !== 'loading').length;
  const allSettled = loaded === status.length;
  const round = puzzle.rounds[view]!;
  const isCurrent = view === puzzle.current;
  const unlocked = round.finished ? puzzle.clipStages.at(-1)! : puzzle.clipStages[round.attempts.length]!;
  const nextStage = puzzle.clipStages[round.attempts.length + 1];
  const exclude = useMemo(() => new Set(round.attempts.flatMap((a) => (a ? [a.malId] : []))), [round.attempts]);

  const send = async (task: () => Promise<ThemeState>) => {
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

  const replace = () => send(() => api.replaceRound(puzzle.id, view));

  if (!allSettled && !puzzle.finished)
    return (
      <div className="center">
        <div className="preload">
          <span className="eyebrow">Menyiapkan {MODE_LABELS[puzzle.mode]}</span>
          <div className="preload-bar">
            <span style={{ width: `${(loaded / status.length) * 100}%` }} />
          </div>
          <span className="muted small">
            Memuat audio {loaded}/{status.length}
          </span>
        </div>
      </div>
    );

  return (
    <div className="theme-game">
      <header className="page-head game-head">
        <div>
          <span className="eyebrow">{puzzle.date ? `Harian · ${fmtDate(puzzle.date)}` : `Unlimited · ${POOL_LABELS[puzzle.pool]}`}</span>
          <h1>{MODE_LABELS[puzzle.mode]}</h1>
          <p className="muted small">Tebak anime dari {puzzle.mode === 'opening' ? 'opening' : 'ending'}-nya. Tebakan salah atau lewati membuka potongan yang lebih panjang.</p>
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
              <span>Ronde {i + 1}</span>
              <b>{r.finished ? `${r.points}` : i === puzzle.current ? '…' : '—'}</b>
            </button>
          ))}
        </div>
      </header>

      {status[view] === 'error' ? (
        <div className="card load-error">
          <p>Audio ronde ini gagal dimuat.</p>
          <div className="actions">
            <button onClick={() => retry(view)}>Coba lagi</button>
            {puzzle.canReplace && !round.attempts.length && !round.finished && (
              <button className="primary" disabled={sending} onClick={replace}>
                Ganti dengan judul lain
              </button>
            )}
          </div>
        </div>
      ) : (
        <section className="card stage-card">
          <ClipPlayer audio={status[view] === 'ready' ? clips.current[view] : undefined} seconds={unlocked} stages={puzzle.clipStages} total={puzzle.clipStages.at(-1)!} />
          {!round.finished && isCurrent && (
            <div className="stage-controls">
              <GuessInput exclude={exclude} disabled={sending} onPick={(malId) => send(() => api.themeGuess(puzzle.id, view, malId))} />
              <div className="stage-actions">
                <span className="muted small">
                  Percobaan {round.attempts.length + 1}/{puzzle.clipStages.length} · benar sekarang = {ROUND_POINTS[round.attempts.length]} poin
                </span>
                <button className="ghost" disabled={sending} onClick={() => send(() => api.themeGuess(puzzle.id, view, null))}>
                  <SkipIcon />
                  {nextStage ? `Lewati (+${nextStage - unlocked} dtk)` : 'Menyerah'}
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
            <div className="muted small">{round.solved ? `Benar di percobaan ${round.attempts.length}` : 'Jawabannya:'}</div>
            <h3>{round.answer.title}</h3>
            <div className="song">
              {[round.answer.song.label, round.answer.song.title && `“${round.answer.song.title}”`, round.answer.song.artist].filter(Boolean).join(' · ')}
            </div>
            <div className="muted answer-meta">
              {round.answer.year ?? ''}
              <span className={`difficulty ${round.answer.difficulty}`}>{round.answer.difficulty}</span>
            </div>
            <div className="score">{round.points} poin</div>
            <div className="actions">
              <a className="button" href={`https://myanimelist.net/anime/${round.answer.malId}`} target="_blank" rel="noreferrer">
                Buka di MAL ↗
              </a>
              {view < puzzle.current && puzzle.current < puzzle.rounds.length && (
                <button className="primary" onClick={() => setView(puzzle.current)}>
                  Ronde {puzzle.current + 1}
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
                <span className="attempt-stage">{puzzle.clipStages[i]} dtk</span>
                <span>{a ? a.title : 'Dilewati'}</span>
                <span className="attempt-mark">{correct ? '✓' : a ? '✗' : '→'}</span>
              </li>
            );
          })}
        </ol>
      )}

      {puzzle.finished && (
        <section className="card final">
          <div>
            <span className="eyebrow">Selesai</span>
            <h2>{puzzle.score ?? 0} poin</h2>
            <p className="muted small">
              {puzzle.rounds.filter((r) => r.solved).length} dari {puzzle.rounds.length} ronde benar · maksimal {ROUND_POINTS[0]! * puzzle.rounds.length} poin
            </p>
          </div>
          <div className="actions">
            <button className="primary" onClick={() => onNewUnlimited().catch((err: unknown) => setError(errorMessage(err)))}>
              Main {MODE_LABELS[puzzle.mode]} unlimited
            </button>
            <a className="button ghost" href="#/">
              Beranda
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
