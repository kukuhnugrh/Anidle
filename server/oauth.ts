/** Holds state + PKCE verifier between /api/oauth/login and the callback (serverless keeps no memory). */
export const OAUTH_COOKIE = 'anidle_oauth';
export const OAUTH_TTL_SEC = 600;

export interface OAuthPending {
  state: string;
  verifier: string;
  /** The web account the MAL account gets linked to; must still be the logged-in one at callback time. */
  accountId: number;
  exp: number;
}
