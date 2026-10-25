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
  opening: 'Tebak anime dari opening-nya. Tebakan salah atau lewati membuka potongan yang lebih panjang.',
  ending: 'Tebak anime dari ending-nya. Tebakan salah atau lewati membuka potongan yang lebih panjang.',
  character: 'Tebak anime dari karakternya. Tebakan salah atau lewati membuka karakter berikutnya; yang paling terkenal muncul terakhir.',
};

const isAudio = (mode: RoundMode) => mode !== 'character';

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

function Portraits({ urls, shown, names }: { urls: string[]; shown: number; names: string[] | null }) {
  return (
    <div className="portraits">
      {urls.map((url, i) => (
        <figure key={url} className={`portrait${i < shown ? ' open' : ''}`}>
          {i < shown ? <img src={url} alt="" /> : <span className="portrait-lock">{i + 1}</span>}
          {names && <figcaption>{names[i]}</figcaption>}
        </figure>
      ))}
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
          <span className="eyebrow">Menyiapkan {MODE_LABELS[puzzle.mode]}</span>
          <div className="preload-bar">
            <span style={{ width: `${(settled / status.length) * 100}%` }} />
          </div>
          <span className="muted small">
            Memuat ronde {settled}/{status.length}
          </span>
        </div>
      </div>
    );

  return (
    <div className="round-game">
      <header className="page-head game-head">
        <div>
          <span className="eyebrow">{puzzle.date ? `Harian · ${fmtDate(puzzle.date)}` : `Unlimited · ${POOL_LABELS[puzzle.pool]}`}</span>
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
              <span>Ronde {i + 1}</span>
              <b>{r.finished ? `${r.points}` : i === puzzle.current ? '…' : '—'}</b>
            </button>
          ))}
        </div>
      </header>

      {status[view] === 'error' ? (
        <div className="card load-error">
          <p>Media ronde ini gagal dimuat.</p>
          <div className="actions">
            <button onClick={() => retry(view)}>Coba lagi</button>
            {puzzle.canReplace && !round.attempts.length && !round.finished && (
              <button className="primary" disabled={sending} onClick={() => send(() => api.replaceRound(puzzle.id, view))}>
                Ganti dengan judul lain
              </button>
            )}
          </div>
        </div>
      ) : (
        <section className="card stage-card">
          {audio ? (
            <ClipPlayer audio={status[view] === 'ready' ? clips.current[view] : undefined} seconds={unlocked} stages={stages} />
          ) : (
            <Portraits urls={round.media} shown={unlocked} names={round.answer ? round.answer.characters.map((c) => c.name) : null} />
          )}
          {!round.finished && isCurrent && (
            <div className="stage-controls">
              <GuessInput exclude={exclude} disabled={sending} onPick={(malId) => send(() => api.roundGuess(puzzle.id, view, malId))} />
              <div className="stage-actions">
                <span className="muted small">
                  Percobaan {round.attempts.length + 1}/{stages.length} · benar sekarang = {roundPoints(round.attempts.length, stages.length)} poin
                </span>
                <button className="ghost" disabled={sending} onClick={() => send(() => api.roundGuess(puzzle.id, view, null))}>
                  <SkipIcon />
                  {next === undefined ? 'Menyerah' : audio ? `Lewati (+${next - unlocked} dtk)` : 'Lewati (+1 karakter)'}
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
            {round.answer.song && (
              <div className="song">{[round.answer.song.label, round.answer.song.title && `“${round.answer.song.title}”`, round.answer.song.artist].filter(Boolean).join(' · ')}</div>
            )}
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
                <span className="attempt-stage">{audio ? `${stages[i]} dtk` : `${stages[i]} karakter`}</span>
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
              {puzzle.rounds.filter((r) => r.solved).length} dari {puzzle.rounds.length} ronde benar · maksimal {MAX_ROUND_POINTS * puzzle.rounds.length} poin
            </p>
          </div>
          <div className="actions">
            <ShareButton text={roundShareText(puzzle)} />
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
