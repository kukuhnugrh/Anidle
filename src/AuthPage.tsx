import { useState, type FormEvent, type KeyboardEvent } from 'react';
import type { Notice } from './AccountPage';
import { api, errorMessage, type Account } from './api';
import { Tabs, TextField, useButtonReaction } from './sakuga';

const MODES = [
  { value: 'login', label: 'Sign in' },
  { value: 'register', label: 'Sign up' },
] as const;

export function AuthPage({ notice, onDone }: { notice: Notice; onDone: (account: Account) => void }) {
  const [mode, setMode] = useState<(typeof MODES)[number]['value']>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // A failed MAL sign-in comes back here as a redirect notice.
  const [error, setError] = useState<string | null>(notice?.kind === 'error' ? notice.text : null);
  const [busy, setBusy] = useState(false);
  const reaction = useButtonReaction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    // The fields live in the components' shadow trees, so the browser's `required` check does not reach them.
    if (!username || !password) {
      setError('Enter your username and password.');
      return;
    }
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
  // Enter in a field submits, as in a plain form (the browser only does that for its own fields).
  const submitOnEnter = (e: KeyboardEvent<SakugaInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.closest('form')?.requestSubmit();
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
        <Tabs label="Sign in or sign up" options={MODES} value={mode} onChange={setMode} />
        <label>
          Username
          <TextField label="Username" value={username} onValue={setUsername} onKeyDown={submitOnEnter} autocomplete="username" autoFocus />
        </label>
        <label>
          Password
          {/* The field reads autocomplete once, so it is built again for the other mode (the text is kept). */}
          <TextField
            key={mode}
            type="password"
            label="Password"
            value={password}
            onValue={setPassword}
            onKeyDown={submitOnEnter}
            autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {mode === 'register' && <p className="muted small">Username 3–20 characters (letters, numbers, _). Password at least 8 characters.</p>}
        {error && <div className="error-box">{error}</div>}
        <sakuga-button type="submit" disabled={busy && !reaction.held} onClick={reaction.pressed}>
          {busy ? 'One moment…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </sakuga-button>
        <p className="muted small">Progress you played without an account in this browser moves to your account.</p>
      </form>
    </div>
  );
}
