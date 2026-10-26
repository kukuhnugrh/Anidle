import { useState, type FormEvent } from 'react';
import type { Notice } from './AccountPage';
import { api, errorMessage, type Account } from './api';

export function AuthPage({ notice, onDone }: { notice: Notice; onDone: (account: Account) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // A failed MAL sign-in comes back here as a redirect notice.
  const [error, setError] = useState<string | null>(notice?.kind === 'error' ? notice.text : null);
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
          <img className="brand-mark" src="/logo-128.png" alt="" />
          <h1>{mode === 'login' ? 'Welcome back' : 'Create an Anidle account'}</h1>
          <p className="muted small">{mode === 'login' ? 'Sign in to continue your progress on any device.' : 'Free. Just a username and password.'}</p>
        </div>
        <a className="button mal-button" href="/api/oauth/login">
          Continue with MyAnimeList
        </a>
        <p className="muted small">First time? An account named after your MAL username is made for you, with your completed list synced.</p>
        <div className="auth-or">or with an Anidle username</div>
        <div className="tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Sign in
          </button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
            Sign up
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
        {mode === 'register' && <p className="muted small">Username 3–20 characters (letters, numbers, _). Password at least 8 characters.</p>}
        {error && <div className="error-box">{error}</div>}
        <button className="primary" disabled={busy}>
          {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <p className="muted small">Progress you played without an account in this browser moves to your account.</p>
      </form>
    </div>
  );
}
