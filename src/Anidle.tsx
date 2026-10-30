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

/** match = pale green, partial = pale amber, different/unknown = plain: most cells miss, so misses stay quiet. */
type Tone = 'ok' | 'partial' | 'none';

const BOARD_COLUMNS = ['Year', 'Score', 'Source', 'Studio', 'Genre', 'Tags'] as const;

function Cell({ label, tone, title, children }: { label: string; tone: Tone; title?: string; children: ReactNode }) {
  return (
    <div className={`anidle-cell ${tone}`} data-label={label} title={title}>
      {children}
    </div>
  );
}

function NumberCell({ label, clue, format }: { label: string; clue: AnidleFeedback['year']; format?: (v: number) => string }) {
  return (
    <Cell label={label} tone={clue.direction === 'equal' ? 'ok' : 'none'} title={`${label}: ${DIRECTION_HINT[clue.direction]}`}>
      {clue.value == null ? '?' : format ? format(clue.value) : clue.value}
      {clue.direction === 'equal' && <span className="anidle-pill ok">✓</span>}
      {ARROW[clue.direction] && <span className="anidle-pill">{ARROW[clue.direction]}</span>}
    </Cell>
  );
}

/** A list as soft chips; the items the answer shares are filled. */
function ListCell({ label, clue }: { label: string; clue: ListClue }) {
  return (
    <Cell label={label} tone={clue.overlap === 'full' ? 'ok' : clue.overlap === 'partial' ? 'partial' : 'none'}>
      {clue.items.length === 0 ? (
        <span className="muted">—</span>
      ) : (
        <span className="soft-chips">
          {clue.items.map((item) => (
            <span key={item.name} className={`soft-chip${item.hit ? ' hit' : ''}`}>
              {item.name}
            </span>
          ))}
        </span>
      )}
    </Cell>
  );
}

function GuessRow({ g }: { g: Guess }) {
  return (
    <div className={`anidle-row${g.correct ? ' correct' : ''}`}>
      <div className="anidle-row-title">
        {g.cover ? <img className="anidle-thumb" src={g.cover} alt="" loading="lazy" /> : <span className="anidle-thumb" />}
        <span>
          {g.correct ? '✓ ' : ''}
          {g.title}
          {g.correct && !g.exact && <span className="muted small"> · same franchise</span>}
        </span>
      </div>
      <NumberCell label="Year" clue={g.year} />
      <NumberCell label="Score" clue={g.score} format={(v) => v.toFixed(2)} />
      <Cell label="Source" tone={g.source.match ? 'ok' : 'none'}>
        {pretty(g.source.value)}
      </Cell>
      <ListCell label="Studio" clue={g.studios} />
      <ListCell label="Genre" clue={g.genres} />
      <ListCell label="Tags" clue={g.tags} />
    </div>
  );
}

/** Integer ranges read as inclusive bounds ("2014–2022"); scores stay exclusive ("> 8.58"). */
function rangeText(r: RangeSummary, integer: boolean): string | null {
  if (r.exact != null) return integer ? String(r.exact) : r.exact.toFixed(2);
  if (r.above == null && r.below == null) return null;
  if (integer) {
    const lo = r.above == null ? null : r.above + 1;
    const hi = r.below == null ? null : r.below - 1;
    if (lo != null && hi != null) return lo === hi ? String(lo) : `${lo}–${hi}`;
    return lo != null ? `≥ ${lo}` : `≤ ${hi}`;
  }
  const parts = [r.above != null ? `> ${r.above.toFixed(2)}` : null, r.below != null ? `< ${r.below.toFixed(2)}` : null];
  return parts.filter(Boolean).join(' and ');
}

/** What is known, then what is ruled out (quiet "not …" line). */
function Known({ yes, no }: { yes: string[]; no: string[] }) {
  if (!yes.length && !no.length) return <span className="muted">—</span>;
  return (
    <>
      {yes.length > 0 && (
        <span className="soft-chips">
          {yes.map((v) => (
            <span key={v} className="soft-chip hit">
              {v}
            </span>
          ))}
        </span>
      )}
      {no.length > 0 && <span className="anidle-not">not {no.join(', ')}</span>}
    </>
  );
}

const knownList = (s: ListSummary) => (s.complete && !s.has.length ? { yes: ['none'], no: [] } : { yes: s.has, no: s.complete ? [] : s.not });
const knownScalar = (s: ScalarSummary) => (s.known ? { yes: [pretty(s.known.value)], no: [] } : { yes: [], no: s.ruledOut.map((v) => pretty(v)) });

/** The board's first row: everything the guesses so far proved about the answer. */
function KnownRow({ guesses }: { guesses: AnidleFeedback[] }) {
  const s = useMemo(() => summarizeAnidle(guesses), [guesses]);
  const range = (label: string, r: RangeSummary, integer: boolean) => {
    const text = rangeText(r, integer);
    return (
      <Cell label={label} tone="none">
        <Known yes={text ? [text] : []} no={[]} />
      </Cell>
    );
  };
  return (
    <div className="anidle-row known">
      <div className="anidle-row-title">
        <span className="anidle-thumb mystery" aria-hidden="true">
          ?
        </span>
        <span>
          Answer <span className="muted small">so far</span>
        </span>
      </div>
      {range('Year', s.year, true)}
      {range('Score', s.score, false)}
      <Cell label="Source" tone="none">
        <Known {...knownScalar(s.source)} />
      </Cell>
      <Cell label="Studio" tone="none">
        <Known {...knownList(s.studios)} />
      </Cell>
      <Cell label="Genre" tone="none">
        <Known {...knownList(s.genres)} />
      </Cell>
      <Cell label="Tags" tone="none">
        <Known {...knownList(s.tags)} />
      </Cell>
    </div>
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

      {puzzle.guesses.length ? (
        <section className="anidle-board">
          <div className="anidle-head" aria-hidden="true">
            <span>Guess</span>
            {BOARD_COLUMNS.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          {titled.length > 0 && !puzzle.solved && <KnownRow guesses={titled} />}
          {groupSkips(puzzle.guesses)
            .reverse()
            .map((row, i) =>
              'skipped' in row ? (
                <div key={`skip-${i}`} className="anidle-skip-row">
                  Skipped {row.skipped} {row.skipped === 1 ? 'try' : 'tries'}
                </div>
              ) : (
                <GuessRow key={row.malId} g={row} />
              ),
            )}
          <div className="anidle-key muted small">
            <span className="tone-swatch ok" /> match <span className="tone-swatch partial" /> partly <span>↑↓ the answer is higher / lower</span>
          </div>
        </section>
      ) : (
        <p className="empty muted">Type an anime title, pick it from the list, and compare its year, score, studio and genres with the answer.</p>
      )}
    </div>
  );
}
