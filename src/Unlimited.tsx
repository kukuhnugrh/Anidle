import { useState } from 'react';
import { MAIN_GENRES, POOL_LABELS, POOL_NEEDS_MAL, POOLS, type Difficulty, type Pool } from '../shared/catalog';
import { MODE_LABELS, MODES, type Mode } from '../shared/modes';
import { api, errorMessage, savedUnlimited, type Account, type UnlimitedOptions } from './api';
import { ArrowIcon } from './icons';
import { go } from './route';

const MODE_HINTS: Record<Mode, string> = {
  anidle: 'tebak dari petunjuk',
  opening: '3 ronde lagu opening',
  ending: '3 ronde lagu ending',
  character: '3 ronde, 4 karakter',
  screenshot: '3 ronde, zoom keluar',
};

const DIFFICULTY_CHOICES: Record<string, { label: string; hint: string; value: Difficulty[] }> = {
  all: { label: 'Semua', hint: 'semua judul', value: [] },
  'easy+medium': { label: 'Easy + Medium', hint: 'seperti harian', value: ['easy', 'medium'] },
  easy: { label: 'Easy', hint: '≥ 500 rb member', value: ['easy'] },
  medium: { label: 'Medium', hint: '200–500 rb member', value: ['medium'] },
  hard: { label: 'Hard', hint: '< 200 rb member', value: ['hard'] },
};
const choiceKey = (value: Difficulty[] = []) =>
  Object.keys(DIFFICULTY_CHOICES).find((k) => DIFFICULTY_CHOICES[k]!.value.join() === [...value].sort().join()) ?? 'all';

export function Unlimited({ account }: { account: Account | null }) {
  const [saved] = useState(savedUnlimited.load);
  const [mode, setMode] = useState<Mode>(saved?.mode ?? 'anidle');
  const [pool, setPool] = useState<Pool>(saved && (POOLS as readonly string[]).includes(saved.pool) ? saved.pool : 'semua');
  const [genreId, setGenreId] = useState<number | ''>(saved?.genreId ?? '');
  const [difficulty, setDifficulty] = useState(choiceKey(saved?.difficulties));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasMal = Boolean(account?.mal);
  const poolLocked = POOL_NEEDS_MAL[pool] && !hasMal;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const options: UnlimitedOptions = { mode, pool, genreId: genreId === '' ? undefined : genreId, difficulties: DIFFICULTY_CHOICES[difficulty]!.value };
      const puzzle = await api.unlimited(options);
      savedUnlimited.save(options);
      go(`#/play/${puzzle.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="stack narrow">
      <header className="page-head">
        <span className="eyebrow">Mode bebas</span>
        <h1>Unlimited</h1>
        <p className="muted">Puzzle acak sebanyak yang kamu mau. Pengaturan terakhir disimpan di browser ini.</p>
      </header>

      <section className="card form-card">
        <div className="field">
          <span className="field-label">Mode</span>
          <div className="segmented modes" role="radiogroup" aria-label="Mode">
            {MODES.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'selected' : ''} onClick={() => setMode(m)}>
                <b>{MODE_LABELS[m]}</b>
                <span>{MODE_HINTS[m]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Pool</span>
          <div className="option-grid" role="radiogroup" aria-label="Pool">
            {POOLS.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={pool === p} className={`option${pool === p ? ' selected' : ''}`} onClick={() => setPool(p)}>
                <span>{POOL_LABELS[p]}</span>
                {POOL_NEEDS_MAL[p] && !hasMal && <span className="lock">butuh MAL</span>}
              </button>
            ))}
          </div>
          {poolLocked && (
            <p className="muted small">
              Pool ini memakai list completed MAL. {account ? <a href="#/akun">Hubungkan akun MAL dulu.</a> : <><a href="#/masuk">Masuk</a> lalu hubungkan akun MAL dulu.</>}
            </p>
          )}
        </div>

        <div className="field">
          <span className="field-label">Difficulty</span>
          <div className="segmented" role="radiogroup" aria-label="Difficulty">
            {Object.entries(DIFFICULTY_CHOICES).map(([key, c]) => (
              <button key={key} type="button" role="radio" aria-checked={difficulty === key} className={difficulty === key ? 'selected' : ''} onClick={() => setDifficulty(key)}>
                <b>{c.label}</b>
                <span>{c.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-label">Genre</span>
          <select value={genreId} onChange={(e) => setGenreId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Semua genre</option>
            {MAIN_GENRES.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>

        {error && <div className="error-box">{error}</div>}
        <button className="primary big" disabled={busy || poolLocked} onClick={start}>
          {busy ? 'Membuat puzzle…' : 'Mulai puzzle'}
          <ArrowIcon />
        </button>
      </section>
    </div>
  );
}
