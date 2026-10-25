import { describeAccount, requireAccount } from '../../server/accounts.js';
import { json, route } from '../../server/http.js';
import { unlinkMal } from '../../server/players.js';

export const POST = route(async (req) => {
  const account = await requireAccount(req);
  await unlinkMal(account);
  return json({ account: await describeAccount({ ...account, malUsername: null }) });
});
