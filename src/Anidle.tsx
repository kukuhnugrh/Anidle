import { useMemo, useState } from 'react';
import type { AnidleFeedback, Direction, ListClue } from '../shared/anidle';
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

      <div className="guesses">
        {[...puzzle.guesses].reverse().map((g) => (
          <GuessRow key={g.malId} g={g} />
        ))}
        {!puzzle.guesses.length && <p className="muted center-text">Ketik judul anime, pilih dari daftar, lalu lihat petunjuknya.</p>}
      </div>
    </div>
  );
}
