import { useLayoutEffect, useRef, useState } from 'react';
import { MAIN_GENRES, POOL_LABELS, POOL_NEEDS_MAL, POOLS, type Difficulty, type Pool } from '../shared/catalog';
import { LINK_KIND_LABELS, LINK_KINDS, usesLinks, type LinkKind } from '../shared/connections';
import { BETA_MODES, DAILY_MODES, MODE_LABELS, type Mode } from '../shared/modes';
import { api, errorMessage, savedUnlimited, type Account, type UnlimitedOptions } from './api';
import { ArrowIcon } from './icons';
import { go } from './route';
import { useButtonReaction, useElementEvent } from './sakuga';

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

interface PickProps<V extends string> {
  /** The group's accessible name. */
  label: string;
  options: ReadonlyArray<{ value: V; label: string }>;
  value: V;
  onChange: (value: V) => void;
}

/** A <sakuga-radio> group. It reads its options once, so it is built again whenever their labels change. */
function Pick<V extends string>(props: PickProps<V>) {
  return <PickGroup key={props.options.map((o) => o.label).join('\n')} {...props} />;
}

function PickGroup<V extends string>({ label, options, value, onChange }: PickProps<V>) {
  const ref = useRef<SakugaRadioElement>(null);
  // Only when it differs: setting it snaps the dot, which would cut short the spring a click just started.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.value !== value) el.value = value;
  }, [value]);
  useElementEvent(ref, 'change', (el) => {
    const picked = options.find((o) => o.value === el.value);
    if (picked) onChange(picked.value);
  });
  return (
    <sakuga-radio ref={ref} className="pick" label={label}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </sakuga-radio>
  );
}

/** One link kind's <sakuga-checkbox>. */
function LinkCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const ref = useRef<SakugaCheckboxElement>(null);
  useElementEvent(ref, 'change', (el) => onChange(el.checked));
  return (
    <sakuga-checkbox ref={ref} checked={checked}>
      {label}
    </sakuga-checkbox>
  );
}

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
  const reaction = useButtonReaction();
  const [error, setError] = useState<string | null>(null);
  const hasMal = Boolean(account?.mal);
  const poolLocked = POOL_NEEDS_MAL[pool] && !hasMal;
  const blocked = busy || poolLocked || linksMissing;
  const difficultyHint = difficulty === 'all' ? (mode === 'synopsis' ? DIFFICULTY_CHOICES.all!.hint : allHint) : DIFFICULTY_CHOICES[difficulty]!.hint;

  const start = async () => {
    if (blocked) return;
    reaction.pressed();
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
          <Pick label="Mode" options={modes.map((m) => ({ value: m, label: MODE_LABELS[m] }))} value={mode} onChange={setMode} />
          <p className="muted small pick-hint">{MODE_HINTS[mode]}</p>
        </div>

        <div className="field">
          <span className="field-label">Pool</span>
          <Pick label="Pool" options={POOLS.map((p) => ({ value: p, label: `${POOL_LABELS[p]}${POOL_NEEDS_MAL[p] && !hasMal ? ' (needs MAL)' : ''}` }))} value={pool} onChange={setPool} />
          {poolLocked && (
            <p className="muted small">
              This pool uses your MAL completed list. {account ? <a href="/akun">Link your MAL account first.</a> : <a href="/api/oauth/login">Sign in with MyAnimeList first.</a>}
            </p>
          )}
        </div>

        {usesLinks(mode) && (
          <div className="field">
            <span className="field-label">Links</span>
            <div className="link-picks" role="group" aria-label={mode === 'connections' ? 'What the groups may share' : 'What the four may share'}>
              {LINK_KINDS.map((k) => (
                <LinkCheck
                  key={k}
                  label={LINK_KIND_LABELS[k]}
                  checked={links.includes(k)}
                  onChange={(on) => setLinks((cur) => (on ? LINK_KINDS.filter((l) => l === k || cur.includes(l)) : cur.filter((l) => l !== k)))}
                />
              ))}
            </div>
            <p className="muted small">
              {mode === 'connections' ? 'What the hidden groups may share.' : 'What the four titles that belong together may share.'} Tags are MAL demographics (Shounen, Seinen, Shoujo…).
              Fewer types make {mode === 'connections' ? 'harder boards' : 'easier rounds (you know what to look for)'}, and a small pool may not have enough.
            </p>
          </div>
        )}

        <div className="field">
          <span className="field-label">Difficulty</span>
          <Pick label="Difficulty" options={Object.entries(DIFFICULTY_CHOICES).map(([key, c]) => ({ value: key, label: c.label }))} value={difficulty} onChange={setDifficulty} />
          <p className="muted small pick-hint">{difficultyHint}</p>
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
        <sakuga-button className="start-button" disabled={blocked && !reaction.held} onClick={() => void start()}>
          {busy ? 'Creating puzzle…' : 'Start puzzle'}
          <ArrowIcon />
        </sakuga-button>
      </section>
    </div>
  );
}
