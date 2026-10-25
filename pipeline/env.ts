import { existsSync } from 'node:fs';

// Scripts run outside Vite/Vercel, so load env files here. loadEnvFile never overwrites a variable
// that is already set, so precedence is: real environment (CI secrets) > .env.turso (--turso) > .env.
if (process.argv.includes('--turso')) {
  if (!existsSync('.env.turso')) throw new Error('--turso butuh file .env.turso (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, TOKEN_ENC_KEY).');
  process.loadEnvFile('.env.turso');
}
if (existsSync('.env')) process.loadEnvFile('.env');
