import { useEffect, useState, type ComponentType } from 'react';
import { MODES, MODE_LABELS, todayWib, WIB_OFFSET_MS, type Mode } from '../shared/modes';
import { api, type Account, type PuzzleState } from './api';
import { fmtDate } from './format';
import { ArrowIcon, DatabaseIcon, DiscIcon, MusicIcon, PuzzleIcon, ShuffleIcon, UserIcon } from './icons';
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
  anidle: { Icon: PuzzleIcon, text: 'Tebak dari petunjuk tahun, skor, studio, genre, theme, dan demographic. 10 tebakan.' },
  opening: { Icon: MusicIcon, text: '3 ronde opening. Potongan lagu makin panjang tiap tebakan salah: 1, 3, 6, 12, 30 detik.' },
  ending: { Icon: DiscIcon, text: '3 ronde ending, aturan sama dengan Opening. Biasanya lebih susah.' },
};

/** A daily puzzle that could not load (e.g. the song pool is still empty). */
type DailyResult = PuzzleState | 'unavailable' | null;

function dailyStatus(p: DailyResult): { cta: string; text: string; won?: boolean } {
  if (p === 'unavailable') return { cta: 'Buka', text: 'Belum tersedia' };
  if (!p) return { cta: 'Main', text: '' };
  if (p.mode === 'anidle') {
    if (p.finished) return p.solved ? { cta: 'Lihat hasil', text: `Benar dalam ${p.guesses.length} tebakan · ${p.score ?? 0} poin`, won: true } : { cta: 'Lihat jawaban', text: 'Belum berhasil' };
    if (p.guesses.length) return { cta: 'Lanjutkan', text: `Sisa ${p.maxGuesses - p.guesses.length} tebakan` };
    return { cta: 'Main', text: 'Belum dimainkan' };
  }
  const solved = p.rounds.filter((r) => r.solved).length;
  if (p.finished) return { cta: 'Lihat hasil', text: `${solved}/${p.rounds.length} ronde · ${p.score ?? 0} poin`, won: solved > 0 };
  if (p.current > 0 || p.rounds[0]!.attempts.length) return { cta: 'Lanjutkan', text: `Ronde ${p.current + 1} dari ${p.rounds.length}` };
  return { cta: 'Main', text: 'Belum dimainkan' };
}

export function Home({ account }: { account: Account | null }) {
  const [daily, setDaily] = useState<Record<Mode, DailyResult>>({ anidle: null, opening: null, ending: null });
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
          <span className="eyebrow">Puzzle harian · {fmtDate(todayWib())}</span>
          <h1>Tebak anime hari ini</h1>
          <p>Tiga mode, satu set puzzle yang sama untuk semua orang. Puzzle harian selalu judul easy atau medium, jadi aman buat pemanasan.</p>
        </div>
        <div className="hero-clock">
          <span className="eyebrow">Puzzle baru dalam</span>
          <Countdown />
          <span className="muted small">setiap 00:00 WIB</span>
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
          <p className="muted">Puzzle acak sebanyak yang kamu mau di mode mana pun. Atur pool, genre, dan difficulty.</p>
        </a>
        <a className="tile" href="#/database">
          <span className="tile-icon">
            <DatabaseIcon />
          </span>
          <h3>Database</h3>
          <p className="muted">Semua judul yang bisa keluar, lengkap dengan filter genre, studio, dan source.</p>
        </a>
        <a className="tile" href={account ? '#/akun' : '#/masuk'}>
          <span className="tile-icon">
            <UserIcon />
          </span>
          <h3>{account ? 'Akun & MAL' : 'Masuk / Daftar'}</h3>
          <p className="muted">
            {account?.mal
              ? `Terhubung ke ${account.mal.username}, ${account.mal.completed} anime completed.`
              : account
                ? 'Hubungkan MAL untuk membuka pool dari list completed.'
                : 'Simpan progres di semua perangkat dan buka pool dari list MAL.'}
          </p>
        </a>
      </div>
    </div>
  );
}
