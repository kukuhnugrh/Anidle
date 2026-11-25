import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { groupSkips, type AnidleFeedback, type Direction, type ListClue } from '../shared/anidle';
import { MODE_LABELS, type Mode } from '../shared/modes';
import type { AnidleState, CharacterState, ConnectionsState, HigherLowerState, OddOneOutState, RoundState, SongState, SynopsisState, TimelineState } from './api';
import { fmtDate, fmtNumber } from './format';
import { ShareIcon } from './icons';
import { showToast } from './sakuga';

// Spoiler-free result text, Wordle style: colors only, no titles.

const SITE = 'anidle.velvetaco.dev';

const scalar = (match: boolean) => (match ? '🟩' : '🟥');
const number = (d: Direction) => (d === 'equal' ? '🟩' : d === 'unknown' ? '⬛' : '🟥');
const list = (c: ListClue) => (c.overlap === 'full' ? '🟩' : c.overlap === 'partial' ? '🟨' : '🟥');

/** One row per guess, one square per clue column in table order. */
function anidleRow(g: AnidleFeedback): string {
  return [number(g.year.direction), number(g.score.direction), scalar(g.source.match), list(g.studios), list(g.genres), list(g.tags)].join('');
}

const heading = (mode: Mode, date: string | null, score: number | null) => `${MODE_LABELS[mode]} · ${date ? fmtDate(date) : 'Unlimited'} · ${fmtNumber(score ?? 0)} pts`;

/** One row per guess; a run of skipped tries is one "⏭️ ×n" row. */
export function anidleShareText(p: AnidleState): string {
  const result = p.solved ? `${p.guesses.length}/${p.maxGuesses}` : `X/${p.maxGuesses}`;
  const rows = groupSkips(p.guesses).map((row) => ('skipped' in row ? `⏭️ ×${row.skipped}` : anidleRow(row)));
  return [`${heading(p.mode, p.date, p.score)} (${result})`, ...rows, SITE].join('\n');
}

/** Per round: 🟨 per clue unlocked, 🟥 per wrong guess that left the round open (Synopsis), then 🟩 right, 🟥 wrong or ⬜ gave up. */
export function roundShareText(p: RoundState | SynopsisState): string {
  const rows = p.rounds.map((r, i) => `R${i + 1} ${'🟨'.repeat(r.clues)}${'🟥'.repeat('misses' in r ? r.misses.length : 0)}${r.solved ? '🟩' : r.gaveUp ? '⬜' : '🟥'}`);
  return [heading(p.mode, p.date, p.score), ...rows, SITE].join('\n');
}

/** Per round: 🟩 right, 🟨 right with the clue, 🟥 wrong, ⬜ gave up. */
export function songShareText(p: SongState): string {
  const square = (r: SongState['rounds'][number]) => (r.solved ? (r.clue.opened ? '🟨' : '🟩') : r.gaveUp ? '⬜' : '🟥');
  return [heading(p.mode, p.date, p.score), p.rounds.map(square).join(''), SITE].join('\n');
}

/** Per round, per character: name square then anime square, 🟩 right or 🟥 not. */
export function characterShareText(p: CharacterState): string {
  const rows = p.rounds.map((r, i) => `R${i + 1} ${r.slots.map((s) => `${s.name.solved ? '🟩' : '🟥'}${s.anime.solved ? '🟩' : '🟥'}`).join(' ')}`);
  return [heading(p.mode, p.date, p.score), ...rows, SITE].join('\n');
}

/** Group colours, easiest first (ConnectionsGroup.tier). */
const TIER_SQUARES = ['🟨', '🟩', '🟦', '🟪'];

/** One row per guess, NYT style: each title's square in its group's colour. Only for a finished board (every group known). */
export function connectionsShareText(p: ConnectionsState): string {
  const tierOf = new Map(p.groups.flatMap((g) => g.malIds.map((id) => [id, g.tier] as const)));
  const rows = p.guesses.map((g) => g.malIds.map((id) => TIER_SQUARES[tierOf.get(id) ?? 0]).join(''));
  const result = p.solved ? `${p.mistakes} ${p.mistakes === 1 ? 'mistake' : 'mistakes'}` : 'not solved';
  return [`${heading(p.mode, p.date, p.score)} (${result})`, ...rows, SITE].join('\n');
}

/** The run as one row: 🟩 per right call, 🟥 for the miss that ended it. */
export function higherLowerShareText(p: HigherLowerState): string {
  return [`${heading(p.mode, p.date, p.score)} (${p.streak}/${p.maxSteps})`, p.steps.map((s) => (s.right ? '🟩' : '🟥')).join(''), SITE].join('\n');
}

/** One square per round: 🟩 right pick, 🟥 wrong. */
export function oddOneOutShareText(p: OddOneOutState): string {
  return [heading(p.mode, p.date, p.score), p.rounds.map((r) => (r.solved ? '🟩' : '🟥')).join(''), SITE].join('\n');
}

/** Per round, one square per place: 🟩 the right title there, 🟥 not. */
export function timelineShareText(p: TimelineState): string {
  const rows = p.rounds.map((r, i) => `R${i + 1} ${r.tiles.map((t, at) => (r.answer?.[at] === t.malId ? '🟩' : '🟥')).join('')}`);
  return [heading(p.mode, p.date, p.score), ...rows, SITE].join('\n');
}

/** Native share sheet when there is one (phones), else the clipboard. Resolves to what happened. */
export async function shareText(text: string): Promise<'shared' | 'copied'> {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (err) {
      // Dismissing the sheet is not an error worth showing; anything else falls back to copying.
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
    }
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}

/** Shares, then says so in a toast; a failure stays on the button (the toast always shows a check). */
export function ShareButton({ text }: { text: string }) {
  const [failed, setFailed] = useState(false);
  const toast = useRef<SakugaToastElement>(null);
  const share = () =>
    shareText(text).then(
      (r) => {
        setFailed(false);
        showToast(toast.current, r === 'copied' ? 'Copied to clipboard' : 'Shared');
      },
      () => setFailed(true),
    );
  return (
    <>
      <button onClick={share}>
        <ShareIcon />
        {failed ? 'Could not copy' : 'Share result'}
      </button>
      {createPortal(<sakuga-toast ref={toast} className="share-toast" />, document.body)}
    </>
  );
}
