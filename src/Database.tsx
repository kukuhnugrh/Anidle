import { useEffect, useMemo, useState } from 'react';
import { DIFFICULTIES, DIFFICULTY_LABELS, type Difficulty, type GenreType } from '../shared/catalog';
import { DB_SORTS, type DbFacets, type DbFilters, type DbGenre, type DbItem, type DbPage, type DbSort } from '../shared/database';
import { DB_LIST_KEY } from './AnimeDetail';
import { api, errorMessage } from './api';
import { fmtNumber, pretty } from './format';
import { TextField } from './sakuga';

// ------------------------------------------------------------------ URL state (/database?sort=…&genre=…)

function readFilters(): DbFilters {
  const p = new URLSearchParams(location.search);
  const sort = p.get('sort');
  const difficulty = p.get('difficulty');
  return {
    q: p.get('q') || undefined,
    sort: sort && Object.hasOwn(DB_SORTS, sort) ? (sort as DbSort) : 'popularity',
    genres: p.getAll('genre').map(Number).filter((n) => Number.isInteger(n) && n > 0),
    studio: p.get('studio') || undefined,
    source: p.get('source') || undefined,
    difficulty: difficulty && (DIFFICULTIES as readonly string[]).includes(difficulty) ? (difficulty as Difficulty) : undefined,
    page: Math.max(1, Number(p.get('page')) || 1),
  };
}

function toQuery(f: DbFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.sort !== 'popularity') p.set('sort', f.sort);
  for (const g of f.genres) p.append('genre', String(g));
  if (f.studio) p.set('studio', f.studio);
  if (f.source) p.set('source', f.source);
  if (f.difficulty) p.set('difficulty', f.difficulty);
  if (f.page > 1) p.set('page', String(f.page));
  return p.toString();
}

/** The genre select for one category edits only the id of that category in the AND-list. Tags = MAL themes + demographics. */
type GenreSlot = 'genre' | 'tag';
const SLOT_TYPES: Record<GenreSlot, GenreType[]> = {
  genre: ['genres', 'explicit_genres'],
  tag: ['themes', 'demographics'],
};
const slotOf = (type: GenreType): GenreSlot => (type === 'themes' || type === 'demographics' ? 'tag' : 'genre');

// ------------------------------------------------------------------ page

export function Database() {
  const [filters, setFilters] = useState<DbFilters>(readFilters);
  const [qInput, setQInput] = useState(filters.q ?? '');
  const [studioInput, setStudioInput] = useState(filters.studio ?? '');
  const [facets, setFacets] = useState<DbFacets | null>(null);
  const [result, setResult] = useState<DbPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const update = (patch: Partial<DbFilters>) => setFilters((f) => ({ ...f, ...patch, page: 1 }));

  useEffect(() => {
    api.list('facets').then(setFacets, (err: unknown) => setError(errorMessage(err)));
  }, []);

  // Typing in the search box refetches after a short pause, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => (f.q === (qInput.trim() || undefined) ? f : { ...f, q: qInput.trim() || undefined, page: 1 })), 300);
    return () => clearTimeout(timer);
  }, [qInput]);

  // A studio filter only applies once the input names a real studio (or is cleared).
  useEffect(() => {
    const name = studioInput.trim();
    if (!name) setFilters((f) => (f.studio ? { ...f, studio: undefined, page: 1 } : f));
    else if (facets?.studios.some((s) => s.name === name)) setFilters((f) => (f.studio === name ? f : { ...f, studio: name, page: 1 }));
  }, [studioInput, facets]);

  useEffect(() => {
    const query = toQuery(filters);
    history.replaceState(null, '', `/database${query ? `?${query}` : ''}`);
    sessionStorage.setItem(DB_LIST_KEY, query ? `?${query}` : '');
    let cancelled = false;
    setLoading(true);
    api
      .animeList(query)
      .then(
        (r) => {
          if (cancelled) return;
          setResult(r);
          setError(null);
        },
        (err: unknown) => !cancelled && setError(errorMessage(err)),
      )
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filters]);

  const genresById = useMemo(() => new Map((facets?.genres ?? []).map((g) => [g.id, g])), [facets]);
  const slotValue = (slot: GenreSlot) => filters.genres.find((id) => {
    const g = genresById.get(id);
    return g && slotOf(g.type) === slot;
  });
  const setSlot = (slot: GenreSlot, id: number | undefined) => {
    const keep = filters.genres.filter((g) => {
      const info = genresById.get(g);
      return !info || slotOf(info.type) !== slot;
    });
    update({ genres: id ? [...keep, id] : keep });
  };
  const pickGenre = (g: DbGenre) => setSlot(slotOf(g.type), g.id);
  const pickStudio = (name: string) => setStudioInput(name);

  const reset = () => {
    setQInput('');
    setStudioInput('');
    setFilters({ sort: 'popularity', genres: [], page: 1 });
  };
  const goPage = (page: number) => {
    setFilters((f) => ({ ...f, page }));
    scrollTo({ top: 0, behavior: 'smooth' });
  };

  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const genreSelect = (slot: GenreSlot, label: string) => (
    <label>
      {label}
      <select value={slotValue(slot) ?? ''} onChange={(e) => setSlot(slot, e.target.value ? Number(e.target.value) : undefined)}>
        <option value="">All</option>
        {(facets?.genres ?? [])
          .filter((g) => SLOT_TYPES[slot].includes(g.type))
          .map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({fmtNumber(g.count)})
            </option>
          ))}
      </select>
    </label>
  );

  return (
    <div className="database stack">
      <header className="page-head">
        <span className="eyebrow">Browse</span>
        <h1>Anime database</h1>
        <p className="muted">Every title that can show up in Anidle. Open a card for its songs, characters, and screenshots; click a genre, tag, or studio to filter.</p>
      </header>

      <section className="card db-filters">
        <label className="db-search">
          Search titles
          <TextField label="Search titles" value={qInput} onValue={setQInput} placeholder="Romaji, English, Japanese, or synonym" />
        </label>
        <label>
          Sort by
          <select value={filters.sort} onChange={(e) => update({ sort: e.target.value as DbSort })}>
            {Object.entries(DB_SORTS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {genreSelect('genre', 'Genre')}
        {genreSelect('tag', 'Tags')}
        <label>
          Studio
          <input list="db-studios" value={studioInput} onChange={(e) => setStudioInput(e.target.value)} placeholder="All" />
          <datalist id="db-studios">
            {(facets?.studios ?? []).map((s) => (
              <option key={s.name} value={s.name}>{`${fmtNumber(s.count)} titles`}</option>
            ))}
          </datalist>
        </label>
        <label>
          Source
          <select value={filters.source ?? ''} onChange={(e) => update({ source: e.target.value || undefined })}>
            <option value="">All</option>
            {(facets?.sources ?? []).map((s) => (
              <option key={s.value} value={s.value}>
                {pretty(s.value)} ({fmtNumber(s.count)})
              </option>
            ))}
          </select>
        </label>
        <label>
          Difficulty
          <select value={filters.difficulty ?? ''} onChange={(e) => update({ difficulty: (e.target.value || undefined) as Difficulty | undefined })}>
            <option value="">All</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY_LABELS[d]}
              </option>
            ))}
          </select>
        </label>
        <sakuga-button variant="secondary" onClick={reset}>
          Reset filters
        </sakuga-button>
      </section>

      {error && <div className="error-box">{error}</div>}

      <div className="db-status muted small">
        {result ? `${fmtNumber(result.total)} titles` : ''}
        {loading && ' · loading…'}
      </div>

      <div className={`db-grid${loading ? ' loading' : ''}`}>
        {result?.items.map((item) => (
          <DbCard key={item.malId} item={item} onGenre={pickGenre} onStudio={pickStudio} onSource={(source) => update({ source })} />
        ))}
        {result && !result.items.length && <p className="muted">No titles match these filters.</p>}
      </div>

      {result && pages > 1 && (
        <div className="db-paging">
          <sakuga-button variant="secondary" disabled={filters.page <= 1} onClick={(e) => !e.currentTarget.disabled && goPage(filters.page - 1)}>
            ← Previous
          </sakuga-button>
          <span className="muted">
            Page {filters.page} of {pages}
          </span>
          <sakuga-button variant="secondary" disabled={filters.page >= pages} onClick={(e) => !e.currentTarget.disabled && goPage(filters.page + 1)}>
            Next →
          </sakuga-button>
        </div>
      )}
    </div>
  );
}

type CardActions = { onGenre: (g: DbGenre) => void; onStudio: (name: string) => void; onSource: (source: string) => void };

function DbCard({ item, onGenre, onStudio, onSource }: { item: DbItem } & CardActions) {
  return (
    <article className="db-card">
      <a className="db-cover" href={`/database/${item.malId}`} title="Details">
        {item.cover ? <img src={item.cover} alt="" loading="lazy" /> : <span className="muted small">no image</span>}
        <span className={`difficulty ${item.difficulty}`}>{item.difficulty}</span>
      </a>
      <div className="db-body">
        <a className="db-title" href={`/database/${item.malId}`}>
          {item.title}
        </a>
        {item.titleEn && item.titleEn !== item.title && <div className="muted small">{item.titleEn}</div>}
        {item.year != null && <div className="muted small">{item.year}</div>}
        <div className="db-stats small">
          {item.score != null && <span>★ {item.score.toFixed(2)}</span>}
          {item.members != null && <span>{fmtNumber(item.members)} members</span>}
          {item.popularityRank != null && <span className="muted">#{item.popularityRank}</span>}
          {item.entries > 1 && <span className="muted">{item.entries} entries</span>}
        </div>
        <div className="db-chips">
          {item.studios.map((s) => (
            <button key={s} className="chip studio" onClick={() => onStudio(s)}>
              {s}
            </button>
          ))}
          {item.source && (
            <button className="chip source" onClick={() => onSource(item.source!)}>
              {pretty(item.source)}
            </button>
          )}
          {item.genres.map((g) => (
            <button key={g.id} className={`chip ${slotOf(g.type)}`} onClick={() => onGenre(g)}>
              {g.name}
            </button>
          ))}
        </div>
      </div>
    </article>
  );
}
