import { clearSessionCookie } from '../server/accounts.js';
import { json, route } from '../server/http.js';

export const POST = route(async (req) => json({ ok: true }, {}, [clearSessionCookie(req)]));
