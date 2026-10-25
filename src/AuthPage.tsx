import { useState, type FormEvent } from 'react';
import { api, errorMessage, type Account } from './api';

export function AuthPage({ onDone }: { onDone: (account: Account) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { account } = mode === 'login' ? await api.login(username, password) : await api.register(username, password);
      onDone(account);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <div className="auth-head">
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <h1>{mode === 'login' ? 'Selamat datang kembali' : 'Buat akun Anidle'}</h1>
          <p className="muted small">{mode === 'login' ? 'Masuk untuk melanjutkan progres di perangkat mana pun.' : 'Gratis. Cukup username dan password.'}</p>
        </div>
        <div className="tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Masuk
          </button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
            Daftar
          </button>
        </div>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={mode === 'register' ? 8 : undefined}
            required
          />
        </label>
        {mode === 'register' && <p className="muted small">Username 3–20 karakter (huruf, angka, _). Password minimal 8 karakter.</p>}
        {error && <div className="error-box">{error}</div>}
        <button className="primary" disabled={busy}>
          {busy ? 'Sebentar…' : mode === 'login' ? 'Masuk' : 'Buat akun'}
        </button>
        <p className="muted small">Progres yang kamu mainkan tanpa akun di browser ini ikut pindah ke akunmu.</p>
      </form>
    </div>
  );
}
