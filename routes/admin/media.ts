import { MEDIA_KINDS, MEDIA_STATUSES, type MediaKind, type MediaStatus } from '../../shared/modes.js';
import { listMedia, requireAdmin, setMediaStatus } from '../../server/admin.js';
import { HttpError, json, readJson, route } from '../../server/http.js';

const parseKind = (value: unknown): MediaKind | undefined => MEDIA_KINDS.find((k) => k === value);
const parseStatus = (value: unknown): MediaStatus | undefined => MEDIA_STATUSES.find((s) => s === value);

/** ?q=&kind=&status=&page= : titles with their media, for review. */
export const GET = route(async (req) => {
  await requireAdmin(req);
  const p = new URL(req.url).searchParams;
  return json(
    await listMedia({
      q: p.get('q')?.trim() || undefined,
      kind: parseKind(p.get('kind')),
      status: parseStatus(p.get('status')),
      page: Math.max(1, Number(p.get('page')) || 1),
    }),
  );
});

/** { malId, kind, action: 'reject' | 'restore' } */
export const POST = route(async (req) => {
  await requireAdmin(req);
  const body = await readJson<{ malId?: unknown; kind?: unknown; action?: unknown }>(req);
  const malId = Number(body.malId);
  const kind = parseKind(body.kind);
  if (!Number.isInteger(malId) || !kind || (body.action !== 'reject' && body.action !== 'restore')) throw new HttpError(400, 'Requires malId, kind, and action reject/restore.');
  await setMediaStatus(malId, kind, body.action);
  return json({ ok: true });
});
