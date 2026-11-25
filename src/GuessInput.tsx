import { useEffect, useMemo, useRef, useState } from 'react';
import { indexNames, searchNames, type CharacterEntry, type SearchEntry, type SearchHit, type TitleEntry } from '../shared/normalize';
import { api, errorMessage } from './api';
import { useButtonReaction } from './sakuga';

/** One download per page load, shared by every puzzle; a failed one is tried again next time. */
function once<T>(fetch: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () =>
    (promise ??= fetch().catch((err: unknown) => {
      promise = null;
      throw err;
    }));
}

const loadTitles = once(() => api.list('titles'));
/** Guess the Anime: only each show's full romaji and English titles, no synonyms, abbreviations or other seasons' names. */
const loadFullTitles = once(() => loadTitles().then((list) => list.map((t) => ({ ...t, names: t.en ? [t.names[0]!, t.en] : [t.names[0]!] }))));
const loadCharacters = once(() => api.list('characters'));

interface PickerProps {
  exclude?: ReadonlySet<number>;
  disabled: boolean;
  /**
   * With its own Guess button: called with the chosen id when it is pressed (or Enter). For a right guess
   * the caller awaits `land()` (the button's check and glint) before showing the new state, which usually
   * ends the round and removes the button.
   */
  onPick?: (id: number, land: () => Promise<void>) => void;
  /** Without a button: told every time the choice changes (null = cleared); a parent button sends it. */
  onChoose?: (id: number | null) => void;
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
  onChoose,
  compact = false,
}: PickerProps & { load: () => Promise<T[]>; detail: (hit: SearchHit<T>) => string; placeholder: (count: number) => string; noneText: string }) {
  const [entries, setEntries] = useState<T[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // A suggestion chosen from the list: it fills the field and waits for the Guess button (or Enter).
  const [selected, setSelected] = useState<T | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<SakugaButtonElement>(null);
  const reaction = useButtonReaction();

  useEffect(() => {
    load().then(setEntries, (err: unknown) => setLoadError(errorMessage(err)));
  }, [load]);

  const index = useMemo(() => (entries ? indexNames(entries) : []), [entries]);
  const results = useMemo(() => (selected ? [] : searchNames(index, query, 8, exclude)), [index, query, exclude, selected]);

  const select = (entry: T | null) => {
    setSelected(entry);
    onChoose?.(entry?.id ?? null);
  };
  const choose = (hit: SearchHit<T> | undefined) => {
    if (!hit) return;
    select(hit.entry);
    // The name that was searched for stays in the field (e.g. a season's title for its show).
    setQuery(hit.name);
    setActive(0);
    input.current?.focus();
  };
  const submit = () => {
    if (!selected || !onPick || disabled) return;
    const el = button.current;
    reaction.pressed();
    onPick(selected.id, () => reaction.landed(el));
    select(null);
    setQuery('');
  };

  if (loadError) return <div className="error-box">Could not load the list: {loadError}</div>;

  return (
    <div className={`guess-input${compact ? ' compact' : ''}`}>
      <div className="guess-row">
        <input
          ref={input}
          autoFocus={!compact}
          value={query}
          disabled={disabled || !entries}
          placeholder={entries ? placeholder(entries.length) : 'Loading…'}
          onChange={(e) => {
            setQuery(e.target.value);
            if (selected) select(null);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, results.length - 1));
            else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
            else if (e.key === 'Enter') {
              if (selected) submit();
              else choose(results[active]);
            } else if (e.key === 'Escape') {
              setQuery('');
              if (selected) select(null);
            } else return;
            e.preventDefault();
          }}
        />
        {onPick && (
          <sakuga-button ref={button} className="guess-button" disabled={!reaction.held && (disabled || !selected)} onClick={submit}>
            Guess
          </sakuga-button>
        )}
      </div>
      {query && !selected && (
        <ul className="suggestions">
          {results.map((hit, i) => (
            <li key={hit.entry.id}>
              <button className={i === active ? 'active' : ''} onMouseEnter={() => setActive(i)} onClick={() => choose(hit)}>
                <span>{hit.name}</span>
                <span className="muted small">{detail(hit)}</span>
              </button>
            </li>
          ))}
          {!results.length && <li className="muted small none">{noneText}</li>}
        </ul>
      )}
    </div>
  );
}

// A hit through another name (a season, a nickname) names the entry it stands for.
const titleDetail = ({ entry: t, name }: SearchHit<TitleEntry>) => (name === t.names[0] ? [t.names[1], t.type?.toUpperCase(), t.year].filter(Boolean).join(' · ') : `→ ${t.names[0]}`);
// Full names only: the other one of the pair (romaji ↔ English) as detail, never an arrow to an alias.
const fullTitleDetail = ({ entry: t, name }: SearchHit<TitleEntry>) => [name === t.names[0] ? t.en : t.names[0], t.type?.toUpperCase(), t.year].filter(Boolean).join(' · ');
const characterDetail = ({ entry: c, name }: SearchHit<CharacterEntry>) => (name === c.names[0] ? (c.names[1] ?? '') : `→ ${c.names[0]}`);

/**
 * Picks an anime (one entry per show) by any of its names, or with `fullNamesOnly` by its full romaji
 * or English title alone (Guess the Anime).
 */
export function GuessInput({ compact, fullNamesOnly = false, ...props }: PickerProps & { fullNamesOnly?: boolean }) {
  return (
    <Autocomplete
      {...props}
      compact={compact}
      load={fullNamesOnly ? loadFullTitles : loadTitles}
      detail={fullNamesOnly ? fullTitleDetail : titleDetail}
      placeholder={(n) => (compact ? 'Which anime?' : `Guess the anime… (${n} titles)`)}
      noneText="No matching title."
    />
  );
}

/** Picks a character by name, kanji or nickname (Character mode). */
export function CharacterInput(props: PickerProps) {
  return <Autocomplete {...props} compact load={loadCharacters} detail={characterDetail} placeholder={() => 'Who is this?'} noneText="No matching character." />;
}
