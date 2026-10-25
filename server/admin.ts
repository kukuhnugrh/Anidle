import { difficultyOf, type Difficulty } from '../shared/catalog.js';
import type { MediaKind, MediaStatus } from '../shared/modes.js';
import { requireAccount, type Account } from './accounts.js';
import { all, one, run } from './db.js';
import { optionalEnv } from './env.js';
import { HttpError } from './http.js';
import { mediaUrl } from './media.js';

// Media review for admins (ADMIN_USERS): see what the pipeline produced and reject bad media. A rejected
// row keeps its R2 object but stops qualifying for pools (they need status ok), and the pipeline leaves it
// alone unless run with --refresh.

/** Anidle usernames (not MAL) allowed to review media, comma separated. */
const adminUsers = () =>
  optionalEnv('ADMIN_USERS')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export const isAdmin = (account: Account | null) => Boolean(account && adminUsers().includes(account.username.toLowerCase()));

export async function requireAdmin(req: Request): Promise<Account> {
  const account = await requireAccount(req);
  if (!isAdmin(account)) throw new HttpError(403, 'This page is for admins only.');
  return account;
}

export interface MediaCell {
  status: MediaStatus;
  error: string | null;
  /** cover / op / ed: the R2 object. */
  url: string | null;
  label: string | null;
  song: string | null;
}

export interface AdminTitle {
  malId: number;
  title: string;
  members: number | null;
  difficulty: Difficulty;
  cover: string | null;
  media: Partial<Record<MediaKind, MediaCell>>;
  characters: Array<{ name: string; url: string }>;
  screenshots: string[];
}

export interface AdminPage {
  items: AdminTitle[];
  total: number;
  page: number;
  pageSize: number;
  /** Rows per kind and status over the whole catalogue. */
  counts: Record<string, Partial<Record<MediaStatus, number>>>;
}

const PAGE_SIZE = 24;

export interface AdminFilters {
  q?: string;
  kind?: MediaKind;
  status?: MediaStatus;
  page: number;
}

export async function listMedia(f: AdminFilters): Promise<AdminPage> {
  const parts = ['a.excluded IS NULL'];
  const args: Array<string | number> = [];
  if (f.q) {
    parts.push('(a.title LIKE ? OR a.title_en LIKE ?)');
    args.push(`%${f.q}%`, `%${f.q}%`);
  }
  if (f.status) {
    parts.push(`EXISTS (SELECT 1 FROM anime_media m WHERE m.mal_id = a.mal_id AND m.status = ?${f.kind ? ' AND m.kind = ?' : ''})`);
    args.push(f.status, ...(f.kind ? [f.kind] : []));
  } else if (f.kind) {
    parts.push('EXISTS (SELECT 1 FROM anime_media m WHERE m.mal_id = a.mal_id AND m.kind = ?)');
    args.push(f.kind);
  }
  const where = parts.join(' AND ');
  const total = Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM anime a WHERE ${where}`, args))?.n ?? 0);
  const rows = await all<{ mal_id: number; title: string; members: number | null; cover_src: string | null }>(
    `SELECT a.mal_id, a.title, a.members, a.cover_src FROM anime a WHERE ${where} ORDER BY a.members DESC, a.mal_id LIMIT ? OFFSET ?`,
    [...args, PAGE_SIZE, (f.page - 1) * PAGE_SIZE],
  );
  const ids = rows.map((r) => Number(r.mal_id));
  const marks = ids.map(() => '?').join(',');
  const [media, chars, shots, countRows] = ids.length
    ? await Promise.all([
        all<{ mal_id: number; kind: MediaKind; status: MediaStatus; error: string | null; r2_key: string | null; label: string | null; song_title: string | null; artist: string | null }>(
          `SELECT mal_id, kind, status, error, r2_key, label, song_title, artist FROM anime_media WHERE mal_id IN (${marks})`,
          ids,
        ),
        all<{ mal_id: number; name: string; r2_key: string }>(`SELECT mal_id, name, r2_key FROM anime_character WHERE mal_id IN (${marks}) ORDER BY slot`, ids),
        all<{ mal_id: number; r2_key: string }>(`SELECT mal_id, r2_key FROM anime_screenshot WHERE mal_id IN (${marks}) ORDER BY slot`, ids),
        all<{ kind: string; status: MediaStatus; n: number }>('SELECT kind, status, COUNT(*) AS n FROM anime_media GROUP BY kind, status'),
      ])
    : [[], [], [], await all<{ kind: string; status: MediaStatus; n: number }>('SELECT kind, status, COUNT(*) AS n FROM anime_media GROUP BY kind, status')];

  const counts: AdminPage['counts'] = {};
  for (const c of countRows) (counts[c.kind] ??= {})[c.status] = Number(c.n);
  const mediaOf = Map.groupBy(media, (m) => Number(m.mal_id));
  const charsOf = Map.groupBy(chars, (c) => Number(c.mal_id));
  const shotsOf = Map.groupBy(shots, (s) => Number(s.mal_id));

  const items = rows.map((r): AdminTitle => {
    const id = Number(r.mal_id);
    const cells: AdminTitle['media'] = {};
    for (const m of mediaOf.get(id) ?? [])
      cells[m.kind] = {
        status: m.status,
        error: m.error,
        url: m.r2_key ? mediaUrl(m.r2_key) : null,
        label: m.label,
        song: [m.song_title, m.artist].filter(Boolean).join(' · ') || null,
      };
    return {
      malId: id,
      title: r.title,
      members: r.members == null ? null : Number(r.members),
      difficulty: difficultyOf(r.members == null ? null : Number(r.members)),
      cover: cells.cover?.url ?? r.cover_src,
      media: cells,
      characters: (charsOf.get(id) ?? []).map((c) => ({ name: c.name, url: mediaUrl(c.r2_key) })),
      screenshots: (shotsOf.get(id) ?? []).map((s) => mediaUrl(s.r2_key)),
    };
  });
  return { items, total, page: f.page, pageSize: PAGE_SIZE, counts };
}

/** Rejects a title's media of one kind, or restores it to ok when its files exist. */
export async function setMediaStatus(malId: number, kind: MediaKind, action: 'reject' | 'restore'): Promise<void> {
  const row = await one<{ status: MediaStatus; r2_key: string | null }>('SELECT status, r2_key FROM anime_media WHERE mal_id = ? AND kind = ?', [malId, kind]);
  if (!row) throw new HttpError(404, 'That media has never been processed.');
  if (action === 'reject') {
    await run(`UPDATE anime_media SET status = 'rejected', error = 'rejected by an admin' WHERE mal_id = ? AND kind = ?`, [malId, kind]);
    return;
  }
  if (row.status !== 'rejected') throw new HttpError(409, 'Only rejected media can be restored.');
  const hasFiles =
    kind === 'chars'
      ? Boolean(await one('SELECT 1 FROM anime_character WHERE mal_id = ?', [malId]))
      : kind === 'shots'
        ? Boolean(await one('SELECT 1 FROM anime_screenshot WHERE mal_id = ?', [malId]))
        : Boolean(row.r2_key);
  if (!hasFiles) throw new HttpError(409, 'The files for this media are missing; rerun the pipeline with --refresh.');
  await run(`UPDATE anime_media SET status = 'ok', error = NULL WHERE mal_id = ? AND kind = ?`, [malId, kind]);
}
