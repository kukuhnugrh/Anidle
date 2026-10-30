import { useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { ANIDLE_CLUES, groupSkips, summarizeAnidle, type AnidleClueKind, type AnidleFeedback, type Direction, type ListClue, type ListSummary, type RangeSummary, type ScalarSummary } from '../shared/anidle';
import { POOL_LABELS } from '../shared/catalog';
import { api, errorMessage, type AnidleState } from './api';
import { ConfirmButton } from './ConfirmButton';
import { GuessInput } from './GuessInput';
import { HowToPlay } from './HowToPlay';
import { fmtDate, fmtNumber, pretty } from './format';
import { ImageIcon, LockIcon, PuzzleIcon, UsersIcon } from './icons';
import { anidleShareText, ShareButton } from './share';

/** One guessed title with its comparison and its own poster (the guess's, never the answer's). */
type Guess = NonNullable<AnidleState['guesses'][number]>;

const ARROW: Record<Direction, string> = { equal: '', higher: '↑', lower: '↓', unknown: '' };
const DIRECTION_HINT: Record<Direction, string> = {
  equal: 'Same',
  higher: 'The answer is higher',
  lower: 'The answer is lower',
  unknown: 'Unknown',
};

/** match (green ✓), partial (amber ~), wrong (soft red ✗), unknown (plain: MAL has no value). */
type Tone = 'ok' | 'partial' | 'bad' | 'none';
const MARK: Record<Tone, string> = { ok: '✓', partial: '~', bad: '✗', none: '' };
const TONE_TEXT: Record<Tone, string> = { ok: 'match', partial: 'partly', bad: 'wrong', none: 'unknown' };

const BOARD_COLUMNS = ['Year', 'Score', 'Source', 'Studio', 'Genre', 'Tags'] as const;

function Cell({ label, tone, title, children }: { label: string; tone: Tone; title?: string; children: ReactNode }) {
  return (
    <div className={`anidle-cell ${tone}`} data-label={label} title={title ?? `${label}: ${TONE_TEXT[tone]}`}>
      {MARK[tone] && (
        <span className={`cell-mark ${tone}`} aria-label={TONE_TEXT[tone]}>
          {MARK[tone]}
        </span>
      )}
      {children}
    </div>
  );
}

/** Pill colour for one value: green when the answer has it, red when not, plain when MAL has no value. */
const pillTone = (hit: boolean | null) => (hit === null ? '' : hit ? ' hit' : ' miss');

function NumberCell({ label, clue, format }: { label: string; clue: AnidleFeedback['year']; format?: (v: number) => string }) {
  const tone: Tone = clue.direction === 'equal' ? 'ok' : clue.direction === 'unknown' ? 'none' : 'bad';
  return (
    <Cell label={label} tone={tone} title={`${label}: ${DIRECTION_HINT[clue.direction]}`}>
      <span className="anidle-num">
        {clue.value == null ? '?' : <span className={`soft-chip${pillTone(tone === 'none' ? null : tone === 'ok')}`}>{format ? format(clue.value) : clue.value}</span>}
        {ARROW[clue.direction] && <span className="anidle-pill">{ARROW[clue.direction]}</span>}
      </span>
    </Cell>
  );
}

/** A list as soft chips: the items the answer shares green, the others red. */
function ListCell({ label, clue }: { label: string; clue: ListClue }) {
  return (
    <Cell label={label} tone={clue.overlap === 'full' ? 'ok' : clue.overlap === 'partial' ? 'partial' : 'bad'}>
      {clue.items.length === 0 ? (
        <span className="muted">—</span>
      ) : (
        <span className="soft-chips">
          {clue.items.map((item) => (
            <span key={item.name} className={`soft-chip${pillTone(item.hit)}`}>
              {item.name}
            </span>
          ))}
        </span>
      )}
    </Cell>
  );
}

function GuessRow({ g, n }: { g: Guess; n: number }) {
  return (
    <div className={`anidle-row${g.correct ? ' correct' : ''}`}>
      <div className="anidle-row-title">
        <span className="try-no" title={`Try ${n}`}>
          {n}
        </span>
        {g.cover ? <img className="anidle-thumb" src={g.cover} alt="" loading="lazy" /> : <span className="anidle-thumb" />}
        <span>
          {g.correct ? '✓ ' : ''}
          {g.title}
          {g.correct && !g.exact && <span className="muted small"> · same franchise</span>}
        </span>
      </div>
      <NumberCell label="Year" clue={g.year} />
      <NumberCell label="Score" clue={g.score} format={(v) => v.toFixed(2)} />
      <Cell label="Source" tone={g.source.match ? 'ok' : g.source.value == null ? 'none' : 'bad'}>
        {g.source.value == null ? pretty(g.source.value) : <span className={`soft-chip${pillTone(g.source.match)}`}>{pretty(g.source.value)}</span>}
      </Cell>
      <ListCell label="Studio" clue={g.studios} />
      <ListCell label="Genre" clue={g.genres} />
      <ListCell label="Tags" clue={g.tags} />
    </div>
  );
}

/** A range in words: years are inclusive ("2009 or earlier", "between 2013 and 2021"), scores exclusive ("above 7.51"). */
function rangeText(r: RangeSummary, integer: boolean): string | null {
  if (integer) {
    const lo = r.above == null ? null : r.above + 1;
    const hi = r.below == null ? null : r.below - 1;
    if (lo != null && hi != null) return lo === hi ? String(lo) : `between ${lo} and ${hi}`;
    if (lo != null) return `${lo} or later`;
    return hi != null ? `${hi} or earlier` : null;
  }
  if (r.above != null && r.below != null) return `between ${r.above.toFixed(2)} and ${r.below.toFixed(2)}`;
  if (r.above != null) return `above ${r.above.toFixed(2)}`;
  return r.below != null ? `below ${r.below.toFixed(2)}` : null;
}

/**
 * A fact about the answer: known (green), partly known (amber: a range, some items, or what it is not),
 * or still open. Green chips are only ever certain values; a range gets an amber chip.
 */
type FactState = 'known' | 'partly' | 'open';

function Fact({ label, state, yes, range, no }: { label: string; state: FactState; yes: string[]; range?: string | null; no: string[] }) {
  return (
    <div className={`fact ${state}`}>
      <span className="cell-label">{label}</span>
      {state === 'open' ? (
        <span className="fact-open">?</span>
      ) : (
        <>
          {(yes.length > 0 || range) && (
            <span className="soft-chips">
              {yes.map((v) => (
                <span key={v} className="soft-chip hit">
                  {v}
                </span>
              ))}
              {range && <span className="soft-chip maybe">{range}</span>}
            </span>
          )}
          {no.length > 0 && <span className="anidle-not">not {no.join(', ')}</span>}
        </>
      )}
    </div>
  );
}

const rangeFact = (r: RangeSummary, integer: boolean) => {
  if (r.exact != null) return { state: 'known' as FactState, yes: [integer ? String(r.exact) : r.exact.toFixed(2)], no: [] };
  const range = rangeText(r, integer);
  return { state: (range ? 'partly' : 'open') as FactState, yes: [], range, no: [] };
};
const scalarFact = (s: ScalarSummary) =>
  s.known
    ? { state: 'known' as FactState, yes: [pretty(s.known.value)], no: [] }
    : { state: (s.ruledOut.length ? 'partly' : 'open') as FactState, yes: [], no: s.ruledOut.map((v) => pretty(v)) };
const listFact = (s: ListSummary) =>
  s.complete
    ? { state: 'known' as FactState, yes: s.has.length ? s.has : ['none'], no: [] }
    : { state: (s.has.length || s.not.length ? 'partly' : 'open') as FactState, yes: s.has, no: s.not };

/** Its own card above the board: everything the guesses so far proved about the answer. */
function AnswerCard({ guesses }: { guesses: AnidleFeedback[] }) {
  const s = useMemo(() => summarizeAnidle(guesses), [guesses]);
  const facts = [
    { label: 'Year', ...rangeFact(s.year, true) },
    { label: 'Score', ...rangeFact(s.score, false) },
    { label: 'Source', ...scalarFact(s.source) },
    { label: 'Studio', ...listFact(s.studios) },
    { label: 'Genre', ...listFact(s.genres) },
    { label: 'Tags', ...listFact(s.tags) },
  ];
  const known = facts.filter((f) => f.state === 'known').length;
  return (
    <section className="answer-card">
      <span className="answer-mystery" aria-hidden="true">
        ?
      </span>
      <div className="answer-body">
        <div className="answer-head">
          <h2>The answer so far</h2>
          <span className="muted small">
            {known} of {facts.length} pinned down · from {guesses.length} {guesses.length === 1 ? 'guess' : 'guesses'}
          </span>
        </div>
        <div className="answer-facts">
          {facts.map((f) => (
            <Fact key={f.label} {...f} />
          ))}
        </div>
      </div>
    </section>
  );
}

const CLUE_LABELS: Record<AnidleClueKind, string> = { cover: 'Blurred poster', synopsis: 'Synopsis', characters: 'Two of its characters' };
const CLUE_STEP: Record<AnidleClueKind, string> = { cover: 'Poster', synopsis: 'Synopsis', characters: 'Characters' };
const CLUE_ICON: Record<AnidleClueKind, ComponentType> = { cover: ImageIcon, synopsis: PuzzleIcon, characters: UsersIcon };

/** Only the clues already unlocked (the strip above shows when the others open). */
function OpenClues({ puzzle }: { puzzle: AnidleState }) {
  const { clues } = puzzle;
  const open = ANIDLE_CLUES.filter(({ kind }) => kind in clues);
  if (!open.length) return null;
  return (
    <section className="anidle-clues open-clues">
      {open.map(({ kind }) => (
        <div key={kind} className={`anidle-clue ${kind}`}>
          <span className="cell-label">{CLUE_LABELS[kind]}</span>
          {kind === 'cover' &&
            (clues.cover ? (
              <span className="anidle-cover-frame">
                <img className="anidle-cover" src={clues.cover} alt="" />
              </span>
            ) : (
              <span className="muted small">No poster for this one.</span>
            ))}
          {kind === 'synopsis' && <p className="anidle-synopsis">{clues.synopsis ?? 'MAL has no synopsis for this one.'}</p>}
          {kind === 'characters' && clues.characters && (
            <div className="anidle-chars">
              {clues.characters.map((c) => (
                <figure key={c.portrait}>
                  <img src={c.portrait} alt="" />
                  <figcaption>{c.name}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

export function Anidle({ puzzle, onChange, onNewUnlimited }: { puzzle: AnidleState; onChange: (p: AnidleState) => void; onNewUnlimited: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const titled = useMemo(() => puzzle.guesses.filter((g): g is Guess => g !== null), [puzzle.guesses]);
  const guessed = useMemo(() => new Set(titled.map((g) => g.malId)), [titled]);
  const left = puzzle.maxGuesses - puzzle.guesses.length;
  // Skip jumps to the next locked clue, using up the tries in between.
  const nextClue = ANIDLE_CLUES.find((c) => c.after > puzzle.guesses.length);

  const send = async (task: () => Promise<AnidleState>) => {
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

  return (
    <div className="anidle">
      <header className="page-head game-head">
        <div>
          <span className="eyebrow">{puzzle.date ? `Daily · ${fmtDate(puzzle.date)}` : `Unlimited · ${POOL_LABELS[puzzle.pool]}`}</span>
          <div className="title-row">
            <h1>Anidle</h1>
            <HowToPlay mode="anidle" />
          </div>
          <div className="progress" title={puzzle.finished ? 'Finished' : `${left} tries left`}>
            <span className="pips" aria-hidden="true">
              {Array.from({ length: puzzle.maxGuesses }, (_, i) => {
                const g = puzzle.guesses[i];
                return <span key={i} className={`pip${i >= puzzle.guesses.length ? '' : g === null ? ' skipped' : g?.correct ? ' hit' : ' used'}`} />;
              })}
            </span>
            <span className="muted small">{puzzle.finished ? 'finished' : `${left} of ${puzzle.maxGuesses} tries left`}</span>
          </div>
        </div>
      </header>

      {puzzle.finished && puzzle.answer ? (
        <div className={`result ${puzzle.solved ? 'win' : 'lose'}`}>
          {puzzle.answer.cover && <img src={puzzle.answer.cover} alt="" />}
          <div>
            <div className="muted small">{puzzle.solved ? `Solved in ${puzzle.guesses.length} ${puzzle.guesses.length === 1 ? 'try' : 'tries'}` : 'Out of tries. The answer:'}</div>
            <h3>{puzzle.answer.title}</h3>
            {puzzle.answer.titleEn && <div className="answer-en">{puzzle.answer.titleEn}</div>}
            <div className="muted answer-meta">
              {puzzle.answer.year ?? ''}
              <span className={`difficulty ${puzzle.answer.difficulty}`}>{puzzle.answer.difficulty}</span>
              {puzzle.answer.members != null && <span>{puzzle.answer.members.toLocaleString('en-US')} members</span>}
            </div>
            <div className="score">{fmtNumber(puzzle.score ?? 0)} pts</div>
            <div className="actions">
              <ShareButton text={anidleShareText(puzzle)} />
              <a className="button" href={`https://myanimelist.net/anime/${puzzle.answer.malId}`} target="_blank" rel="noreferrer">
                Open on MAL ↗
              </a>
              <button className="primary" onClick={() => onNewUnlimited().catch((err: unknown) => setError(errorMessage(err)))}>
                Play unlimited
              </button>
              <a className="button ghost" href="/">
                Home
              </a>
            </div>
          </div>
        </div>
      ) : (
        <div className="anidle-play">
          <GuessInput exclude={guessed} disabled={sending} onPick={(malId) => void send(() => api.guess(puzzle.id, malId))} />
          <div className="clue-strip">
            <span className="clue-steps">
              <span className="muted">Clues</span>
              {ANIDLE_CLUES.map(({ kind, after }) => {
                const open = kind in puzzle.clues;
                const Icon = open ? CLUE_ICON[kind] : LockIcon;
                return (
                  <span key={kind} className={`clue-step${open ? ' open' : ''}`} title={open ? `${CLUE_LABELS[kind]}: open` : `${CLUE_LABELS[kind]}: opens after ${after} tries`}>
                    <Icon />
                    {CLUE_STEP[kind]}
                    {!open && <span className="clue-step-at">{after}</span>}
                  </span>
                );
              })}
            </span>
            {nextClue && (
              <ConfirmButton
                className="ghost small"
                disabled={sending}
                title={`Skip to the ${CLUE_LABELS[nextClue.kind].toLowerCase()}?`}
                message={`This uses ${nextClue.after - puzzle.guesses.length} of your ${left} tries left without guessing, and opens the ${CLUE_LABELS[nextClue.kind].toLowerCase()}.`}
                confirmLabel="Skip"
                onConfirm={() => void send(() => api.anidleSkip(puzzle.id))}
              >
                Skip to {CLUE_STEP[nextClue.kind].toLowerCase()} (−{nextClue.after - puzzle.guesses.length})
              </ConfirmButton>
            )}
          </div>
        </div>
      )}
      {error && <div className="error-box">{error}</div>}
      <OpenClues puzzle={puzzle} />
      {titled.length > 0 && !puzzle.solved && <AnswerCard guesses={titled} />}

      {puzzle.guesses.length ? (
        <section className="anidle-board">
          <div className="anidle-head" aria-hidden="true">
            <span>Your guesses</span>
            {BOARD_COLUMNS.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          {groupSkips(puzzle.guesses)
            .reverse()
            .map((row, i) =>
              'skipped' in row ? (
                <div key={`skip-${i}`} className="anidle-skip-row">
                  Skipped {row.skipped} {row.skipped === 1 ? 'try' : 'tries'}
                </div>
              ) : (
                <GuessRow key={row.malId} g={row} n={puzzle.guesses.indexOf(row) + 1} />
              ),
            )}
          <div className="anidle-key muted small">
            <span className="cell-mark ok">✓</span> match <span className="cell-mark partial">~</span> partly <span className="cell-mark bad">✗</span> wrong
            <span>↑↓ the answer is higher / lower</span>
          </div>
        </section>
      ) : (
        <p className="empty muted">Type an anime title, pick it from the list, and compare its year, score, studio and genres with the answer.</p>
      )}
    </div>
  );
}
