import { isAllowed, isVercel } from '../../server/env.js';
import { HttpError, redirect, route, sessionCookie } from '../../server/http.js';

// Local testing without OAuth: /api/dev/login?user=<allowed username>.
// Off unless ANIDLE_DEV_LOGIN=1, and never on Vercel whatever the env says.
export const GET = route(async (req) => {
  if (isVercel() || process.env.ANIDLE_DEV_LOGIN !== '1') throw new HttpError(404, 'Not found');
  const user = new URL(req.url).searchParams.get('user') ?? '';
  if (!isAllowed(user)) throw new HttpError(403, `${user || '(kosong)'} tidak ada di ALLOWED_USERS.`);
  return redirect('/', [sessionCookie(req, user)]);
});
