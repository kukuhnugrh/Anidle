import { useEffect, useMemo, useState } from 'react';
import { api, errorMessage, type Account, type MalList, type MalListCategory, type MalListEntry } from './api';
import { fmtNumber, pretty } from './format';

const CATEGORIES: Array<{ id: MalListCategory; label: string }> = [
  { id: 'watching', label: 'Watching' },
  { id: 'completed', label: 'Completed' },
  { id: 'on_hold', label: 'On-Hold' },
  { id: 'dropped', label: 'Dropped' },
  { id: 'plan_to_watch', label: 'Plan to Watch' },
];

type SortKey = 'updated' | 'title' | 'score' | 'mean' | 'newest' | 'oldest' | 'progress';
const SORTS: Record<SortKey, string> = {
  updated: 'Last updated',
  title: 'Title A–Z',
  score: 'My score',
  mean: 'MAL score',
  newest: 'Year, newest',
  oldest: 'Year, oldest',
  progress: 'Progress',
};
/** What each category is most often looked at by. */
const DEFAULT_SORT: Record<MalListCategory, SortKey> = { watching: 'updated', completed: 'score', on_hold: 'updated', dropped: 'updated', plan_to_watch: 'mean' };

const AIRING: Record<string, string> = { currently_airing: 'Airing now', finished_airing: 'Finished', not_yet_aired: 'Not yet aired' };

interface View {
  q: string;
  type: string;
  genre: string;
  airing: string;
  sort: SortKey;
}
const freshView = (category: MalListCategory): View => ({ q: '', type: '', genre: '', airing: '', sort: DEFAULT_SORT[category] });

/** Sort choices are remembered per category in this browser; the filters start empty on each visit. */
const SORT_KEY = 'anidle:mylist-sort';
function savedSorts(): Partial<Record<MalListCategory, SortKey>> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SORT_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object') return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string' && Object.hasOwn(SORTS, v)));
  } catch {
    return {};
  }
}

const categoryFromUrl = (): MalListCategory | null => {
  const value = new URLSearchParams(location.search).get('status');
  return CATEGORIES.find((c) => c.id === value)?.id ?? null;
};

const byText = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
const progressOf = (e: MalListEntry) => (e.episodes ? e.watched / e.episodes : e.watched > 0 ? 0.5 : 0);
/** Higher first; entries without the value always go last. */
const desc = (a: number | null, b: number | null) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : b - a);

const COMPARE: Record<SortKey, (a: MalListEntry, b: MalListEntry) => number> = {
  updated: (a, b) => byText(b.updatedAt, a.updatedAt),
  title: (a, b) => byText(a.title, b.title),
  score: (a, b) => desc(a.score || null, b.score || null) || byText(a.title, b.title),
  mean: (a, b) => desc(a.mean, b.mean) || byText(a.title, b.title),
  newest: (a, b) => desc(a.year, b.year) || byText(a.title, b.title),
  oldest: (a, b) => desc(a.year == null ? null : -a.year, b.year == null ? null : -b.year) || byText(a.title, b.title),
  progress: (a, b) => progressOf(b) - progressOf(a) || byText(a.title, b.title),
};

const options = (values: string[]) => [...new Set(values)].sort(byText);

export function MalListPage({ account }: { account: Account | null }) {
  const [list, setList] = useState<MalList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState<MalListCategory | null>(categoryFromUrl);
  const [views, setViews] = useState<Record<MalListCategory, View>>(() => {
    const sorts = savedSorts();
    return Object.fromEntries(CATEGORIES.map(({ id }) => [id, { ...freshView(id), sort: sorts[id] ?? DEFAULT_SORT[id] }])) as Record<MalListCategory, View>;
  });

  const load = (fresh: boolean) => {
    setError(null);
    setRefreshing(fresh);
    api
      .malList(fresh)
      .then(setList, (err: unknown) => setError(errorMessage(err)))
      .finally(() => setRefreshing(false));
  };
  useEffect(() => {
    if (account?.mal) load(false);
  }, [account?.mal]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(CATEGORIES.map(({ id }) => [id, 0])) as Record<MalListCategory, number>;
    for (const e of list?.entries ?? []) c[e.status]++;
    return c;
  }, [list]);
  // Without ?status=, open the first category that has anything (Watching, else Completed, …).
  const active = category ?? CATEGORIES.find(({ id }) => counts[id] > 0)?.id ?? 'watching';
  const view = views[active];
  const setView = (patch: Partial<View>) => {
    setViews((all) => ({ ...all, [active]: { ...all[active], ...patch } }));
    if (patch.sort) {
      try {
        localStorage.setItem(SORT_KEY, JSON.stringify({ ...savedSorts(), [active]: patch.sort }));
      } catch {
        // Not remembered, still applied.
      }
    }
  };
  const pick = (id: MalListCategory) => {
    setCategory(id);
    history.replaceState(null, '', `/mylist?status=${id}`);
  };

  const inCategory = useMemo(() => (list?.entries ?? []).filter((e) => e.status === active), [list, active]);
  const shown = useMemo(() => {
    const q = view.q.trim().toLowerCase();
    return inCategory
      .filter(
        (e) =>
          (!q || e.title.toLowerCase().includes(q) || e.titleEn?.toLowerCase().includes(q)) &&
          (!view.type || e.type === view.type) &&
          (!view.genre || e.genres.includes(view.genre)) &&
          (!view.airing || e.airing === view.airing),
      )
      .sort(COMPARE[view.sort]);
  }, [inCategory, view]);

  if (!account)
    return (
      <div className="stack">
        <Head />
        <div className="empty">
          <p>Sign in with an account that has MyAnimeList linked to see your list.</p>
          <a className="button primary" href="/masuk">
            Sign in
          </a>
        </div>
      </div>
    );
  if (!account.mal)
    return (
      <div className="stack">
        <Head />
        <div className="empty">
          <p>This page shows your MyAnimeList. Link your MAL account first.</p>
          <a className="button primary" href="/akun">
            Link MAL account
          </a>
        </div>
      </div>
    );

  const typeOptions = options(inCategory.flatMap((e) => (e.type ? [e.type] : [])));
  const genreOptions = options(inCategory.flatMap((e) => e.genres));
  const airingOptions = options(inCategory.flatMap((e) => (e.airing ? [e.airing] : [])));

  return (
    <div className="stack mylist">
      <Head username={account.mal.username} fetchedAt={list?.fetchedAt ?? null} refreshing={refreshing} onRefresh={() => load(true)} />

      {error && (
        <div className="error-box">
          {error}{' '}
          <button className="link-button" onClick={() => load(false)}>
            Try again
          </button>
        </div>
      )}
      {!list && !error && (
        <div className="center">
          <span className="spinner" />
        </div>
      )}

      {list && (
        <>
          <div className="tabs-inline" role="tablist" aria-label="List categories">
            {CATEGORIES.map(({ id, label }) => (
              <button key={id} role="tab" aria-selected={id === active} className={id === active ? 'active' : ''} onClick={() => pick(id)}>
                {label} <span className="mylist-count">{fmtNumber(counts[id])}</span>
              </button>
            ))}
          </div>

          <section className="card db-filters" aria-label="Filter and sort">
            <label className="db-search">
              Search titles
              <input value={view.q} onChange={(e) => setView({ q: e.target.value })} placeholder="Romaji or English title" />
            </label>
            <label>
              Sort by
              <select value={view.sort} onChange={(e) => setView({ sort: e.target.value as SortKey })}>
                {Object.entries(SORTS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Type
              <select value={view.type} onChange={(e) => setView({ type: e.target.value })}>
                <option value="">All</option>
                {typeOptions.map((t) => (
                  <option key={t} value={t}>
                    {pretty(t)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Genre
              <select value={view.genre} onChange={(e) => setView({ genre: e.target.value })}>
                <option value="">All</option>
                {genreOptions.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Airing
              <select value={view.airing} onChange={(e) => setView({ airing: e.target.value })}>
                <option value="">All</option>
                {airingOptions.map((a) => (
                  <option key={a} value={a}>
                    {AIRING[a] ?? pretty(a)}
                  </option>
                ))}
              </select>
            </label>
            <button className="ghost" onClick={() => setView({ ...freshView(active), sort: view.sort })}>
              Reset filters
            </button>
          </section>

          <div className="db-status muted small">
            {shown.length === inCategory.length ? `${fmtNumber(inCategory.length)} titles` : `${fmtNumber(shown.length)} of ${fmtNumber(inCategory.length)} titles`}
          </div>

          {shown.length ? (
            <ul className="mylist-rows">
              {shown.map((e) => (
                <ListRow key={e.id} entry={e} />
              ))}
            </ul>
          ) : (
            <p className="empty muted">{inCategory.length ? 'No titles match these filters.' : 'Nothing in this category on your MAL list.'}</p>
          )}
        </>
      )}
    </div>
  );
}

function Head({ username, fetchedAt, refreshing, onRefresh }: { username?: string; fetchedAt?: string | null; refreshing?: boolean; onRefresh?: () => void }) {
  return (
    <header className="page-head mylist-head">
      <div>
        <span className="eyebrow">MyAnimeList{username ? ` · ${username}` : ''}</span>
        <h1>My MAL list</h1>
        <p className="muted">
          Your anime list, read live from MyAnimeList (private entries too).
          {fetchedAt && ` Loaded ${new Date(fetchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`}
        </p>
      </div>
      {username && (
        <div className="actions">
          <button className="ghost" disabled={refreshing} onClick={onRefresh}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <a className="button ghost" href={`https://myanimelist.net/animelist/${encodeURIComponent(username)}`} target="_blank" rel="noreferrer">
            Open on MAL ↗
          </a>
        </div>
      )}
    </header>
  );
}

function ListRow({ entry: e }: { entry: MalListEntry }) {
  const href = `https://myanimelist.net/anime/${e.id}`;
  const season = [e.season ? e.season[0]!.toUpperCase() + e.season.slice(1) : null, e.year].filter(Boolean).join(' ');
  const meta = [pretty(e.type), season, e.studios[0]].filter(Boolean).join(' · ');
  const total = e.episodes;
  return (
    <li className="mylist-row">
      <a className="mylist-cover" href={href} target="_blank" rel="noreferrer" tabIndex={-1}>
        {e.picture && <img src={e.picture} alt="" loading="lazy" />}
      </a>
      <div className="mylist-body">
        <a className="mylist-title" href={href} target="_blank" rel="noreferrer">
          {e.title}
        </a>
        {e.titleEn && <span className="muted small">{e.titleEn}</span>}
        <span className="muted small">
          {meta}
          {e.airing === 'currently_airing' && <span className="mylist-badge">Airing</span>}
          {e.rewatching && <span className="mylist-badge">Rewatching</span>}
        </span>
        {e.genres.length > 0 && (
          <span className="mylist-genres">
            {e.genres.slice(0, 4).map((g) => (
              <span key={g} className="chip">
                {g}
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="mylist-stats">
        <span className="mylist-stat" title="Episodes watched">
          <b>
            {fmtNumber(e.watched)}
            <span className="muted"> / {total ? fmtNumber(total) : '?'}</span>
          </b>
          <span className="mylist-bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.round(progressOf(e) * 100))}%` }} />
          </span>
          <span className="muted small">episodes</span>
        </span>
        <span className="mylist-stat" title="Your score">
          <b>{e.score || '–'}</b>
          <span className="muted small">my score</span>
        </span>
        <span className="mylist-stat" title="MAL community score">
          <b>{e.mean?.toFixed(2) ?? '–'}</b>
          <span className="muted small">MAL</span>
        </span>
      </div>
    </li>
  );
}
