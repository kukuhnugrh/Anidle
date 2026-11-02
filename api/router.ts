// The only Vercel Function. Vercel Hobby allows 12 functions per deployment, so every /api/* path is
// rewritten here (vercel.json) and dispatched to a handler in routes/. Locally, vite.config.ts does the same.
import * as adminMedia from '../routes/admin/media.js';
import * as animeDetail from '../routes/anime/detail.js';
import * as anime from '../routes/anime/index.js';
import * as authLogin from '../routes/auth/login.js';
import * as authRegister from '../routes/auth/register.js';
import * as guess from '../routes/guess.js';
import * as health from '../routes/health.js';
import * as history from '../routes/history.js';
import * as leaderboard from '../routes/leaderboard.js';
import * as lists from '../routes/lists.js';
import * as logout from '../routes/logout.js';
import * as malList from '../routes/mal/list.js';
import * as malUnlink from '../routes/mal/unlink.js';
import * as me from '../routes/me.js';
import * as media from '../routes/media.js';
import * as oauthCallback from '../routes/oauth/callback.js';
import * as oauthLogin from '../routes/oauth/login.js';
import * as puzzle from '../routes/puzzle.js';
import * as puzzleReplace from '../routes/puzzle/replace.js';
import * as sync from '../routes/sync.js';
import { json } from '../server/http.js';
import { rateLimited } from '../server/ratelimit.js';

type Handler = (req: Request) => Promise<Response>;
type RouteModule = { GET?: Handler; POST?: Handler };

/** Path after /api/ → handler module. */
const ROUTES: Record<string, RouteModule> = {
  'admin/media': adminMedia,
  anime,
  'anime/detail': animeDetail,
  'auth/login': authLogin,
  'auth/register': authRegister,
  guess,
  health,
  history,
  leaderboard,
  lists,
  logout,
  'mal/list': malList,
  'mal/unlink': malUnlink,
  me,
  media,
  'oauth/callback': oauthCallback,
  'oauth/login': oauthLogin,
  puzzle,
  'puzzle/replace': puzzleReplace,
  sync,
};

/**
 * In production the rewrite passes the original path as ?route=; locally the request keeps its own
 * path (/api/health, or /oauth/callback for MAL's redirect).
 */
function routeOf(url: URL): string {
  return (url.searchParams.get('route') ?? url.pathname.replace(/^\/(api\/)?/, '')).replace(/\/+$/, '');
}

async function dispatch(req: Request): Promise<Response> {
  const name = routeOf(new URL(req.url));
  const mod = Object.hasOwn(ROUTES, name) ? ROUTES[name] : undefined;
  if (!mod) return json({ error: 'Not found' }, { status: 404 });
  const handler = req.method === 'GET' || req.method === 'HEAD' ? mod.GET : req.method === 'POST' ? mod.POST : undefined;
  if (!handler) return json({ error: `${req.method} is not supported here.` }, { status: 405 });
  return rateLimited(req, name) ?? handler(req);
}

export const GET = dispatch;
export const POST = dispatch;
