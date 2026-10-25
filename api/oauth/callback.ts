import { verify } from '../../server/crypto.js';
import { isAllowed } from '../../server/env.js';
import { getCookie, redirect, route, sessionCookie, setCookie } from '../../server/http.js';
import { exchangeCode, fetchMe } from '../../server/mal.js';
import { savePlayer, syncCompleted } from '../../server/players.js';
import { OAUTH_COOKIE, type OAuthPending } from '../../server/oauth.js';

const back = (req: Request, error: string | null, cookies: string[] = []) =>
  redirect(error ? `/?login_error=${encodeURIComponent(error)}` : '/', [setCookie(req, OAUTH_COOKIE, '', 0), ...cookies]);

// Reached through the /oauth/callback rewrite (vercel.json / vite.config.ts).
export const GET = route(async (req) => {
  const params = new URL(req.url).searchParams;
  if (params.get('error')) return back(req, params.get('error') === 'access_denied' ? 'Akses ditolak di halaman MAL.' : params.get('message') || params.get('error')!);

  const pending = verify<OAuthPending>(getCookie(req, OAUTH_COOKIE));
  if (!pending || pending.exp < Date.now() || pending.state !== params.get('state')) return back(req, 'Sesi login kedaluwarsa. Coba login ulang.');
  const code = params.get('code');
  if (!code) return back(req, 'MAL tidak mengirim authorization code.');

  try {
    const tokens = await exchangeCode(code, pending.verifier);
    const me = await fetchMe(tokens.accessToken);
    if (!isAllowed(me.name)) return back(req, `Username ${me.name} belum ada di daftar pemain. Minta admin menambahkannya.`);
    await savePlayer(me, tokens);
    // First login: pull their completed list right away (private lists work too, through their token).
    await syncCompleted(me.name).catch((err) => console.warn(`sync ${me.name} gagal:`, err));
    return back(req, null, [sessionCookie(req, me.name)]);
  } catch (err) {
    return back(req, err instanceof Error ? err.message : String(err));
  }
});
