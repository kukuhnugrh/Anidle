import { useRef, type ReactNode } from 'react';
import { ANIDLE_CLUES } from '../shared/anidle';
import { ANIDLE_MAX_GUESSES } from '../shared/catalog';
import { CHARACTERS_PER_ROUND, DAILY_MAX_POINTS, MODE_LABELS, MODE_MAX_POINTS, ROUND_COUNT, type Mode } from '../shared/modes';
import { fmtNumber } from './format';
import { CloseIcon } from './icons';
import { SCORING_RULES } from './scoring';

const clueAfter = (kind: (typeof ANIDLE_CLUES)[number]['kind']) => ANIDLE_CLUES.find((c) => c.kind === kind)!.after;

const songRules = (song: 'opening' | 'ending'): ReactNode[] => [
  <>
    {ROUND_COUNT} rounds, each one {song} of a different anime: any of its {song}s, from any season, movie or OVA. Press play: the whole song plays and you can seek.
  </>,
  <>The round's difficulty is the song's own: how popular the season or movie it comes from is.</>,
  <>Type a title, pick it from the list, then press Guess. You get one guess per round, and any season, movie or remake of the same series counts.</>,
  <>
    Stuck? <b>Show clue</b> plays its music video, blurred and muted, along with the song{song === 'ending' ? ', next to the blurred poster' : ''}. It halves the round's points.
  </>,
  <>Give up shows the answer and scores 0.</>,
];

/** Each mode's rules (its scoring comes from src/scoring.tsx, built from the server's constants). */
const HOW_TO: Record<Mode, ReactNode[]> = {
  anidle: [
    <>Guess the anime in {ANIDLE_MAX_GUESSES} tries. Type a title, pick it from the list, then press Guess (or Enter). Any season, movie or remake of the same series counts.</>,
    <>
      Every guess is a row compared with the answer. <b>Year</b> and <b>Score</b> show ↑ or ↓ toward the answer. Each value is a pill:{' '}
      <span className="soft-chip hit">green</span> when the answer has it too, <span className="soft-chip miss">red</span> when it does not.
    </>,
    <>
      "The answer so far" card sums up everything your guesses have proved: <span className="soft-chip hit">green</span> what the answer has,{' '}
      <span className="soft-chip maybe">amber</span> a range, <span className="soft-chip miss ruled-out">red</span> what it does not have.
    </>,
    <>
      Clues open as your tries add up: after {clueAfter('cover')} tries its blurred poster, after {clueAfter('synopsis')} the synopsis (title hidden), after{' '}
      {clueAfter('characters')} two of its characters.
    </>,
    <>
      Stuck? <b>Skip</b> jumps straight to the next clue, using up the tries in between.
    </>,
  ],
  opening: songRules('opening'),
  ending: songRules('ending'),
  screenshot: [
    <>{ROUND_COUNT} rounds, each a screenshot from the opening of a different anime.</>,
    <>Need help? Unlock clues in order: a second screenshot, a third, then the title's first letters (N_____). Opened screenshots stay viewable.</>,
    <>Type a title (its full romaji or English name), pick it from the list, then press Guess. One guess per round; any season, movie or remake of the same series counts.</>,
    <>Give up shows the answer and scores 0.</>,
  ],
  character: [
    <>
      {ROUND_COUNT} rounds of {CHARACTERS_PER_ROUND} characters, each from a different anime. Round 1 has well-known characters, round 2 less known, round 3 obscure ones
      (by their number of MAL fans).
    </>,
    <>For every character pick their name and their anime from the lists. Names are in romaji; nicknames find them too. Any anime the character appears in counts.</>,
    <>Fill what you can, then press Guess once for the whole round. Empty fields count as wrong, and a round can't be guessed again.</>,
    <>Click a portrait to see it larger. After the Guess, each card shows the answers and what else was accepted.</>,
  ],
};

/** The "?" next to a mode's title: opens its rules in an in-app dialog (Escape, the close button, or a click beside it closes). */
export function HowToPlay({ mode }: { mode: Mode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const rules = HOW_TO[mode];
  return (
    <>
      <button className="help-button" onClick={() => dialog.current?.showModal()} aria-label={`How to play ${MODE_LABELS[mode]}`} title="How to play">
        ?
      </button>
      {/* The box fills the <dialog>, so a click on the element itself landed on the backdrop. */}
      <dialog ref={dialog} className="confirm help" aria-labelledby={`how-to-${mode}`} onClick={(e) => e.target === dialog.current && dialog.current.close()}>
        <div className="confirm-box">
          <div className="help-head">
            <h2 id={`how-to-${mode}`}>How to play {MODE_LABELS[mode]}</h2>
            <button className="icon-button" onClick={() => dialog.current?.close()} aria-label="Close">
              <CloseIcon />
            </button>
          </div>
          <ol className="help-rules">
            {rules.map((rule, i) => (
              <li key={i}>{rule}</li>
            ))}
          </ol>
          <section className="help-scoring">
            <h3>
              How scoring works · max {fmtNumber(MODE_MAX_POINTS[mode])} pts
            </h3>
            <ul>
              {SCORING_RULES[mode].map((rule, i) => (
                <li key={i}>{rule}</li>
              ))}
            </ul>
            <p className="muted small">All five daily puzzles together: {fmtNumber(DAILY_MAX_POINTS)} pts.</p>
          </section>
          <p className="muted small">The daily puzzle is the same for everyone and changes at 00:00 UTC+7.</p>
          <div className="actions">
            <button className="primary" autoFocus onClick={() => dialog.current?.close()}>
              Got it
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
