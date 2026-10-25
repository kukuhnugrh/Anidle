import { clearSessionCookie, json, route } from '../server/http.js';

export const POST = route(async (req) => json({ ok: true }, { headers: { 'set-cookie': clearSessionCookie(req) } }));
