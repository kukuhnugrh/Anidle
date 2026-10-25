import { viewer } from '../../server/accounts.js';
import { randomToken, sign } from '../../server/crypto.js';
import { redirect, route, setCookie } from '../../server/http.js';
import { authorizeUrl } from '../../server/mal.js';
import { OAUTH_COOKIE, OAUTH_TTL_SEC, type OAuthPending } from '../../server/oauth.js';

// Starts "Hubungkan akun MAL". Only for logged-in accounts: MAL is a link, not a way to log in.
export const GET = route(async (req) => {
  const { account } = await viewer(req);
  if (!account) return redirect(`/?mal_error=${encodeURIComponent('Sign in before linking a MAL account.')}#/akun`);
  const pending: OAuthPending = {
    state: randomToken(16),
    // 64 bytes → 86 base64url chars, inside PKCE's 43..128 range.
    verifier: randomToken(64),
    accountId: account.id,
    exp: Date.now() + OAUTH_TTL_SEC * 1000,
  };
  return redirect(authorizeUrl(pending.state, pending.verifier), [setCookie(req, OAUTH_COOKIE, sign(pending), OAUTH_TTL_SEC)]);
});
