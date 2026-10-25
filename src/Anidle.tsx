import { useMemo, useState } from 'react';
import { summarizeAnidle, type AnidleFeedback, type Direction, type ListClue, type ListSummary, type RangeSummary, type ScalarSummary } from '../shared/anidle';
import { POOL_LABELS } from '../shared/catalog';
import { api, errorMessage, type PuzzleState } from './api';
import { GuessInput } from './GuessInput';

const MEDIA_LABELS: Record<string, string> = {
  tv: 'TV', movie: 'Movie', ova: 'OVA', ona: 'ONA', special: 'Special', tv_special: 'TV Special',
};

const pretty = (value: string | null) => (value == null ? '?' : MEDIA_LABELS[value] ?? value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));

const ARROW: Record<Direction, string> = { equal: '', higher: '↑', lower: '↓', unknown: '' };
const DIRECTION_HINT: Record<Direction, string> = {
  equal: 'Sama',
  higher: 'Jawabannya lebih tinggi',
  lower: 'Jawabannya lebih rendah',
  unknown: 'Tidak diketahui',
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
        {g.correct && !g.exact && <span className="muted small"> (satu franchise dengan jawaban)</span>}
      </div>
      <div className="cells">
        <ScalarCell label="Tipe" value={g.mediaType.value} match={g.mediaType.match} />
        <NumberCell label="Tahun" value={g.year.value} direction={g.year.direction} />
        <ScalarCell label="Season" value={g.season.value} match={g.season.match} />
        <NumberCell label="Episode" value={g.episodes.value} direction={g.episodes.direction} />
        <NumberCell label="Skor" value={g.score.value} direction={g.score.direction} format={(v) => v.toFixed(2)} />
        <ScalarCell label="Source" value={g.source.value} match={g.source.match} />
        <ListCell label="Studio" clue={g.studios} />
        <ListCell label="Genre" clue={g.genres} />
        <ListCell label="Theme" clue={g.themes} />
        <ListCell label="Demographic" clue={g.demographics} />
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
  return parts.filter(Boolean).join(' dan ');
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
  if (s.complete && !s.has.length) return <span className="chip hit">tidak ada</span>;
  if (!s.has.length && !s.not.length) return <span className="muted">—</span>;
  return (
    <>
      {s.has.map((v) => (
        <span key={v} className="chip hit">
          {v}
        </span>
      ))}
      {s.complete && <span className="muted small">(lengkap)</span>}
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
        <h3>Yang sudah diketahui</h3>
        <span className="legend small">
          <span className="chip hit">pasti</span>
          <span className="chip miss">pasti bukan</span>
          <span className="chip range">rentang</span>
        </span>
      </div>
      <div className="summary-grid">
        {scalar('Tipe', s.mediaType)}
        {range('Tahun', s.year, true)}
        {scalar('Season', s.season)}
        {range('Episode', s.episodes, true)}
        {range('Skor', s.score, false)}
        {scalar('Source', s.source)}
        {list('Studio', s.studios)}
        {list('Genre', s.genres)}
        {list('Theme', s.themes)}
        {list('Demographic', s.demographics)}
      </div>
    </section>
  );
}

export function Anidle({ puzzle, onChange, onNewUnlimited }: { puzzle: PuzzleState; onChange: (p: PuzzleState) => void; onNewUnlimited: () => Promise<void> }) {
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
      <div className="game-head">
        <div>
          <h2>{puzzle.date ? `Anidle ${puzzle.date}` : 'Anidle unlimited'}</h2>
          <p className="muted small">
            Pool: {POOL_LABELS[puzzle.pool]} · {puzzle.finished ? 'selesai' : `sisa ${left} tebakan`}
          </p>
        </div>
        <div className="legend small">
          <span className="cell ok">cocok</span>
          <span className="cell partial">sebagian</span>
          <span className="cell bad">beda</span>
          <span className="muted">↑↓ arah jawaban</span>
        </div>
      </div>

      {puzzle.finished && puzzle.answer ? (
        <div className={`result ${puzzle.solved ? 'win' : 'lose'}`}>
          {puzzle.answer.cover && <img src={puzzle.answer.cover} alt="" />}
          <div>
            <div className="muted small">{puzzle.solved ? `Benar dalam ${puzzle.guesses.length} tebakan` : 'Tebakan habis. Jawabannya:'}</div>
            <h3>{puzzle.answer.title}</h3>
            <div className="muted">{puzzle.answer.year ?? ''}</div>
            <div className="score">{puzzle.score ?? 0} poin</div>
            <div className="actions">
              <a className="button" href={`https://myanimelist.net/anime/${puzzle.answer.malId}`} target="_blank" rel="noreferrer">
                Buka di MAL ↗
              </a>
              <button className="primary" onClick={() => onNewUnlimited().catch((err: unknown) => setError(errorMessage(err)))}>
                Main unlimited
              </button>
              <a className="button ghost" href="#/">
                Beranda
              </a>
            </div>
          </div>
        </div>
      ) : (
        <GuessInput exclude={guessed} disabled={sending} onPick={guess} />
      )}
      {error && <div className="error-box">{error}</div>}
      {puzzle.guesses.length > 0 && !puzzle.solved && <SummaryPanel guesses={puzzle.guesses} />}

      <div className="guesses">
        {[...puzzle.guesses].reverse().map((g) => (
          <GuessRow key={g.malId} g={g} />
        ))}
        {!puzzle.guesses.length && <p className="muted center-text">Ketik judul anime, pilih dari daftar, lalu lihat petunjuknya.</p>}
      </div>
    </div>
  );
}
