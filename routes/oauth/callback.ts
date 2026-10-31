import { adoptAnonymousPlays, sessionCookie, viewer } from '../../server/accounts.js';
import { verify } from '../../server/crypto.js';
import { getCookie, redirect, route, setCookie } from '../../server/http.js';
import { exchangeCode, fetchMe } from '../../server/mal.js';
import { OAUTH_COOKIE, type OAuthPending } from '../../server/oauth.js';
import { linkMal, signInWithMal, syncCompleted, syncWait } from '../../server/players.js';

// Errors land on the page the flow started from: the account page (link) or the sign-in page.
const back = (req: Request, page: 'akun' | 'masuk', error: string | null, cookies: string[] = []) =>
  redirect(error ? `/${page}?mal_error=${encodeURIComponent(error)}` : page === 'akun' ? '/akun?mal=linked' : '/', [setCookie(req, OAUTH_COOKIE, '', 0), ...cookies]);

// Reached through the /oauth/callback rewrite (vercel.json / vite.config.ts).
export const GET = route(async (req) => {
  const params = new URL(req.url).searchParams;
  const pending = verify<OAuthPending>(getCookie(req, OAUTH_COOKIE));
  const page = pending?.accountId == null ? 'masuk' : 'akun';
  if (params.get('error')) return back(req, page, params.get('error') === 'access_denied' ? 'Access was denied on the MAL page.' : params.get('message') || params.get('error')!);

  if (!pending || pending.exp < Date.now() || pending.state !== params.get('state')) return back(req, page, 'The MAL session expired. Try again.');
  const { account, anonKey } = await viewer(req);
  if (pending.accountId != null && account?.id !== pending.accountId) return back(req, page, 'You signed out or switched accounts mid-way. Sign in again and retry.');
  const code = params.get('code');
  if (!code) return back(req, page, 'MAL did not send an authorization code.');

  try {
    const tokens = await exchangeCode(code, pending.verifier);
    const me = await fetchMe(tokens.accessToken);
    const cookies: string[] = [];
    if (account && pending.accountId != null) await linkMal(account, me, tokens);
    else {
      const signedIn = await signInWithMal(me, tokens);
      await adoptAnonymousPlays(anonKey, signedIn.id);
      cookies.push(sessionCookie(req, signedIn.id));
    }
    // Pull the completed list right away (private lists work too, through their token), unless it was just synced.
    if ((await syncWait(me.name)) === 0) await syncCompleted(me.name).catch((err) => console.warn(`sync ${me.name} gagal:`, err));
    return back(req, page, null, cookies);
  } catch (err) {
    return back(req, page, err instanceof Error ? err.message : String(err));
  }
});
