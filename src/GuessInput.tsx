import { useEffect, useMemo, useRef, useState } from 'react';
import { indexTitles, searchTitles, type TitleEntry } from '../shared/normalize';
import { api, errorMessage } from './api';

// One download per page load, shared by every puzzle.
let titlesPromise: Promise<TitleEntry[]> | null = null;
function loadTitles(): Promise<TitleEntry[]> {
  titlesPromise ??= api.titles().catch((err: unknown) => {
    titlesPromise = null;
    throw err;
  });
  return titlesPromise;
}

/** `compact`: a smaller field without autofocus, for several inputs on one screen (Character mode). */
export function GuessInput({ exclude, disabled, onPick, compact = false }: { exclude: ReadonlySet<number>; disabled: boolean; onPick: (malId: number) => void; compact?: boolean }) {
  const [titles, setTitles] = useState<TitleEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadTitles().then(setTitles, (err: unknown) => setLoadError(errorMessage(err)));
  }, []);

  const index = useMemo(() => (titles ? indexTitles(titles) : []), [titles]);
  const results = useMemo(() => searchTitles(index, query, 8, exclude), [index, query, exclude]);

  const pick = (entry: TitleEntry | undefined) => {
    if (!entry) return;
    setQuery('');
    setActive(0);
    onPick(entry.id);
    input.current?.focus();
  };

  if (loadError) return <div className="error-box">Could not load the title list: {loadError}</div>;

  return (
    <div className={`guess-input${compact ? ' compact' : ''}`}>
      <input
        ref={input}
        autoFocus={!compact}
        value={query}
        disabled={disabled || !titles}
        placeholder={!titles ? 'Loading titles…' : compact ? 'Which anime?' : `Guess the anime… (${titles.length} titles)`}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
          else if (e.key === 'Enter') pick(results[active]);
          else if (e.key === 'Escape') setQuery('');
          else return;
          e.preventDefault();
        }}
      />
      {query && (
        <ul className="suggestions">
          {results.map((entry, i) => (
            <li key={entry.id}>
              <button className={i === active ? 'active' : ''} onMouseEnter={() => setActive(i)} onClick={() => pick(entry)}>
                <span>{entry.names[0]}</span>
                <span className="muted small">
                  {[entry.names[1], entry.type?.toUpperCase(), entry.year].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
          {!results.length && <li className="muted small none">No matching title.</li>}
        </ul>
      )}
    </div>
  );
}
