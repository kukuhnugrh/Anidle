import { PERFECT_SOLVED, type Mode } from '../shared/modes';

const MEDIA_LABELS: Record<string, string> = {
  tv: 'TV', movie: 'Movie', ova: 'OVA', ona: 'ONA', special: 'Special', tv_special: 'TV Special',
};

/** MAL enum values for display: tv → TV, light_novel → Light novel, null → ?. */
export const pretty = (value: string | null) => (value == null ? '?' : MEDIA_LABELS[value] ?? value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));

export const fmtNumber = (n: number) => n.toLocaleString('en-US');

/** Puzzle date "2026-10-25" → "25 October 2026" (the date is already a UTC calendar day). */
export const fmtDate = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** One line for a finished puzzle: Anidle "4 guesses", round modes "2/3 rounds", Character "9/12 characters". */
export function resultText(mode: Mode, solved: number, attempts: number): string {
  if (mode === 'anidle') return solved ? `${attempts} guesses` : 'not solved';
  return `${solved}/${PERFECT_SOLVED[mode]} ${mode === 'character' ? 'characters' : 'rounds'}`;
}
