import { adoptAnonymousPlays, describeAccount, login, sessionCookie, viewer } from '../../server/accounts.js';
import { HttpError, json, readJson, route } from '../../server/http.js';

export const POST = route(async (req) => {
  const body = await readJson<{ username?: unknown; password?: unknown }>(req);
  if (typeof body.username !== 'string' || typeof body.password !== 'string') throw new HttpError(400, 'Username and password are required.');
  const { anonKey } = await viewer(req);
  const account = await login(body.username.trim(), body.password);
  await adoptAnonymousPlays(anonKey, account.id);
  return json({ account: await describeAccount(account) }, {}, [sessionCookie(req, account.id)]);
});
