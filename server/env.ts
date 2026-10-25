export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Environment variable ${name} belum di-set (lihat .env.example).`);
  return value;
}

export function optionalEnv(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

export function usernameList(name: string): string[] {
  return optionalEnv(name)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function allowedUsers(): string[] {
  return usernameList('ALLOWED_USERS');
}

export function isAllowed(username: string): boolean {
  const wanted = username.toLowerCase();
  return allowedUsers().some((u) => u.toLowerCase() === wanted);
}

/** Usernames whose completed lists form the friends pool. */
export function poolUsers(): string[] {
  const explicit = usernameList('POOL_USERS');
  return explicit.length ? explicit : allowedUsers();
}

export const isVercel = () => Boolean(process.env.VERCEL);
