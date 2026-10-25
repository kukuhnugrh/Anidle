export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Environment variable ${name} is not set (see .env.example).`);
  return value;
}

export function optionalEnv(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

/**
 * MAL usernames whose completed lists form the shared pools (daily, `semua`, `teman`, `bareng`).
 * Other accounts that link MAL only get their own `saya` pool, so strangers cannot reshape the daily puzzle.
 */
export function poolUsers(): string[] {
  return optionalEnv('POOL_USERS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
