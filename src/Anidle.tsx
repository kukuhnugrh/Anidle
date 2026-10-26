import { useMemo, useState } from 'react';
import { ANIDLE_CLUES, summarizeAnidle, type AnidleClueKind, type AnidleFeedback, type Direction, type ListClue, type ListSummary, type RangeSummary, type ScalarSummary } from '../shared/anidle';
import { POOL_LABELS } from '../shared/catalog';
import { api, errorMessage, type AnidleState } from './api';
import { GuessInput } from './GuessInput';
import { fmtDate, fmtNumber, pretty } from './format';
import { anidleShareText, ShareButton } from './share';

const ARROW: Record<Direction, string> = { equal: '', higher: '↑', lower: '↓', unknown: '' };
const DIRECTION_HINT: Record<Direction, string> = {
  equal: 'Same',
  higher: 'The answer is higher',
  lower: 'The answer is lower',
  unknown: 'Unknown',
};

function NumberCell({ label, value, direction, format }: { label: string; value: number | null; direction: Direction; format?: (v: number) => string }) {
  const state = direction === 'equal' ? 'ok' : direction === 'unknown' ? 'unknown' : 'bad';
  return (
    <div className={`cell ${state}`} title={`${label}: ${DIRECTION_HINT[direction]}`}>
      <span className="cell-label">{label}</span>
      <span className="cell-value">
        {value == null ? '?' : format ? format(value) : value} <b className="arrow">{ARROW[direction]}</b>
      </span>
    </div>
  );
}

function ScalarCell({ label, value, match }: { label: string; value: string | null; match: boolean }) {
  return (
    <div className={`cell ${match ? 'ok' : 'bad'}`}>
      <span className="cell-label">{label}</span>
      <span className="cell-value">{pretty(value)}</span>
    </div>
  );
}

function ListCell({ label, clue }: { label: string; clue: ListClue }) {
  return (
    <div className={`cell ${clue.overlap === 'full' ? 'ok' : clue.overlap === 'partial' ? 'partial' : 'bad'} list`}>
      <span className="cell-label">{label}</span>
      <span className="chips">
        {clue.items.length === 0 && <span className="chip">—</span>}
        {clue.items.map((item) => (
          <span key={item.name} className={`chip ${item.hit ? 'hit' : ''}`}>
            {item.name}
          </span>
        ))}
      </span>
    </div>
  );
}

function GuessRow({ g }: { g: AnidleFeedback }) {
  return (
    <div className={`guess ${g.correct ? 'correct' : ''}`}>
      <div className="guess-title">
        {g.correct ? '✓ ' : ''}
        {g.title}
        {g.correct && !g.exact && <span className="muted small"> (same franchise as the answer)</span>}
      </div>
      <div className="cells">
        <NumberCell label="Year" value={g.year.value} direction={g.year.direction} />
        <NumberCell label="Score" value={g.score.value} direction={g.score.direction} format={(v) => v.toFixed(2)} />
        <ScalarCell label="Source" value={g.source.value} match={g.source.match} />
        <ListCell label="Studio" clue={g.studios} />
        <ListCell label="Genre" clue={g.genres} />
        <ListCell label="Tags" clue={g.tags} />
      </div>
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

function SummaryValue({ s }: { s: ScalarSummary }) {
  if (s.known) return <span className="chip hit">{pretty(s.known.value)}</span>;
  if (!s.ruledOut.length) return <span className="muted">—</span>;
  return (
    <>
      {s.ruledOut.map((v) => (
        <span key={v} className="chip miss">
          {pretty(v)}
        </span>
      ))}
    </>
  );
}

function SummaryList({ s }: { s: ListSummary }) {
  if (s.complete && !s.has.length) return <span className="chip hit">none</span>;
  if (!s.has.length && !s.not.length) return <span className="muted">—</span>;
  return (
    <>
      {s.has.map((v) => (
        <span key={v} className="chip hit">
          {v}
        </span>
      ))}
      {s.complete && <span className="muted small">(complete)</span>}
      {!s.complete &&
        s.not.map((v) => (
          <span key={v} className="chip miss">
            {v}
          </span>
        ))}
    </>
  );
}

function SummaryPanel({ guesses }: { guesses: AnidleFeedback[] }) {
  const s = useMemo(() => summarizeAnidle(guesses), [guesses]);
  const range = (label: string, r: RangeSummary, integer: boolean) => {
    const text = rangeText(r, integer);
    return (
      <div className="summary-row">
        <span className="cell-label">{label}</span>
        <span className="chips">{text ? <span className={`chip ${r.exact != null ? 'hit' : 'range'}`}>{text}</span> : <span className="muted">—</span>}</span>
      </div>
    );
  };
  const scalar = (label: string, v: ScalarSummary) => (
    <div className="summary-row">
      <span className="cell-label">{label}</span>
      <span className="chips">
        <SummaryValue s={v} />
      </span>
    </div>
  );
  const list = (label: string, v: ListSummary) => (
    <div className="summary-row">
      <span className="cell-label">{label}</span>
      <span className="chips">
        <SummaryList s={v} />
      </span>
    </div>
  );
  return (
    <section className="summary">
      <div className="summary-head">
        <h3>What you know so far</h3>
        <span className="legend small">
          <span className="chip hit">yes</span>
          <span className="chip miss">not</span>
          <span className="chip range">range</span>
        </span>
      </div>
      <div className="summary-grid">
        {range('Year', s.year, true)}
        {range('Score', s.score, false)}
        {scalar('Source', s.source)}
        {list('Studio', s.studios)}
        {list('Genre', s.genres)}
        {list('Tags', s.tags)}
      </div>
    </section>
  );
}

const CLUE_LABELS: Record<AnidleClueKind, string> = { screenshot: 'Blurred screenshot', synopsis: 'Synopsis', characters: 'Two of its characters' };

/** The clues unlocked so far, and when the next ones open (ANIDLE_CLUES). */
function CluePanel({ puzzle }: { puzzle: AnidleState }) {
  const used = puzzle.guesses.length;
  const { clues } = puzzle;
  return (
    <section className="anidle-clues">
      {ANIDLE_CLUES.map(({ kind, after }) => {
        const open = kind in clues;
        return (
          <div key={kind} className={`anidle-clue ${kind}${open ? '' : ' locked'}`}>
            <span className="cell-label">{kind === 'screenshot' && clues.screenshot?.cover ? 'Blurred cover' : CLUE_LABELS[kind]}</span>
            {!open && (
              <span className="muted small">
                Unlocks after {after} guesses ({after - used} more)
              </span>
            )}
            {kind === 'screenshot' && clues.screenshot && <img className="anidle-shot" src={clues.screenshot.url} alt="" />}
            {kind === 'screenshot' && open && !clues.screenshot && <span className="muted small">No image for this one.</span>}
            {kind === 'synopsis' && open && <p className="anidle-synopsis">{clues.synopsis ?? 'MAL has no synopsis for this one.'}</p>}
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
        );
      })}
    </section>
  );
}

export function Anidle({ puzzle, onChange, onNewUnlimited }: { puzzle: AnidleState; onChange: (p: AnidleState) => void; onNewUnlimited: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const guessed = useMemo(() => new Set(puzzle.guesses.map((g) => g.malId)), [puzzle.guesses]);
  const left = puzzle.maxGuesses - puzzle.guesses.length;

  const guess = async (malId: number) => {
    setSending(true);
    setError(null);
    try {
      onChange(await api.guess(puzzle.id, malId));
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
          <h1>Anidle</h1>
          <div className="progress" title={puzzle.finished ? 'Finished' : `${left} guesses left`}>
            <span className="pips" aria-hidden="true">
              {Array.from({ length: puzzle.maxGuesses }, (_, i) => (
                <span key={i} className={`pip${i < puzzle.guesses.length ? (puzzle.guesses[i]!.correct ? ' hit' : ' used') : ''}`} />
              ))}
            </span>
            <span className="muted small">{puzzle.finished ? 'finished' : `${left} of ${puzzle.maxGuesses} guesses left`}</span>
          </div>
        </div>
        <div className="legend small">
          <span className="tag ok">match</span>
          <span className="tag partial">partial</span>
          <span className="tag bad">different</span>
          <span className="muted">↑↓ toward the answer</span>
        </div>
      </header>

      {puzzle.finished && puzzle.answer ? (
        <div className={`result ${puzzle.solved ? 'win' : 'lose'}`}>
          {puzzle.answer.cover && <img src={puzzle.answer.cover} alt="" />}
          <div>
            <div className="muted small">{puzzle.solved ? `Solved in ${puzzle.guesses.length} guesses` : 'Out of guesses. The answer:'}</div>
            <h3>{puzzle.answer.title}</h3>
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
              <a className="button ghost" href="#/">
                Home
              </a>
            </div>
          </div>
        </div>
      ) : (
        <GuessInput exclude={guessed} disabled={sending} onPick={guess} />
      )}
      {error && <div className="error-box">{error}</div>}
      <CluePanel puzzle={puzzle} />
      {puzzle.guesses.length > 0 && !puzzle.solved && <SummaryPanel guesses={puzzle.guesses} />}

      <div className="guesses">
        {[...puzzle.guesses].reverse().map((g) => (
          <GuessRow key={g.malId} g={g} />
        ))}
        {!puzzle.guesses.length && <p className="empty muted">Type an anime title, pick it from the list, then check the clues.</p>}
      </div>
    </div>
  );
}
