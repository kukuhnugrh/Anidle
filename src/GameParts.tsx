import type { ReactNode } from 'react';
import { POOL_LABELS, type Pool } from '../shared/catalog';
import { MODE_LABELS, MODE_MAX_POINTS, type Mode } from '../shared/modes';
import { BetaBadge } from './BetaBadge';
import { fmtDate, fmtNumber } from './format';
import { HowToPlay } from './HowToPlay';
import { ShareButton } from './share';

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
        <button className="primary" onClick={() => onNewUnlimited().catch((err: unknown) => onError(err instanceof Error ? err.message : String(err)))}>
          Play {MODE_LABELS[mode]} unlimited
        </button>
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
