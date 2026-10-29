import { MEDIA_KINDS, MEDIA_STATUSES, type MediaStatus } from '../../shared/modes.js';
import { listMedia, requireAdmin, setMediaStatus, setThemeStatus, type ReviewKind } from '../../server/admin.js';
import { HttpError, json, readJson, route } from '../../server/http.js';

const REVIEW_KINDS: readonly ReviewKind[] = [...MEDIA_KINDS, 'op', 'ed'];
const parseKind = (value: unknown): ReviewKind | undefined => REVIEW_KINDS.find((k) => k === value);
const parseStatus = (value: unknown): MediaStatus | undefined => MEDIA_STATUSES.find((s) => s === value);

/** ?q=&kind=&status=&page= : titles with their media and songs, for review (kind op/ed = songs). */
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

/** { malId, kind, action: 'reject' | 'restore' } for a title's media, or { themeId, action } for one song. */
export const POST = route(async (req) => {
  await requireAdmin(req);
  const body = await readJson<{ malId?: unknown; kind?: unknown; themeId?: unknown; action?: unknown }>(req);
  const action = body.action;
  if (action !== 'reject' && action !== 'restore') throw new HttpError(400, 'Requires action reject/restore.');
  if (body.themeId != null) {
    const themeId = Number(body.themeId);
    if (!Number.isInteger(themeId)) throw new HttpError(400, 'themeId must be an integer.');
    await setThemeStatus(themeId, action);
    return json({ ok: true });
  }
  const malId = Number(body.malId);
  const kind = MEDIA_KINDS.find((k) => k === body.kind);
  if (!Number.isInteger(malId) || !kind) throw new HttpError(400, 'Requires malId and kind (or themeId), and action reject/restore.');
  await setMediaStatus(malId, kind, action);
  return json({ ok: true });
});
