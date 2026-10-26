import { useEffect, useState, type ComponentType } from 'react';
import { MODES, MODE_LABELS, todayWib, WIB_OFFSET_MS, type Mode } from '../shared/modes';
import { api, type Account, type PuzzleState } from './api';
import { fmtDate } from './format';
import { ArrowIcon, DatabaseIcon, DiscIcon, ImageIcon, MusicIcon, PuzzleIcon, ShuffleIcon, UserIcon, UsersIcon } from './icons';
import { dailyHref } from './route';

const DAY_MS = 86_400_000;

/** The daily puzzle rolls over at 00:00 WIB (UTC+7). */
function Countdown() {
  const left = () => DAY_MS - ((Date.now() + WIB_OFFSET_MS) % DAY_MS);
  const [ms, setMs] = useState(left);
  useEffect(() => {
    const timer = setInterval(() => setMs(left()), 1000);
    return () => clearInterval(timer);
  }, []);
  const s = Math.floor(ms / 1000);
  const text = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
  return <span className="countdown">{text}</span>;
}

const MODE_CARDS: Record<Mode, { Icon: ComponentType; text: string }> = {
  anidle: { Icon: PuzzleIcon, text: 'Guess from clues: year, score, source, studio, genres and tags. 10 guesses.' },
  opening: { Icon: MusicIcon, text: '3 rounds of full openings, one guess each. Stuck? The blurred music video costs half the points.' },
  ending: { Icon: DiscIcon, text: '3 rounds of full endings, one guess each. The clue: the blurred music video and cover.' },
  character: { Icon: UsersIcon, text: '3 rounds of 4 characters from different anime. Pick each name and anime, then one Guess.' },
  screenshot: { Icon: ImageIcon, text: '3 rounds, one screenshot from an opening. Unlock two more screenshots and a title hint if you need them.' },
};

/** A daily puzzle that could not load (e.g. the mode's pool is still empty). */
type DailyResult = PuzzleState | 'unavailable' | null;

function dailyStatus(p: DailyResult): { cta: string; text: string; won?: boolean } {
  if (p === 'unavailable') return { cta: 'Open', text: 'Not available yet' };
  if (!p) return { cta: 'Play', text: '' };
  if (p.mode === 'anidle') {
    if (p.finished) return p.solved ? { cta: 'See result', text: `Solved in ${p.guesses.length} · ${p.score ?? 0} pts`, won: true } : { cta: 'See answer', text: 'Not solved' };
    if (p.guesses.length) return { cta: 'Continue', text: `${p.maxGuesses - p.guesses.length} guesses left` };
    return { cta: 'Play', text: 'Not played yet' };
  }
  if (p.mode === 'character') {
    const right = p.rounds.flatMap((r) => r.slots).filter((s) => s.name.solved && s.anime.solved).length;
    if (p.finished) return { cta: 'See result', text: `${right} characters · ${p.score ?? 0} pts`, won: right > 0 };
    const started = p.current > 0 || p.rounds[0]!.slots.some((s) => s.name.finished || s.anime.finished);
    return started ? { cta: 'Continue', text: `Round ${p.current + 1} of ${p.rounds.length}` } : { cta: 'Play', text: 'Not played yet' };
  }
  const solved = p.rounds.filter((r) => r.solved).length;
  if (p.finished) return { cta: 'See result', text: `${solved}/${p.rounds.length} rounds · ${p.score ?? 0} pts`, won: solved > 0 };
  const first = p.rounds[0]!;
  const started = p.current > 0 || ('clues' in first ? first.clues > 0 : first.clue.opened);
  if (started) return { cta: 'Continue', text: `Round ${p.current + 1} of ${p.rounds.length}` };
  return { cta: 'Play', text: 'Not played yet' };
}

export function Home({ account }: { account: Account | null }) {
  const [daily, setDaily] = useState<Record<Mode, DailyResult>>({ anidle: null, opening: null, ending: null, character: null, screenshot: null });
  useEffect(() => {
    for (const mode of MODES)
      api.daily(mode).then(
        (p) => setDaily((d) => ({ ...d, [mode]: p })),
        () => setDaily((d) => ({ ...d, [mode]: 'unavailable' })),
      );
  }, []);

  return (
    <div className="stack">
      <section className="hero">
        <div className="hero-body">
          <span className="eyebrow">Daily puzzle · {fmtDate(todayWib())}</span>
          <h1>Guess today's anime</h1>
          <p>Five modes, the same puzzle set for everyone. Daily puzzles are always easy or medium titles, so they make a good warm-up.</p>
        </div>
        <div className="hero-clock">
          <span className="eyebrow">New puzzle in</span>
          <Countdown />
          <span className="muted small">every day at 00:00 WIB</span>
        </div>
      </section>

      <div className="daily-grid">
        {MODES.map((mode) => {
          const { Icon, text } = MODE_CARDS[mode];
          const status = dailyStatus(daily[mode]);
          return (
            <a key={mode} className="mode-card" href={dailyHref(mode)}>
              <div className="mode-card-head">
                <span className="tile-icon">
                  <Icon />
                </span>
                {status.text && <span className={`mode-status${status.won ? ' won' : ''}`}>{status.text}</span>}
              </div>
              <h3>{MODE_LABELS[mode]}</h3>
              <p className="muted">{text}</p>
              <span className="mode-cta">
                {status.cta}
                <ArrowIcon />
              </span>
            </a>
          );
        })}
      </div>

      <div className="tiles">
        <a className="tile" href="#/unlimited">
          <span className="tile-icon">
            <ShuffleIcon />
          </span>
          <h3>Unlimited</h3>
          <p className="muted">As many random puzzles as you like in any mode. Set the pool, genre, and difficulty.</p>
        </a>
        <a className="tile" href="#/database">
          <span className="tile-icon">
            <DatabaseIcon />
          </span>
          <h3>Database</h3>
          <p className="muted">Every title that can show up, with genre, studio, and source filters.</p>
        </a>
        <a className="tile" href={account ? '#/akun' : '#/masuk'}>
          <span className="tile-icon">
            <UserIcon />
          </span>
          <h3>{account ? 'Account & MAL' : 'Sign in / Sign up'}</h3>
          <p className="muted">
            {account?.mal
              ? `Linked to ${account.mal.username}, ${account.mal.completed} anime completed.`
              : account
                ? 'Link MAL to unlock pools from your completed list.'
                : 'Save progress across devices and unlock pools from your MAL list.'}
          </p>
        </a>
      </div>
    </div>
  );
}
