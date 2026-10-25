import { describeAccount, viewer } from '../server/accounts.js';
import { isAdmin } from '../server/admin.js';
import { json, route } from '../server/http.js';

export const GET = route(async (req) => {
  const { account } = await viewer(req);
  return json({ account: account ? await describeAccount(account) : null, admin: isAdmin(account) });
});
