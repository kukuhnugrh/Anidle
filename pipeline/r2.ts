import { createHash, createHmac } from 'node:crypto';
import { requireEnv } from '../server/env.js';
import { UpstreamError } from './limiter.js';

// Cloudflare R2 speaks the S3 API. The pipeline only puts and deletes single objects, so this signs
// AWS Signature V4 by hand instead of pulling in the AWS SDK.

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data).digest();

/** Object keys are path segments; S3 wants each segment URI-encoded (RFC 3986). */
const encodeKey = (key: string) =>
  key
    .split('/')
    .map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');

async function send(method: 'PUT' | 'DELETE', key: string, body: Uint8Array<ArrayBuffer> | undefined, extra: Record<string, string>): Promise<Response> {
  const account = requireEnv('R2_ACCOUNT_ID');
  const bucket = requireEnv('R2_BUCKET');
  const accessKey = requireEnv('R2_ACCESS_KEY_ID');
  const secret = requireEnv('R2_SECRET_ACCESS_KEY');
  const host = `${account}.r2.cloudflarestorage.com`;
  const path = `/${bucket}/${encodeKey(key)}`;
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body ?? '');
  const headers: Record<string, string> = { ...extra, host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(headers).sort();
  const canonical = [method, path, '', ...names.map((n) => `${n}:${headers[n]}`), '', names.join(';'), payloadHash].join('\n');
  const scope = `${day}/auto/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), 'auto'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  const { host: _host, ...sent } = headers;
  const res = await fetch(`https://${host}${path}`, {
    method,
    headers: { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new UpstreamError(res.status, `R2 ${method} ${key}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

/** Uploads `body` to the media bucket. Keys carry a content hash, so objects are cached forever. */
export async function putObject(key: string, body: Uint8Array<ArrayBuffer>, contentType: string): Promise<void> {
  await send('PUT', key, body, { 'cache-control': 'public, max-age=31536000, immutable', 'content-type': contentType });
}

/** Removes an object; deleting a key that does not exist also succeeds. */
export async function deleteObject(key: string): Promise<void> {
  await send('DELETE', key, undefined, {});
}
