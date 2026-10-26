import type { ReactNode } from 'react';
import type { AnswerInfo } from '../server/game';
import type { CharacterState } from './api';
import { fmtNumber } from './format';

const malLink = (answer: { malId: number; title: string }) => (
  <a href={`https://myanimelist.net/anime/${answer.malId}`} target="_blank" rel="noreferrer">
    {answer.title}
  </a>
);

function Mark({ ok }: { ok: boolean }) {
  return (
    <span className={`summary-mark ${ok ? 'ok' : 'bad'}`} aria-label={ok ? 'Right' : 'Wrong'}>
      {ok ? '✓' : '✗'}
    </span>
  );
}

/** What was picked when it is not simply the answer: struck through when wrong, "also right" for another accepted pick. */
function Picked({ picked, solved, same, empty }: { picked: string | undefined; solved: boolean; same: boolean; empty: string }) {
  if (!picked) return <span className="muted">{empty}</span>;
  if (same) return null;
  return solved ? (
    <span className="muted">You: {picked} (also right)</span>
  ) : (
    <span className="muted">
      You: <s className="summary-wrong">{picked}</s>
    </span>
  );
}

export interface SummaryRound {
  answer: AnswerInfo;
  /** Under the title, e.g. the song. */
  detail: string | null;
  guess: { malId: number; title: string } | null;
  solved: boolean;
  gaveUp: boolean;
  /** How the clues were used, e.g. "with the clue" (null = none). */
  clueNote: string | null;
  points: number;
  max: number;
}

/** Opening, Ending, Guess the Anime: every round's answer once the puzzle is over, right or wrong. */
export function RoundsSummary({ rounds }: { rounds: SummaryRound[] }) {
  return (
    <section className="card answers">
      <h2>Answers</h2>
      <ol className="answer-list">
        {rounds.map((r, i) => (
          <li key={i} className={`answer-row ${r.solved ? 'ok' : 'bad'}`}>
            <span className="answer-round">Round {i + 1}</span>
            {r.answer.cover ? <img className="answer-cover" src={r.answer.cover} alt="" loading="lazy" /> : <span className="answer-cover" />}
            <div className="answer-body">
              <span className="answer-line">
                <Mark ok={r.solved} />
                <b>{malLink(r.answer)}</b>
              </span>
              {r.answer.titleEn && <span className="muted small">{r.answer.titleEn}</span>}
              {r.detail && <span className="muted small">{r.detail}</span>}
              <span className="small">
                {r.solved ? (
                  <span className="muted">Right{r.clueNote ? `, ${r.clueNote}` : ''}</span>
                ) : (
                  <Picked picked={r.gaveUp ? undefined : r.guess?.title} solved={false} same={false} empty={r.gaveUp ? 'You gave up' : 'No guess'} />
                )}
              </span>
            </div>
            <span className="answer-points">
              <b>{fmtNumber(r.points)}</b> / {fmtNumber(r.max)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Character: every character's name and anime once the puzzle is over, each marked right or wrong. */
export function CharacterSummary({ puzzle }: { puzzle: CharacterState }) {
  return (
    <section className="card answers">
      <h2>Answers</h2>
      {puzzle.rounds.map((round, ri) => (
        <div key={ri} className="answer-group">
          <h3 className="answer-group-head">
            Round {ri + 1}
            <span className="answer-points">
              <b>{fmtNumber(round.points)}</b> / {fmtNumber(round.max)}
            </span>
          </h3>
          <ol className="answer-list">
            {round.slots.map((slot, i) => {
              if (!slot.answer) return null;
              const both = slot.name.solved && slot.anime.solved;
              const field = (ok: boolean, answer: ReactNode, picked: ReactNode) => (
                <span className="answer-line">
                  <Mark ok={ok} />
                  <span>
                    <b>{answer}</b> {picked}
                  </span>
                </span>
              );
              return (
                <li key={i} className={`answer-row character ${both ? 'ok' : slot.name.solved || slot.anime.solved ? 'half' : 'bad'}`}>
                  <img className="answer-cover portrait" src={slot.portrait} alt="" loading="lazy" />
                  <div className="answer-body">
                    {field(
                      slot.name.solved,
                      slot.answer.name,
                      <Picked picked={slot.name.pick?.name} solved={slot.name.solved} same={slot.name.solved} empty="· not answered" />,
                    )}
                    {field(
                      slot.anime.solved,
                      malLink(slot.answer.anime),
                      <Picked
                        picked={slot.anime.pick?.title}
                        solved={slot.anime.solved}
                        same={slot.anime.pick?.malId === slot.answer.anime.malId}
                        empty="· not answered"
                      />,
                    )}
                  </div>
                  <span className="answer-points">
                    <b>{fmtNumber(slot.name.points + slot.anime.points)}</b> / {fmtNumber(round.fieldPoints * 2)}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </section>
  );
}
