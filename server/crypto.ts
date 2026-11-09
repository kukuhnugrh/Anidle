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
  if (!iv || !tag || !data) throw new Error('Encrypted token is corrupted.');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom('TOKEN_ENC_KEY'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** `payload.signature`, payload is base64url JSON. Signed with SESSION_SECRET. */
export function sign(value: unknown): string {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${createHmac('sha256', keyFrom('SESSION_SECRET')).update(payload).digest('base64url')}`;
}

/** Short opaque HMAC of `text` (SESSION_SECRET): changes with its input, reveals nothing about it. */
export const opaqueTag = (text: string) => createHmac('sha256', keyFrom('SESSION_SECRET')).update(text).digest('base64url').slice(0, 12);

/**
 * AES-128-CTR key (SESSION_SECRET HMAC of `text`) a clue video is sent encrypted with, so the file in the
 * browser's network log does not play; the page gets the key with the clue and decrypts in memory.
 * Keeps honest players honest only: the key is in the API response.
 */
export const mediaKey = (text: string) => createHmac('sha256', keyFrom('SESSION_SECRET')).update(`media-key:${text}`).digest().subarray(0, 16);

/** Encrypts (or decrypts: CTR is symmetric) a whole file with a mediaKey; the counter starts at 0. */
export function sealMedia(key: Uint8Array, data: Uint8Array) {
  const cipher = createCipheriv('aes-128-ctr', key, Buffer.alloc(16));
  // A stream cipher: update() returns every byte, final() none.
  const out = cipher.update(data);
  cipher.final();
  return out;
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
