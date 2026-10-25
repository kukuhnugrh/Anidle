import { useEffect, useMemo, useState } from 'react';
import { DIFFICULTIES, DIFFICULTY_LABELS, type Difficulty, type GenreType } from '../shared/catalog';
import { DB_SORTS, type DbFacets, type DbFilters, type DbGenre, type DbItem, type DbPage, type DbSort } from '../shared/database';
import { api, errorMessage } from './api';
import { fmtNumber, pretty } from './format';

// ------------------------------------------------------------------ URL state (#/database?sort=…&genre=…)

function readFilters(): DbFilters {
  const p = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const sort = p.get('sort');
  const difficulty = p.get('difficulty');
  return {
    q: p.get('q') || undefined,
    sort: sort && sort in DB_SORTS ? (sort as DbSort) : 'popularity',
    genres: p.getAll('genre').map(Number).filter((n) => Number.isInteger(n) && n > 0),
    studio: p.get('studio') || undefined,
    source: p.get('source') || undefined,
    type: p.get('type') || undefined,
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
  if (f.type) p.set('type', f.type);
  if (f.difficulty) p.set('difficulty', f.difficulty);
  if (f.page > 1) p.set('page', String(f.page));
  return p.toString();
}

/** The genre select for one category edits only the id of that category in the AND-list. */
type GenreSlot = 'genre' | 'theme' | 'demographic';
const SLOT_TYPES: Record<GenreSlot, GenreType[]> = {
  genre: ['genres', 'explicit_genres'],
  theme: ['themes'],
  demographic: ['demographics'],
};
const slotOf = (type: GenreType): GenreSlot => (type === 'themes' ? 'theme' : type === 'demographics' ? 'demographic' : 'genre');

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
    api.animeFacets().then(setFacets, (err: unknown) => setError(errorMessage(err)));
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
    history.replaceState(null, '', `#/database${query ? `?${query}` : ''}`);
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
        <option value="">Semua</option>
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
    <div className="database">
      <div className="db-head">
        <h2>Database anime</h2>
        <p className="muted small">Semua judul yang bisa keluar di Anidle. Klik genre, theme, demographic, atau studio di kartu untuk memfilter.</p>
      </div>

      <section className="card db-filters">
        <label className="db-search">
          Cari judul
          <input value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Romaji, Inggris, Jepang, atau sinonim" />
        </label>
        <label>
          Urutkan
          <select value={filters.sort} onChange={(e) => update({ sort: e.target.value as DbSort })}>
            {Object.entries(DB_SORTS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {genreSelect('genre', 'Genre')}
        {genreSelect('theme', 'Theme')}
        {genreSelect('demographic', 'Demographic')}
        <label>
          Studio
          <input list="db-studios" value={studioInput} onChange={(e) => setStudioInput(e.target.value)} placeholder="Semua" />
          <datalist id="db-studios">
            {(facets?.studios ?? []).map((s) => (
              <option key={s.name} value={s.name}>{`${fmtNumber(s.count)} judul`}</option>
            ))}
          </datalist>
        </label>
        <label>
          Source
          <select value={filters.source ?? ''} onChange={(e) => update({ source: e.target.value || undefined })}>
            <option value="">Semua</option>
            {(facets?.sources ?? []).map((s) => (
              <option key={s.value} value={s.value}>
                {pretty(s.value)} ({fmtNumber(s.count)})
              </option>
            ))}
          </select>
        </label>
        <label>
          Tipe
          <select value={filters.type ?? ''} onChange={(e) => update({ type: e.target.value || undefined })}>
            <option value="">Semua</option>
            {(facets?.types ?? []).map((t) => (
              <option key={t.value} value={t.value}>
                {pretty(t.value)} ({fmtNumber(t.count)})
              </option>
            ))}
          </select>
        </label>
        <label>
          Difficulty
          <select value={filters.difficulty ?? ''} onChange={(e) => update({ difficulty: (e.target.value || undefined) as Difficulty | undefined })}>
            <option value="">Semua</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY_LABELS[d]}
              </option>
            ))}
          </select>
        </label>
        <button className="ghost" onClick={reset}>
          Reset filter
        </button>
      </section>

      {error && <div className="error-box">{error}</div>}

      <div className="db-status muted small">
        {result ? `${fmtNumber(result.total)} judul` : ''}
        {loading && ' · memuat…'}
      </div>

      <div className={`db-grid${loading ? ' loading' : ''}`}>
        {result?.items.map((item) => (
          <DbCard key={item.malId} item={item} onGenre={pickGenre} onStudio={pickStudio} onSource={(source) => update({ source })} />
        ))}
        {result && !result.items.length && <p className="muted">Tidak ada judul yang cocok dengan filter ini.</p>}
      </div>

      {result && pages > 1 && (
        <div className="db-paging">
          <button disabled={filters.page <= 1} onClick={() => goPage(filters.page - 1)}>
            ← Sebelumnya
          </button>
          <span className="muted">
            Halaman {filters.page} dari {pages}
          </span>
          <button disabled={filters.page >= pages} onClick={() => goPage(filters.page + 1)}>
            Berikutnya →
          </button>
        </div>
      )}
    </div>
  );
}

type CardActions = { onGenre: (g: DbGenre) => void; onStudio: (name: string) => void; onSource: (source: string) => void };

function DbCard({ item, onGenre, onStudio, onSource }: { item: DbItem } & CardActions) {
  const meta = [item.year, item.season ? pretty(item.season) : null, pretty(item.mediaType), item.episodes ? `${item.episodes} eps` : null].filter(Boolean);
  return (
    <article className="db-card">
      <a className="db-cover" href={`https://myanimelist.net/anime/${item.malId}`} target="_blank" rel="noreferrer" title="Buka di MAL">
        {item.cover ? <img src={item.cover} alt="" loading="lazy" /> : <span className="muted small">no image</span>}
        <span className={`difficulty ${item.difficulty}`}>{item.difficulty}</span>
      </a>
      <div className="db-body">
        <a className="db-title" href={`https://myanimelist.net/anime/${item.malId}`} target="_blank" rel="noreferrer">
          {item.title}
        </a>
        {item.titleEn && item.titleEn !== item.title && <div className="muted small">{item.titleEn}</div>}
        <div className="muted small">{meta.join(' · ')}</div>
        <div className="db-stats small">
          {item.score != null && <span>★ {item.score.toFixed(2)}</span>}
          {item.members != null && <span>{fmtNumber(item.members)} member</span>}
          {item.popularityRank != null && <span className="muted">#{item.popularityRank}</span>}
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
