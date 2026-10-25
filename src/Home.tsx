import { useEffect, useState } from 'react';
import { api, type Account, type PuzzleState } from './api';
import { fmtDate } from './format';
import { ArrowIcon, DatabaseIcon, ShuffleIcon, UserIcon } from './icons';

const DAY_MS = 86_400_000;
const WIB_OFFSET_MS = 7 * 3_600_000;

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

function dailyStatus(p: PuzzleState | null): { cta: string; text: string } {
  if (!p) return { cta: 'Main sekarang', text: '' };
  if (p.finished) return p.solved ? { cta: 'Lihat hasil', text: `Selesai dalam ${p.guesses.length} tebakan · ${p.score ?? 0} poin` } : { cta: 'Lihat jawaban', text: 'Belum berhasil hari ini' };
  if (p.guesses.length) return { cta: 'Lanjutkan', text: `${p.guesses.length} tebakan dipakai, sisa ${p.maxGuesses - p.guesses.length}` };
  return { cta: 'Main sekarang', text: 'Belum dimainkan hari ini' };
}

export function Home({ account }: { account: Account | null }) {
  const [today, setToday] = useState<PuzzleState | null>(null);
  useEffect(() => {
    api.daily().then(setToday, () => setToday(null));
  }, []);
  const status = dailyStatus(today);

  return (
    <div className="stack">
      <section className="hero">
        <div className="hero-body">
          <span className="eyebrow">Puzzle harian{today?.date ? ` · ${fmtDate(today.date)}` : ''}</span>
          <h1>Tebak anime hari ini</h1>
          <p>Satu judul untuk semua orang, selalu easy atau medium. Tiap tebakan membuka petunjuk tahun, skor, studio, genre, theme, dan demographic.</p>
          <div className="hero-actions">
            <a className="button primary big" href="#/daily">
              {status.cta}
              <ArrowIcon />
            </a>
            {status.text && <span className={`hero-status${today?.solved ? ' won' : ''}`}>{status.text}</span>}
          </div>
        </div>
        <div className="hero-clock">
          <span className="eyebrow">Puzzle baru dalam</span>
          <Countdown />
          <span className="muted small">setiap 00:00 WIB</span>
        </div>
      </section>

      <div className="tiles">
        <a className="tile" href="#/unlimited">
          <span className="tile-icon">
            <ShuffleIcon />
          </span>
          <h3>Unlimited</h3>
          <p className="muted">Puzzle acak sebanyak yang kamu mau. Atur pool, genre, dan difficulty.</p>
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

      <section className="card">
        <h2>Cara main</h2>
        <ol className="steps">
          <li>
            <b>Tebak</b>
            <span className="muted">Ketik judul anime (romaji, Inggris, Jepang, atau sinonim) lalu pilih dari daftar. Ada 10 kesempatan.</span>
          </li>
          <li>
            <b>Baca petunjuk</b>
            <span className="muted">
              Tiap kolom diberi warna <span className="tag ok">cocok</span> <span className="tag partial">sebagian</span> <span className="tag bad">beda</span>, angka diberi panah ↑↓ ke arah jawaban.
            </span>
          </li>
          <li>
            <b>Persempit</b>
            <span className="muted">Panel "Yang sudah diketahui" merangkum semua petunjuk sampai jawabannya ketemu.</span>
          </li>
        </ol>
      </section>
    </div>
  );
}
