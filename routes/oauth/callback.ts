import { viewer } from '../../server/accounts.js';
import { verify } from '../../server/crypto.js';
import { getCookie, redirect, route, setCookie } from '../../server/http.js';
import { exchangeCode, fetchMe } from '../../server/mal.js';
import { OAUTH_COOKIE, type OAuthPending } from '../../server/oauth.js';
import { linkMal, syncCompleted } from '../../server/players.js';

const back = (req: Request, error: string | null) =>
  redirect(error ? `/?mal_error=${encodeURIComponent(error)}#/akun` : '/?mal=linked#/akun', [setCookie(req, OAUTH_COOKIE, '', 0)]);

// Reached through the /oauth/callback rewrite (vercel.json / vite.config.ts).
export const GET = route(async (req) => {
  const params = new URL(req.url).searchParams;
  if (params.get('error')) return back(req, params.get('error') === 'access_denied' ? 'Access was denied on the MAL page.' : params.get('message') || params.get('error')!);

  const pending = verify<OAuthPending>(getCookie(req, OAUTH_COOKIE));
  if (!pending || pending.exp < Date.now() || pending.state !== params.get('state')) return back(req, 'The MAL linking session expired. Try again.');
  const { account } = await viewer(req);
  if (!account || account.id !== pending.accountId) return back(req, 'You signed out or switched accounts mid-way. Sign in again and retry.');
  const code = params.get('code');
  if (!code) return back(req, 'MAL did not send an authorization code.');

  try {
    const tokens = await exchangeCode(code, pending.verifier);
    const me = await fetchMe(tokens.accessToken);
    await linkMal(account, me, tokens);
    // Pull the completed list right away (private lists work too, through their token).
    await syncCompleted(me.name).catch((err) => console.warn(`sync ${me.name} gagal:`, err));
    return back(req, null);
  } catch (err) {
    return back(req, err instanceof Error ? err.message : String(err));
  }
});
