import { useState } from 'react';
import { SYNOPSIS_CLUE_COST } from '../shared/synopsis';
import { roundMaxPoints } from '../shared/modes';
import { api, errorMessage, type SynopsisState } from './api';
import { RoundsSummary } from './AnswerSummary';
import { ConfirmButton } from './ConfirmButton';
import { fmtNumber } from './format';
import { FinishCard, GameHeader } from './GameParts';
import { GuessInput } from './GuessInput';
import { RoundTitle } from './RoundTitle';
import { roundShareText } from './share';

const clueNote = (clues: number) => (clues ? `with ${clues} more ${clues === 1 ? 'sentence' : 'sentences'}` : null);

export function SynopsisGame({ puzzle, onChange, onNewUnlimited }: { puzzle: SynopsisState; onChange: (p: SynopsisState) => void; onNewUnlimited: () => Promise<void> }) {
  const [roundView, setRoundView] = useState(Math.min(puzzle.current, puzzle.rounds.length - 1));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const round = puzzle.rounds[roundView]!;
  const playing = roundView === puzzle.current && !round.finished;
  const worth = round.max - SYNOPSIS_CLUE_COST * round.clues;

  const send = async (task: () => Promise<SynopsisState>) => {
    setSending(true);
    setError(null);
    try {
      onChange(await task());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="round-game">
      <GameHeader
        puzzle={puzzle}
        intro={`Guess the anime from its MAL synopsis, names hidden. One guess per round (${fmtNumber(roundMaxPoints('synopsis'))} pts); every extra sentence you open takes ${fmtNumber(SYNOPSIS_CLUE_COST)} off.`}
        aside={
          <div className="round-tabs" role="tablist">
            {puzzle.rounds.map((r, i) => (
              <button
                key={i}
                role="tab"
                aria-selected={i === roundView}
                className={`round-tab${i === roundView ? ' active' : ''}${r.finished ? (r.solved ? ' won' : ' lost') : ''}`}
                disabled={i > puzzle.current}
                onClick={() => setRoundView(i)}
              >
                <span>Round {i + 1}</span>
                <b>{r.finished ? fmtNumber(r.points) : i === puzzle.current ? '…' : '—'}</b>
              </button>
            ))}
          </div>
        }
      />

      <RoundTitle round={roundView} difficulties={[round.difficulty]} />

      <section className="card stage-card">
        <ol className="syn-sentences">
          {round.sentences.map((s, i) => (
            <li key={i} className={i > round.clues ? 'extra' : undefined}>
              {s}
            </li>
          ))}
        </ol>
        {playing && (
          <div className="stage-controls">
            {round.clues < round.total - 1 && (
              <button className="ghost" disabled={sending} onClick={() => send(() => api.roundClue<SynopsisState>(puzzle.id, roundView))}>
                Next sentence ({round.total - 1 - round.clues} left) · −{fmtNumber(SYNOPSIS_CLUE_COST)} pts
              </button>
            )}
            <GuessInput disabled={sending} onPick={(malId) => send(() => api.roundGuess<SynopsisState>(puzzle.id, roundView, malId))} />
            <div className="stage-actions">
              <span className="muted small">One guess · right now = {fmtNumber(worth)} pts</span>
              <ConfirmButton
                className="ghost danger"
                disabled={sending}
                danger
                title="Give up this round?"
                message="The answer is shown and the round scores 0."
                confirmLabel="Give up"
                onConfirm={() => send(() => api.roundGiveUp<SynopsisState>(puzzle.id, roundView))}
              >
                Give up
              </ConfirmButton>
            </div>
          </div>
        )}
      </section>

      {error && <div className="error-box">{error}</div>}

      {round.answer && (
        <section className={`result ${round.solved ? 'win' : 'lose'}`}>
          {round.answer.cover && <img src={round.answer.cover} alt="" />}
          <div>
            <div className="muted small">
              {round.solved ? (round.clues ? `Right, ${clueNote(round.clues)}` : 'Right from the first sentence!') : round.gaveUp ? 'You gave up. The answer:' : `Not ${round.guess?.title}. The answer:`}
            </div>
            <h3>{round.answer.title}</h3>
            {round.answer.titleEn && <div className="answer-en">{round.answer.titleEn}</div>}
            <div className="score">{fmtNumber(round.points)} pts</div>
            <div className="actions">
              <a className="button" href={`https://myanimelist.net/anime/${round.answer.malId}`} target="_blank" rel="noreferrer">
                Open on MAL ↗
              </a>
              {roundView < puzzle.current && puzzle.current < puzzle.rounds.length && (
                <button className="primary" onClick={() => setRoundView(puzzle.current)}>
                  Round {puzzle.current + 1}
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {puzzle.finished && (
        <>
          <FinishCard
            mode={puzzle.mode}
            score={puzzle.score}
            detail={`${puzzle.rounds.filter((r) => r.solved).length} of ${puzzle.rounds.length} rounds correct`}
            share={roundShareText(puzzle)}
            onNewUnlimited={onNewUnlimited}
            onError={setError}
          />
          <RoundsSummary
            rounds={puzzle.rounds.flatMap((r) =>
              r.answer ? [{ answer: r.answer, detail: null, guess: r.guess, solved: r.solved, gaveUp: r.gaveUp, clueNote: clueNote(r.clues), points: r.points, max: r.max }] : [],
            )}
          />
        </>
      )}
    </div>
  );
}
