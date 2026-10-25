import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { requireEnv } from './env.js';

const keyFrom = (name: string) => createHash('sha256').update(requireEnv(name)).digest();

/** AES-256-GCM, output `iv.tag.ciphertext` (base64url). Used for MAL tokens at rest. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom('TOKEN_ENC_KEY'), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(sealed: string): string {
  const [iv, tag, data] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !data) throw new Error('Token terenkripsi rusak.');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom('TOKEN_ENC_KEY'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** `payload.signature`, payload is base64url JSON. Signed with SESSION_SECRET. */
export function sign(value: unknown): string {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${createHmac('sha256', keyFrom('SESSION_SECRET')).update(payload).digest('base64url')}`;
}

export function verify<T>(token: string | undefined): T | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = createHmac('sha256', keyFrom('SESSION_SECRET')).update(payload).digest();
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export const randomToken = (bytes: number) => randomBytes(bytes).toString('base64url');

/** Deterministic non-negative integer from a string (daily puzzle seed). */
export function seedOf(text: string): bigint {
  return createHash('sha256').update(text).digest().readBigUInt64BE(0);
}
