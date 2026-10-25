import { useState } from 'react';
import type { AnidleFeedback, Direction, ListClue } from '../shared/anidle';
import { MODE_LABELS } from '../shared/modes';
import type { AnidleState, CharacterState, RoundState } from './api';
import { fmtDate } from './format';
import { ShareIcon } from './icons';

// Spoiler-free result text, Wordle style: colors only, no titles.

const SITE = 'anidle.velvetaco.dev';

const scalar = (match: boolean) => (match ? '🟩' : '🟥');
const number = (d: Direction) => (d === 'equal' ? '🟩' : d === 'unknown' ? '⬛' : '🟥');
const list = (c: ListClue) => (c.overlap === 'full' ? '🟩' : c.overlap === 'partial' ? '🟨' : '🟥');

/** One row per guess, one square per clue column in table order. */
function anidleRow(g: AnidleFeedback): string {
  return [
    scalar(g.mediaType.match),
    number(g.year.direction),
    scalar(g.season.match),
    number(g.episodes.direction),
    number(g.score.direction),
    scalar(g.source.match),
    list(g.studios),
    list(g.genres),
    list(g.themes),
    list(g.demographics),
  ].join('');
}

const heading = (mode: AnidleState['mode'] | RoundState['mode'] | CharacterState['mode'], date: string | null, score: number | null) =>
  `${MODE_LABELS[mode]} · ${date ? fmtDate(date) : 'Unlimited'} · ${score ?? 0} pts`;

export function anidleShareText(p: AnidleState): string {
  const result = p.solved ? `${p.guesses.length}/${p.maxGuesses}` : `X/${p.maxGuesses}`;
  return [`${heading(p.mode, p.date, p.score)} (${result})`, ...p.guesses.map(anidleRow), SITE].join('\n');
}

/** Per round: ⬜ skip, 🟥 wrong, 🟩 the correct guess. */
export function roundShareText(p: RoundState): string {
  const rows = p.rounds.map((r, i) => `R${i + 1} ${r.attempts.map((a, j) => (!a ? '⬜' : r.solved && j === r.attempts.length - 1 ? '🟩' : '🟥')).join('')}`);
  return [heading(p.mode, p.date, p.score), ...rows, SITE].join('\n');
}

/** Per round, per character: name square then anime square, 🟩 right or 🟥 not. */
export function characterShareText(p: CharacterState): string {
  const rows = p.rounds.map((r, i) => `R${i + 1} ${r.slots.map((s) => `${s.name.solved ? '🟩' : '🟥'}${s.anime.solved ? '🟩' : '🟥'}`).join(' ')}`);
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

export function ShareButton({ text }: { text: string }) {
  const [note, setNote] = useState<string | null>(null);
  const share = () =>
    shareText(text).then(
      (r) => setNote(r === 'copied' ? 'Copied to clipboard' : 'Shared'),
      () => setNote('Could not copy'),
    );
  return (
    <button onClick={share}>
      <ShareIcon />
      {note ?? 'Share result'}
    </button>
  );
}
