import { existsSync } from 'node:fs';

// Scripts run outside Vite/Vercel, so load .env here. Real environment variables win (CI secrets).
if (existsSync('.env')) process.loadEnvFile('.env');
