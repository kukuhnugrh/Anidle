import type { ReactNode } from 'react';
import { POOL_LABELS, type Pool } from '../shared/catalog';
import { MODE_LABELS, MODE_MAX_POINTS, type Mode } from '../shared/modes';
import { BetaBadge } from './BetaBadge';
import { fmtDate, fmtNumber } from './format';
import { HowToPlay } from './HowToPlay';
import { Tabs } from './sakuga';
import { ShareButton } from './share';

/** How a round ended, as its tab shows it: won ✓, lost ✗, or null (still open, or neither, e.g. a part-right Timeline round). */
export type RoundMark = 'won' | 'lost' | null;
const MARK_TEXT: Record<'won' | 'lost', string> = { won: ' ✓', lost: ' ✗' };

/** The round tabs' options: "Round 1 ✓", "Round 2 ✗", "Round 3" (`compact`: "1 ✓"), up to the current round only. */
export function roundTabOptions(marks: RoundMark[], current: number, compact: boolean) {
  return marks.slice(0, current + 1).map((mark, i) => ({ value: String(i), label: `${compact ? '' : 'Round '}${i + 1}${mark ? MARK_TEXT[mark] : ''}` }));
}

/** A puzzle's round tabs (see roundTabOptions); `marks` has one entry per round of the puzzle. */
export function RoundTabs({ marks, current, view, onView, compact = false }: { marks: RoundMark[]; current: number; view: number; onView: (round: number) => void; compact?: boolean }) {
  return <Tabs label="Rounds" options={roundTabOptions(marks, current, compact)} value={String(view)} onChange={(v) => onView(Number(v))} />;
}

/** A puzzle page's head: daily date or unlimited pool, the mode's name (Beta badge, "?" rules), a one-line intro, and `aside` on the right. */
export function GameHeader({ puzzle, intro, aside }: { puzzle: { mode: Mode; date: string | null; pool: Pool }; intro: ReactNode; aside?: ReactNode }) {
  return (
    <header className="page-head game-head">
      <div>
        <span className="eyebrow">{puzzle.date ? `Daily · ${fmtDate(puzzle.date)}` : `Unlimited · ${POOL_LABELS[puzzle.pool]}`}</span>
        <div className="title-row">
          <h1>{MODE_LABELS[puzzle.mode]}</h1>
          <BetaBadge mode={puzzle.mode} />
          <HowToPlay mode={puzzle.mode} />
        </div>
        <p className="muted small">{intro}</p>
      </div>
      {aside}
    </header>
  );
}

/** The end of a puzzle: points, a one-line result, Share, another unlimited puzzle of the mode, Home. */
export function FinishCard({
  mode,
  eyebrow = 'Finished',
  score,
  detail,
  share,
  onNewUnlimited,
  onError,
}: {
  mode: Mode;
  eyebrow?: string;
  score: number | null;
  detail: string;
  share: string;
  onNewUnlimited: () => Promise<void>;
  onError: (message: string) => void;
}) {
  return (
    <section className="card final">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{fmtNumber(score ?? 0)} pts</h2>
        <p className="muted small">
          {detail} · max {fmtNumber(MODE_MAX_POINTS[mode])} pts
        </p>
      </div>
      <div className="actions">
        <ShareButton text={share} />
        <sakuga-button onClick={() => onNewUnlimited().catch((err: unknown) => onError(err instanceof Error ? err.message : String(err)))}>Play {MODE_LABELS[mode]} unlimited</sakuga-button>
        <a className="button ghost" href="/">
          Home
        </a>
      </div>
    </section>
  );
}

/** A title on a beta mode's board: poster thumb, romaji title, English title. Rendered inside the caller's button or row. */
export function TitleThumb({ title }: { title: { title: string; titleEn: string | null; cover: string | null } }) {
  return (
    <>
      {title.cover ? <img className="thumb" src={title.cover} alt="" /> : <span className="thumb" />}
      <span className="cx-names">
        <b>{title.title}</b>
        {title.titleEn && <span>{title.titleEn}</span>}
      </span>
    </>
  );
}
