import { randomToken, sign } from '../../server/crypto.js';
import { redirect, route, setCookie } from '../../server/http.js';
import { authorizeUrl } from '../../server/mal.js';
import { OAUTH_COOKIE, OAUTH_TTL_SEC, type OAuthPending } from '../../server/oauth.js';

export const GET = route(async (req) => {
  const pending: OAuthPending = {
    state: randomToken(16),
    // 64 bytes → 86 base64url chars, inside PKCE's 43..128 range.
    verifier: randomToken(64),
    exp: Date.now() + OAUTH_TTL_SEC * 1000,
  };
  return redirect(authorizeUrl(pending.state, pending.verifier), [setCookie(req, OAUTH_COOKIE, sign(pending), OAUTH_TTL_SEC)]);
});
