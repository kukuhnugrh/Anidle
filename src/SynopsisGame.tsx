import { useState } from 'react';
import { SYNOPSIS_GUESSES, SYNOPSIS_STEP_COST, synopsisClueCount } from '../shared/synopsis';
import { roundMaxPoints } from '../shared/modes';
import { api, errorMessage, type SynopsisState } from './api';
import { RoundsSummary } from './AnswerSummary';
import { ConfirmButton } from './ConfirmButton';
import { fmtNumber } from './format';
import { FinishCard, GameHeader } from './GameParts';
import { GuessInput } from './GuessInput';
import { RoundTitle } from './RoundTitle';
import { TitleHint } from './RoundGame';
import { roundShareText } from './share';

type Round = SynopsisState['rounds'][number];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** How a round's clues and wrong guesses were used, e.g. "with 2 clues and 1 wrong guess" (null = none). */
function clueNote(r: Round): string | null {
  const parts = [r.clues ? plural(r.clues, 'clue', 'clues') : '', r.misses.length ? plural(r.misses.length, 'wrong guess', 'wrong guesses') : ''].filter(Boolean);
  return parts.length ? `with ${parts.join(' and ')}` : null;
}

/** The label of the round's next clue: a sentence, then the facts, then the title's first letters. */
function nextClueLabel(r: Round): string {
  const sentencesLeft = r.total - 1 - r.clues;
  if (sentencesLeft > 0) return `Next sentence (${sentencesLeft} left)`;
  return r.facts ? 'Show the title’s first letters' : 'Show year, studio & genres';
}

/** Titles shown before the rest fold away. */
const ALSO_SHOWN = 6;

/** The other entries a guess counted for (seasons, movies, spin-offs, franchise); a long list folds after ALSO_SHOWN. */
function AlsoAccepted({ titles }: { titles: string[] }) {
  const rest = titles.slice(ALSO_SHOWN);
  return (
    <div className="also-accepted small">
      <span className="muted">Also counted as right: </span>
      {titles.slice(0, ALSO_SHOWN).join(' · ')}
      {rest.length > 0 && (
        <details>
          <summary>+{rest.length} more</summary>
          {rest.join(' · ')}
        </details>
      )}
    </div>
  );
}

export function SynopsisGame({ puzzle, onChange, onNewUnlimited }: { puzzle: SynopsisState; onChange: (p: SynopsisState) => void; onNewUnlimited: () => Promise<void> }) {
  const [roundView, setRoundView] = useState(Math.min(puzzle.current, puzzle.rounds.length - 1));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const round = puzzle.rounds[roundView]!;
  const playing = roundView === puzzle.current && !round.finished;
  const worth = round.max - SYNOPSIS_STEP_COST * (round.clues + round.misses.length);
  const guessesLeft = SYNOPSIS_GUESSES - round.misses.length;

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
        intro={`Guess the anime from its MAL synopsis, names hidden. ${SYNOPSIS_GUESSES} guesses per round (${fmtNumber(roundMaxPoints('synopsis'))} pts); every clue you open and every wrong guess takes ${fmtNumber(SYNOPSIS_STEP_COST)} off.`}
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
        {round.facts && (
          <div className="syn-facts">
            <span className="field-label">Facts</span>
            <span>
              {[round.facts.year ?? 'Year unknown', round.facts.studios.join(', ') || 'Studio unknown', round.facts.genres.join(', ')].filter(Boolean).join(' · ')}
            </span>
          </div>
        )}
        {round.hint && <TitleHint hint={round.hint} />}
        {round.misses.length > 0 && (
          <p className="syn-misses">
            <span className="field-label">Not</span>
            {round.misses.map((m) => (
              <s key={m.malId} className="summary-wrong">
                {m.title}
              </s>
            ))}
          </p>
        )}
        {playing && (
          <div className="stage-controls">
            {round.clues < synopsisClueCount(round.total) && (
              <button className="ghost" disabled={sending} onClick={() => send(() => api.roundClue<SynopsisState>(puzzle.id, roundView))}>
                {nextClueLabel(round)} · −{fmtNumber(SYNOPSIS_STEP_COST)} pts
              </button>
            )}
            <GuessInput disabled={sending} onPick={(malId) => send(() => api.roundGuess<SynopsisState>(puzzle.id, roundView, malId))} />
            <div className="stage-actions">
              <span className="muted small">
                {plural(guessesLeft, 'guess', 'guesses')} left · right now = {fmtNumber(worth)} pts
              </span>
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
              {round.solved
                ? (clueNote(round) ? `Right, ${clueNote(round)}` : 'Right from the first sentence!')
                : round.gaveUp
                  ? 'You gave up. The answer:'
                  : `Not ${round.guess?.title}. Out of guesses; the answer:`}
            </div>
            <h3>{round.answer.title}</h3>
            {round.answer.titleEn && <div className="answer-en">{round.answer.titleEn}</div>}
            {round.alsoAccepted.length > 0 && <AlsoAccepted titles={round.alsoAccepted} />}
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
              r.answer ? [{ answer: r.answer, detail: null, guess: r.guess, solved: r.solved, gaveUp: r.gaveUp, clueNote: clueNote(r), points: r.points, max: r.max }] : [],
            )}
          />
        </>
      )}
    </div>
  );
}
