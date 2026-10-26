import { useEffect, useMemo, useRef, useState } from 'react';
import { indexNames, searchNames, type CharacterEntry, type SearchEntry, type TitleEntry } from '../shared/normalize';
import { api, errorMessage } from './api';

/** One download per page load, shared by every puzzle; a failed one is tried again next time. */
function once<T>(fetch: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () =>
    (promise ??= fetch().catch((err: unknown) => {
      promise = null;
      throw err;
    }));
}

const loadTitles = once(api.titles);
const loadCharacters = once(api.characters);

interface PickerProps {
  exclude?: ReadonlySet<number>;
  disabled: boolean;
  onPick: (id: number) => void;
  /** A smaller field without autofocus, for several inputs on one screen (Character mode). */
  compact?: boolean;
}

function Autocomplete<T extends SearchEntry>({
  load,
  detail,
  placeholder,
  noneText,
  exclude,
  disabled,
  onPick,
  compact = false,
}: PickerProps & { load: () => Promise<T[]>; detail: (entry: T) => string; placeholder: (count: number) => string; noneText: string }) {
  const [entries, setEntries] = useState<T[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    load().then(setEntries, (err: unknown) => setLoadError(errorMessage(err)));
  }, [load]);

  const index = useMemo(() => (entries ? indexNames(entries) : []), [entries]);
  const results = useMemo(() => searchNames(index, query, 8, exclude), [index, query, exclude]);

  const pick = (entry: T | undefined) => {
    if (!entry) return;
    setQuery('');
    setActive(0);
    onPick(entry.id);
    input.current?.focus();
  };

  if (loadError) return <div className="error-box">Could not load the list: {loadError}</div>;

  return (
    <div className={`guess-input${compact ? ' compact' : ''}`}>
      <input
        ref={input}
        autoFocus={!compact}
        value={query}
        disabled={disabled || !entries}
        placeholder={entries ? placeholder(entries.length) : 'Loading…'}
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
                <span className="muted small">{detail(entry)}</span>
              </button>
            </li>
          ))}
          {!results.length && <li className="muted small none">{noneText}</li>}
        </ul>
      )}
    </div>
  );
}

const titleDetail = (t: TitleEntry) => [t.names[1], t.type?.toUpperCase(), t.year].filter(Boolean).join(' · ');
const characterDetail = (c: CharacterEntry) => c.names[1] ?? '';

/** Picks an anime (one entry per show) by any of its names. */
export function GuessInput({ compact, ...props }: PickerProps) {
  return (
    <Autocomplete
      {...props}
      compact={compact}
      load={loadTitles}
      detail={titleDetail}
      placeholder={(n) => (compact ? 'Which anime?' : `Guess the anime… (${n} titles)`)}
      noneText="No matching title."
    />
  );
}

/** Picks a character by name, kanji or nickname (Character mode). */
export function CharacterInput(props: PickerProps) {
  return <Autocomplete {...props} compact load={loadCharacters} detail={characterDetail} placeholder={() => 'Who is this?'} noneText="No matching character." />;
}
