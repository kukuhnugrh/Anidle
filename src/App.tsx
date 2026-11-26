import { useCallback, useEffect, useState } from 'react';
import { AccountPage, type Notice } from './AccountPage';
import { Anidle } from './Anidle';
import { api, errorMessage, savedUnlimited, type Account, type PuzzleState, type TodayScore } from './api';
import { isBetaMode, type DailyMode, type Mode } from '../shared/modes';
import { CharacterGame } from './CharacterGame';
import { ConnectionsGame } from './ConnectionsGame';
import { HigherLowerGame } from './HigherLowerGame';
import { OddOneOutGame } from './OddOneOutGame';
import { RoundGame } from './RoundGame';
import { SongGame } from './SongGame';
import { SynopsisGame } from './SynopsisGame';
import { TimelineGame } from './TimelineGame';
import { AuthPage } from './AuthPage';
import { AdminPage } from './AdminPage';
import { AnimeDetail } from './AnimeDetail';
import { Database } from './Database';
import { ErrorBoundary } from './ErrorBoundary';
import { HistoryPage } from './HistoryPage';
import { LeaderboardPage } from './Leaderboard';
import { Home } from './Home';
import { MalListPage } from './MalList';
import { DayBar, HomeBar, UnlimitedBar } from './ModeBar';
import { go, readRoute, type View } from './route';
import { installSfx } from './sfx';
import { TopBar } from './TopBar';
import { Unlimited } from './Unlimited';
import { syncPageAudio } from './volume';

/** Elements showing a blurred clue (styles.css also turns off long-press menus and selection on them). */
const PROTECTED_MEDIA = '.clue-media, .clue-cover, .clue-frame, .anidle-cover-frame';

/** Pages reached from Home get a back link to it; `true` = a single-column (`narrow`) page the link lines up with. */
const HOME_BAR: Partial<Record<View, boolean>> = {
  unlimited: true,
  beta: true,
  account: true,
  database: false,
  leaderboard: false,
  history: false,
  mylist: false,
  admin: false,
};

/** One-shot message from the MAL redirect (?mal=linked / ?mal_error=…), then those params are cleaned from the URL. */
function takeRedirectNotice(): Notice {
  const params = new URLSearchParams(location.search);
  const notice: Notice = params.get('mal_error')
    ? { kind: 'error', text: `MyAnimeList: ${params.get('mal_error')}` }
    : params.get('mal') === 'linked'
      ? { kind: 'ok', text: 'MAL account linked. Your completed list has been synced.' }
      : null;
  if (params.has('mal') || params.has('mal_error')) {
    params.delete('mal');
    params.delete('mal_error');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : ''));
  }
  return notice;
}

/**
 * Same-origin links navigate inside the app (no reload). /api/* and /oauth/* are left to the browser:
 * they are server routes (e.g. starting the MAL login). Modified clicks and new-tab links open normally.
 */
function inAppLink(e: MouseEvent): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = e.target instanceof Element ? e.target.closest('a') : null;
  if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin) return null;
  if (a.pathname.startsWith('/api/') || a.pathname.startsWith('/oauth/')) return null;
  return a.pathname + a.search;
}

export function App() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [admin, setAdmin] = useState(false);
  const [today, setToday] = useState<TodayScore | null>(null);
  const [route, setRoute] = useState(readRoute);
  const [notice] = useState(takeRedirectNotice);
  // Whether the unlimited puzzle on screen is a beta mode (null until it loads): its back link.
  const [playBeta, setPlayBeta] = useState<boolean | null>(null);

  // The admin flag follows the session, so it is re-read after logging in and out.
  const refreshMe = useCallback(
    () =>
      api.me().then(
        (r) => {
          setAccount(r.account);
          setAdmin(r.admin);
          setToday(r.today);
        },
        () => setAccount(null),
      ),
    [],
  );
  // A finished daily puzzle changes today's score. Only the score is taken: if the call fails, the chip keeps its
  // last value rather than signing the player out on screen.
  const refreshToday = useCallback(() => api.me().then((r) => setToday(r.today), () => undefined), []);
  const homeBar = HOME_BAR[route.view];

  useEffect(() => {
    void refreshMe();
    const onNavigate = () => {
      setRoute(readRoute());
      setPlayBeta(null);
      scrollTo({ top: 0 });
    };
    const onClick = (e: MouseEvent) => {
      const href = inAppLink(e);
      if (href === null) return;
      e.preventDefault();
      go(href);
    };
    // Clue posters and videos: no "Open image/video in new tab" or drag to a new tab, where the
    // sharp file would show. Best effort: the URL still shows in the browser's developer tools.
    const onProtected = (e: Event) => e.target instanceof Element && e.target.closest(PROTECTED_MEDIA) && e.preventDefault();
    addEventListener('popstate', onNavigate);
    document.addEventListener('click', onClick);
    document.addEventListener('contextmenu', onProtected);
    document.addEventListener('dragstart', onProtected);
    return () => {
      removeEventListener('popstate', onNavigate);
      document.removeEventListener('click', onClick);
      document.removeEventListener('contextmenu', onProtected);
      document.removeEventListener('dragstart', onProtected);
    };
  }, [refreshMe]);
  // Database and admin song players follow the site-wide volume (the games' players are detached, see volume.ts).
  useEffect(syncPageAudio, []);
  // The Sakuga controls' sound effects, heard on the document (sfx.ts).
  useEffect(installSfx, []);

  if (account === undefined)
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    );

  return (
    <div className="shell">
      <TopBar
        route={route}
        account={account}
        admin={admin}
        today={today}
        onLogout={() =>
          api.logout().then(() => {
            setAccount(null);
            setAdmin(false);
            void refreshMe();
            go('/');
          })
        }
      />
      <main className="page">
        <ErrorBoundary key={JSON.stringify(route)}>
          {homeBar !== undefined && <HomeBar narrow={homeBar} />}
          {route.view === 'home' && <Home />}
          {route.view === 'daily' && (
            <>
              <DayBar mode={route.mode} date={route.date} />
              <PuzzleLoader key={`daily:${route.mode}:${route.date}`} daily={route.mode} date={route.date} onFinished={refreshToday} />
            </>
          )}
          {route.view === 'play' && (
            <>
              {playBeta !== null && <UnlimitedBar beta={playBeta} />}
              <PuzzleLoader key={route.id} id={route.id} onLoaded={(mode) => setPlayBeta(isBetaMode(mode))} />
            </>
          )}
          {route.view === 'unlimited' && <Unlimited key="unlimited" account={account} page="unlimited" />}
          {route.view === 'beta' && <Unlimited key="beta" account={account} page="beta" />}
          {route.view === 'database' && <Database />}
          {route.view === 'anime' && <AnimeDetail key={route.id} id={route.id} />}
          {route.view === 'account' && <AccountPage account={account} onAccount={setAccount} initialNotice={notice} />}
          {route.view === 'leaderboard' && <LeaderboardPage account={account} />}
          {route.view === 'history' && <HistoryPage account={account} />}
          {route.view === 'mylist' && <MalListPage account={account} />}
          {route.view === 'admin' && (admin ? <AdminPage /> : <div className="error-box">This page is for admins only.</div>)}
          {route.view === 'auth' && (
            <AuthPage
              notice={notice}
              onDone={(a) => {
                setAccount(a);
                void refreshMe();
                go('/');
              }}
            />
          )}
        </ErrorBoundary>
      </main>
    </div>
  );
}

/**
 * A mode's daily puzzle (today, or `date` from the archive), or the puzzle `id` (unlimited, resumable after reload because the id is in the URL).
 * `onLoaded` hears the puzzle's mode once it is known; `onFinished` hears the puzzle finish (a daily one changes today's score).
 */
function PuzzleLoader(
  props: ({ daily: DailyMode; date: string | null } | { id: string }) & { onFinished?: () => void; onLoaded?: (mode: Mode) => void },
) {
  const [puzzle, setPuzzle] = useState<PuzzleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const source = 'id' in props ? props.id : `${props.daily}:${props.date}`;
  const reload = useCallback(() => {
    setError(null);
    ('id' in props ? api.resume(props.id) : api.daily(props.daily, props.date ?? undefined)).then(setPuzzle, (err: unknown) => setError(errorMessage(err)));
    // `source` identifies the props; the object itself is new every render.
  }, [source]);
  useEffect(reload, [reload]);
  const mode = puzzle?.mode;
  // Only the mode matters; the callback itself is new every render.
  useEffect(() => {
    if (mode) props.onLoaded?.(mode);
  }, [mode]);
  const { onFinished } = props;
  const change = useCallback(
    (p: PuzzleState) => {
      setPuzzle(p);
      if (p.finished) onFinished?.();
    },
    [onFinished],
  );

  if (error)
    return (
      <div className="center">
        <div className="error-box">{error}</div>
        <sakuga-button variant="secondary" onClick={reload}>
          Try again
        </sakuga-button>
      </div>
    );
  if (!puzzle)
    return (
      <div className="center">
        <span className="spinner" />
      </div>
    );
  // "Play unlimited" after a game keeps the last unlimited filters but stays in this mode.
  const newUnlimited = () => api.unlimited({ ...(savedUnlimited.load() ?? { pool: puzzle.pool }), mode: puzzle.mode }).then((p) => go(`/play/${p.id}`));
  if (puzzle.mode === 'anidle') return <Anidle puzzle={puzzle} onChange={change} onNewUnlimited={newUnlimited} />;
  if (puzzle.mode === 'character') return <CharacterGame key={puzzle.id} puzzle={puzzle} onChange={change} onNewUnlimited={newUnlimited} />;
  if (puzzle.mode === 'screenshot') return <RoundGame key={puzzle.id} puzzle={puzzle} onChange={change} onNewUnlimited={newUnlimited} />;
  if (puzzle.mode === 'connections') return <ConnectionsGame key={puzzle.id} puzzle={puzzle} onChange={change} onNewUnlimited={newUnlimited} />;
  if (puzzle.mode === 'synopsis') return <SynopsisGame key={puzzle.id} puzzle={puzzle} onChange={change} onNewUnlimited={newUnlimited} />;
  if (puzzle.mode === 'higherlower') return <HigherLowerGame key={puzzle.id} puzzle={puzzle} onChange={change} onNewUnlimited={newUnlimited} />;
  if (puzzle.mode === 'oddoneout') return <OddOneOutGame key={puzzle.id} puzzle={puzzle} onChange={change} onNewUnlimited={newUnlimited} />;
  if (puzzle.mode === 'timeline') return <TimelineGame key={puzzle.id} puzzle={puzzle} onChange={change} onNewUnlimited={newUnlimited} />;
  return <SongGame key={puzzle.id} puzzle={puzzle} onChange={change} onNewUnlimited={newUnlimited} />;
}
