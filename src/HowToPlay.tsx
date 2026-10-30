import { useRef, type ReactNode } from 'react';
import { ANIDLE_CLUES } from '../shared/anidle';
import { ANIDLE_MAX_GUESSES } from '../shared/catalog';
import { CHARACTER_FIELDS_PER_ROUND } from '../shared/characters';
import { CHARACTERS_PER_ROUND, MODE_LABELS, MODE_MAX_POINTS, ROUND_COUNT, ROUND_MAX_POINTS, SCREENSHOT_CLUE_COST, SONG_CLUE_SHARE, type Mode } from '../shared/modes';
import { fmtNumber } from './format';
import { CloseIcon } from './icons';

const roundPoints = ROUND_MAX_POINTS.map(fmtNumber).join(' / ');
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

const songScoring = (
  <>
    {roundPoints} pts per round when right, {SONG_CLUE_SHARE * 100} % of that with the clue, 0 when wrong.
  </>
);

/** Each mode's rules, built from the same constants the server scores with. */
const HOW_TO: Record<Mode, { rules: ReactNode[]; scoring: ReactNode }> = {
  anidle: {
    rules: [
      <>Guess the anime in {ANIDLE_MAX_GUESSES} tries. Type a title, pick it from the list, then press Guess (or Enter). Any season, movie or remake of the same series counts.</>,
      <>
        Every guess is a row compared with the answer. <b>Year</b> and <b>Score</b> show ↑ or ↓ toward the answer. Each value is a pill:{' '}
        <span className="soft-chip hit">green</span> when the answer has it too, <span className="soft-chip miss">red</span> when it does not.
      </>,
      <>"The answer so far" card sums up everything your guesses have proved: green once a fact is known, amber when you only know part of it (a range, or what it is not).</>,
      <>
        Clues open as your tries add up: after {clueAfter('cover')} tries its blurred poster, after {clueAfter('synopsis')} the synopsis (title hidden), after{' '}
        {clueAfter('characters')} two of its characters.
      </>,
      <>
        Stuck? <b>Skip</b> jumps straight to the next clue, using up the tries in between.
      </>,
    ],
    scoring: (
      <>
        {fmtNumber(MODE_MAX_POINTS)} pts on the first try, {fmtNumber(MODE_MAX_POINTS / ANIDLE_MAX_GUESSES)} less for every extra try (skipped ones count), 0 if you run out.
      </>
    ),
  },
  opening: { rules: songRules('opening'), scoring: songScoring },
  ending: { rules: songRules('ending'), scoring: songScoring },
  screenshot: {
    rules: [
      <>{ROUND_COUNT} rounds, each a screenshot from the opening of a different anime.</>,
      <>Need help? Unlock clues in order: a second screenshot, a third, then the title's first letters (N_____). Opened screenshots stay viewable.</>,
      <>Type a title, pick it from the list, then press Guess. One guess per round; any season, movie or remake of the same series counts.</>,
      <>Give up shows the answer and scores 0.</>,
    ],
    scoring: (
      <>
        {roundPoints} pts per round when right, minus {SCREENSHOT_CLUE_COST * 100} % for every clue you opened, 0 when wrong.
      </>
    ),
  },
  character: {
    rules: [
      <>
        {ROUND_COUNT} rounds of {CHARACTERS_PER_ROUND} characters, each from a different anime. Round 1 has well-known characters, round 2 less known, round 3 obscure ones
        (by their number of MAL fans).
      </>,
      <>For every character pick their name and their anime from the lists. Names are in romaji; nicknames find them too. Any anime the character appears in counts.</>,
      <>Fill what you can, then press Guess once for the whole round. Empty fields count as wrong, and a round can't be guessed again.</>,
      <>Click a portrait to see it larger. After the Guess, each card shows the answers and what else was accepted.</>,
    ],
    scoring: (
      <>
        Every right name or anime is worth 1/{CHARACTER_FIELDS_PER_ROUND} of the round: {ROUND_MAX_POINTS.map((p) => fmtNumber(p / CHARACTER_FIELDS_PER_ROUND)).join(' / ')} pts.
      </>
    ),
  },
};

/** The "?" next to a mode's title: opens its rules in an in-app dialog (Escape, the close button, or a click beside it closes). */
export function HowToPlay({ mode }: { mode: Mode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { rules, scoring } = HOW_TO[mode];
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
          <p className="help-scoring">
            <b>Scoring.</b> {scoring} Max {fmtNumber(MODE_MAX_POINTS)} pts per puzzle.
          </p>
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
