import { useState } from 'react';
import { MAIN_GENRES, POOL_LABELS, POOL_NEEDS_MAL, POOLS, type Difficulty, type Pool } from '../shared/catalog';
import { LINK_KIND_LABELS, LINK_KINDS, usesLinks, type LinkKind } from '../shared/connections';
import { BETA_MODES, DAILY_MODES, MODE_LABELS, type Mode } from '../shared/modes';
import { api, errorMessage, savedUnlimited, type Account, type UnlimitedOptions } from './api';
import { ArrowIcon } from './icons';
import { go } from './route';

const MODE_HINTS: Record<Mode, string> = {
  anidle: 'guess from clues',
  opening: '3 rounds of openings',
  ending: '3 rounds of endings',
  character: '3 rounds, 4 characters',
  screenshot: '3 rounds, zooming out',
  connections: '16 titles, 4 hidden groups',
  synopsis: '3 rounds of synopses',
  higherlower: 'MAL score, 20 in a row',
  oddoneout: '5 rounds, spot the outlier',
  timeline: '3 rounds, sort by year',
};

const DIFFICULTY_CHOICES: Record<string, { label: string; hint: string; value: Difficulty[] }> = {
  all: { label: 'All', hint: 'rounds easy → medium → hard', value: [] },
  'easy+medium': { label: 'Easy + Medium', hint: 'no hard titles', value: ['easy', 'medium'] },
  easy: { label: 'Easy', hint: '≥ 500k members', value: ['easy'] },
  medium: { label: 'Medium', hint: '200k–500k members', value: ['medium'] },
  hard: { label: 'Hard', hint: '< 200k members', value: ['hard'] },
};
const choiceKey = (value: Difficulty[] = []) =>
  Object.keys(DIFFICULTY_CHOICES).find((k) => DIFFICULTY_CHOICES[k]!.value.join() === [...value].sort().join()) ?? 'all';

/** The two free-play pages: Unlimited (the daily modes) and Beta (modes still being tested, never daily). */
const PAGES = {
  unlimited: {
    modes: DAILY_MODES,
    eyebrow: 'Free play',
    title: 'Unlimited',
    intro: 'As many random puzzles as you like. Your last settings are saved in this browser.',
    allHint: DIFFICULTY_CHOICES.all!.hint,
  },
  beta: {
    modes: BETA_MODES,
    eyebrow: 'Free play · Beta',
    title: 'Beta modes',
    intro: "New modes we're still testing. They're unlimited only and don't count for the daily total or the leaderboard yet. Tell us what you think!",
    allHint: 'any title',
  },
} satisfies Record<string, { modes: readonly Mode[]; eyebrow: string; title: string; intro: string; allHint: string }>;

export function Unlimited({ account, page }: { account: Account | null; page: keyof typeof PAGES }) {
  const { modes, eyebrow, title, intro, allHint } = PAGES[page];
  const [saved] = useState(savedUnlimited.load);
  // The last settings are shared by both pages; a mode from the other page falls back to this page's first.
  const [mode, setMode] = useState<Mode>(saved && (modes as readonly Mode[]).includes(saved.mode) ? saved.mode : modes[0]!);
  const [pool, setPool] = useState<Pool>(saved && (POOLS as readonly string[]).includes(saved.pool) ? saved.pool : 'semua');
  const [genreId, setGenreId] = useState<number | ''>(saved?.genreId ?? '');
  const [difficulty, setDifficulty] = useState(choiceKey(saved?.difficulties));
  // Connections and Odd One Out: which link kinds their groups may use (every kind by default).
  const [links, setLinks] = useState<LinkKind[]>(saved?.links?.length ? saved.links : [...LINK_KINDS]);
  const linksMissing = usesLinks(mode) && !links.length;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasMal = Boolean(account?.mal);
  const poolLocked = POOL_NEEDS_MAL[pool] && !hasMal;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const options: UnlimitedOptions = {
        mode,
        pool,
        genreId: genreId === '' ? undefined : genreId,
        difficulties: DIFFICULTY_CHOICES[difficulty]!.value,
        // Only Connections and Odd One Out read it; kept with the other settings so it survives switching modes.
        links,
      };
      const puzzle = await api.unlimited(options);
      savedUnlimited.save(options);
      go(`/play/${puzzle.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="stack narrow">
      <header className="page-head">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="muted">{intro}</p>
      </header>

      <section className="card form-card">
        <div className="field">
          <span className="field-label">Mode</span>
          <div className="segmented modes" role="radiogroup" aria-label="Mode">
            {modes.map((m) => (
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
                {POOL_NEEDS_MAL[p] && !hasMal && <span className="lock">needs MAL</span>}
              </button>
            ))}
          </div>
          {poolLocked && (
            <p className="muted small">
              This pool uses your MAL completed list. {account ? <a href="/akun">Link your MAL account first.</a> : <a href="/api/oauth/login">Sign in with MyAnimeList first.</a>}
            </p>
          )}
        </div>

        {usesLinks(mode) && (
          <div className="field">
            <span className="field-label">Links</span>
            <div className="option-grid link-picks" role="group" aria-label={mode === 'connections' ? 'What the groups may share' : 'What the four may share'}>
              {LINK_KINDS.map((k) => {
                const on = links.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    className={`option${on ? ' selected' : ''}`}
                    onClick={() => setLinks((cur) => (cur.includes(k) ? cur.filter((l) => l !== k) : LINK_KINDS.filter((l) => l === k || cur.includes(l))))}
                  >
                    <span>{LINK_KIND_LABELS[k]}</span>
                    <span className="link-check">{on ? '✓' : ''}</span>
                  </button>
                );
              })}
            </div>
            <p className="muted small">
              {mode === 'connections' ? 'What the hidden groups may share.' : 'What the four titles that belong together may share.'} Tags are MAL demographics (Shounen, Seinen, Shoujo…).
              Fewer types make {mode === 'connections' ? 'harder boards' : 'easier rounds (you know what to look for)'}, and a small pool may not have enough.
            </p>
          </div>
        )}

        <div className="field">
          <span className="field-label">Difficulty</span>
          <div className="segmented" role="radiogroup" aria-label="Difficulty">
            {Object.entries(DIFFICULTY_CHOICES).map(([key, c]) => (
              <button key={key} type="button" role="radio" aria-checked={difficulty === key} className={difficulty === key ? 'selected' : ''} onClick={() => setDifficulty(key)}>
                <b>{c.label}</b>
                <span>{key === 'all' ? (mode === 'synopsis' ? c.hint : allHint) : c.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-label">Genre</span>
          <select value={genreId} onChange={(e) => setGenreId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">All genres</option>
            {MAIN_GENRES.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>

        {error && <div className="error-box">{error}</div>}
        <button className="primary big" disabled={busy || poolLocked || linksMissing} onClick={start}>
          {busy ? 'Creating puzzle…' : 'Start puzzle'}
          <ArrowIcon />
        </button>
      </section>
    </div>
  );
}
