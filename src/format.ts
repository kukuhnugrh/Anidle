import { PERFECT_SOLVED, type Mode } from '../shared/modes';

const MEDIA_LABELS: Record<string, string> = {
  tv: 'TV', movie: 'Movie', ova: 'OVA', ona: 'ONA', special: 'Special', tv_special: 'TV Special',
};

/** MAL enum values for display: tv → TV, light_novel → Light novel, null → ?. */
export const pretty = (value: string | null) => (value == null ? '?' : MEDIA_LABELS[value] ?? value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));

export const fmtNumber = (n: number) => n.toLocaleString('en-US');

/** Puzzle date "2026-10-25" → "25 October 2026" (a calendar day, formatted as is, whatever the browser's time zone). */
export const fmtDate = (isoDate: string) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const RESULT_UNITS: Record<Exclude<Mode, 'anidle'>, string> = {
  opening: 'rounds',
  ending: 'rounds',
  screenshot: 'rounds',
  character: 'characters',
  connections: 'groups',
  synopsis: 'rounds',
  higherlower: 'in a row',
  oddoneout: 'rounds',
  timeline: 'in place',
};

/** One line for a finished puzzle: Anidle "4 guesses", round modes "2/3 rounds", Character "9/12 characters", Connections "3/4 groups", …. */
export function resultText(mode: Mode, solved: number, attempts: number): string {
  if (mode === 'anidle') return solved ? `${attempts} guesses` : 'not solved';
  return `${solved}/${PERFECT_SOLVED[mode]} ${RESULT_UNITS[mode]}`;
}
