import { useState } from 'react';
import { HIGHER_LOWER_POINT, type HigherLowerPick } from '../shared/higherlower';
import { api, errorMessage, type HigherLowerState } from './api';
import { fmtNumber } from './format';
import { FinishCard, GameHeader } from './GameParts';
import { useButtonReaction } from './sakuga';
import { higherLowerShareText } from './share';

type Card = HigherLowerState['cards'][number];

function ScoreCard({ card, side }: { card: Card; side: 'left' | 'right' }) {
  return (
    <div className={`hl-card ${side}`}>
      {card.cover ? <img src={card.cover} alt="" /> : <span className="hl-nocover" />}
      <div className="hl-body">
        <b>{card.title}</b>
        {card.titleEn && <span className="muted small">{card.titleEn}</span>}
        <span className="hl-score">{card.score == null ? '?' : card.score.toFixed(2)}</span>
        <span className="muted small">MAL score</span>
      </div>
    </div>
  );
}

export function HigherLowerGame({ puzzle, onChange, onNewUnlimited }: { puzzle: HigherLowerState; onChange: (p: HigherLowerState) => void; onNewUnlimited: () => Promise<void> }) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reaction = useButtonReaction();
  const [left, right] = puzzle.cards.slice(-2) as [Card, Card];
  const last = puzzle.steps.at(-1);

  /** `button` lands its check when the call was right. */
  const pick = async (p: HigherLowerPick, button: SakugaButtonElement) => {
    if (sending) return;
    reaction.pressed();
    setSending(true);
    setError(null);
    try {
      const next = await api.higherLowerPick(puzzle.id, p);
      if (next.steps.at(-1)?.right) {
        const beat = reaction.landed(button);
        // A perfect run ends here and its verdict replaces the buttons: let the check land first.
        if (next.finished) await beat;
      }
      onChange(next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="round-game big-game">
      <GameHeader
        puzzle={puzzle}
        intro={`Does the next anime have a higher or lower MAL score? ${fmtNumber(HIGHER_LOWER_POINT)} pts per right call; the first miss ends the run.`}
        aside={
          <div className="hl-streak">
            <span className="muted small">Streak</span>
            <b>
              {puzzle.streak}
              <span className="muted"> / {puzzle.maxSteps}</span>
            </b>
          </div>
        }
      />

      <section className="card hl-stage">
        <ScoreCard card={left} side="left" />
        <div className="hl-middle">
          {!puzzle.finished ? (
            <>
              <sakuga-button disabled={sending && !reaction.held} onClick={(e) => void pick('higher', e.currentTarget)}>
                ▲ Higher
              </sakuga-button>
              <span className="muted small">than {left.score?.toFixed(2)}</span>
              <sakuga-button disabled={sending && !reaction.held} onClick={(e) => void pick('lower', e.currentTarget)}>
                ▼ Lower
              </sakuga-button>
            </>
          ) : (
            <span className={`hl-verdict ${last?.right ? 'win' : 'lose'}`}>{last?.right ? 'Perfect run!' : `Not ${last?.pick}`}</span>
          )}
        </div>
        <ScoreCard card={right} side="right" />
      </section>
      {!puzzle.finished && last && <p className="muted small hl-last">Right! {puzzle.cards.at(-2)!.title} scores {puzzle.cards.at(-2)!.score?.toFixed(2)}.</p>}

      {error && <div className="error-box">{error}</div>}

      {puzzle.finished && (
        <FinishCard
          mode={puzzle.mode}
          eyebrow={puzzle.streak === puzzle.maxSteps ? 'Perfect run' : 'Run over'}
          score={puzzle.score}
          detail={`${puzzle.streak} right in a row`}
          share={higherLowerShareText(puzzle)}
          onNewUnlimited={onNewUnlimited}
          onError={setError}
        />
      )}
    </div>
  );
}
