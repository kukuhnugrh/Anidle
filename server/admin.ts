import { CANONICAL_SQL, difficultyOf, type Difficulty } from '../shared/catalog.js';
import { SCREENSHOTS_PER_TITLE, type MediaKind, type MediaStatus, type ThemeKind } from '../shared/modes.js';
import { requireAccount, type Account } from './accounts.js';
import { all, one, run } from './db.js';
import { optionalEnv } from './env.js';
import { HttpError } from './http.js';
import { mediaUrl } from './media.js';

// Media review for admins (ADMIN_USERS): see what the pipeline produced and reject bad media. A rejected
// row keeps its R2 object but stops qualifying for pools (they need status ok), and the pipeline leaves it
// alone unless run with --refresh. Songs are reviewed one by one (anime_theme), over every entry of a show.

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
  /** cover: the R2 object. */
  url: string | null;
}

/** One opening or ending of any MAL entry of the show. */
export interface AdminTheme {
  id: number;
  kind: ThemeKind;
  label: string;
  title: string | null;
  artist: string | null;
  /** The MAL entry the song belongs to, when it is not the show's own entry. */
  entry: { malId: number; title: string } | null;
  /** Admins hear songs straight from AnimeThemes (they are not copied to R2). */
  audio: string;
  status: 'ok' | 'rejected';
}

export interface AdminTitle {
  malId: number;
  title: string;
  members: number | null;
  difficulty: Difficulty;
  cover: string | null;
  media: Partial<Record<MediaKind, MediaCell>>;
  /** Openings, then endings, by entry start date and sequence. */
  themes: AdminTheme[];
  characters: Array<{ name: string; url: string }>;
  screenshots: string[];
}

export interface AdminPage {
  items: AdminTitle[];
  total: number;
  page: number;
  pageSize: number;
  /** Rows per kind (media kinds, and op/ed for songs) and status over the whole catalogue. */
  counts: Record<string, Partial<Record<MediaStatus, number>>>;
}

const PAGE_SIZE = 24;

/** What the review can filter on: a media kind, or the songs of one kind. */
export type ReviewKind = MediaKind | ThemeKind;

export interface AdminFilters {
  q?: string;
  kind?: ReviewKind;
  status?: MediaStatus;
  page: number;
}

/** SQL (alias `a` = the show) for "a song of any entry of a's show". */
const THEME_OF_SHOW = 'anime_theme t JOIN anime e ON e.mal_id = t.mal_id WHERE (e.mal_id = a.mal_id OR e.canonical_id = a.mal_id)';

export async function listMedia(f: AdminFilters): Promise<AdminPage> {
  // Only shows (canonical entries) are asked, so only their media needs review.
  const parts = ['a.excluded IS NULL', CANONICAL_SQL];
  const args: Array<string | number> = [];
  if (f.q) {
    parts.push('(a.title LIKE ? OR a.title_en LIKE ?)');
    args.push(`%${f.q}%`, `%${f.q}%`);
  }
  const songKind = f.kind === 'op' || f.kind === 'ed' ? f.kind : undefined;
  const mediaKind = songKind ? undefined : f.kind;
  const songFilter = `EXISTS (SELECT 1 FROM ${THEME_OF_SHOW}${f.status ? ' AND t.status = ?' : ''}${songKind ? ' AND t.kind = ?' : ''})`;
  const songArgs = [...(f.status ? [f.status] : []), ...(songKind ? [songKind] : [])];
  const mediaFilter = `EXISTS (SELECT 1 FROM anime_media m WHERE m.mal_id = a.mal_id${f.status ? ' AND m.status = ?' : ''}${mediaKind ? ' AND m.kind = ?' : ''})`;
  const mediaArgs = [...(f.status ? [f.status] : []), ...(mediaKind ? [mediaKind] : [])];
  if (songKind) {
    parts.push(songFilter);
    args.push(...songArgs);
  } else if (mediaKind) {
    parts.push(mediaFilter);
    args.push(...mediaArgs);
  } else if (f.status) {
    parts.push(`(${mediaFilter} OR ${songFilter})`);
    args.push(...mediaArgs, ...songArgs);
  }
  const where = parts.join(' AND ');
  const total = Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM anime a WHERE ${where}`, args))?.n ?? 0);
  const rows = await all<{ mal_id: number; title: string; members: number | null; cover_src: string | null }>(
    `SELECT a.mal_id, a.title, a.members, a.cover_src FROM anime a WHERE ${where} ORDER BY a.members DESC, a.mal_id LIMIT ? OFFSET ?`,
    [...args, PAGE_SIZE, (f.page - 1) * PAGE_SIZE],
  );
  const ids = rows.map((r) => Number(r.mal_id));
  const marks = ids.map(() => '?').join(',');
  const countsSql = `SELECT kind, status, COUNT(*) AS n FROM anime_media GROUP BY kind, status
                     UNION ALL SELECT kind, status, COUNT(*) AS n FROM anime_theme GROUP BY kind, status`;
  const [media, themes, chars, shots, countRows] = ids.length
    ? await Promise.all([
        all<{ mal_id: number; kind: MediaKind; status: MediaStatus; error: string | null; r2_key: string | null }>(
          `SELECT mal_id, kind, status, error, r2_key FROM anime_media WHERE mal_id IN (${marks})`,
          ids,
        ),
        all<{ show_id: number; id: number; kind: ThemeKind; label: string; song_title: string | null; artist: string | null; audio_url: string; status: 'ok' | 'rejected'; entry_id: number; entry_title: string }>(
          `SELECT COALESCE(e.canonical_id, e.mal_id) AS show_id, t.id, t.kind, t.label, t.song_title, t.artist, t.audio_url, t.status, e.mal_id AS entry_id, e.title AS entry_title
           FROM anime_theme t JOIN anime e ON e.mal_id = t.mal_id
           WHERE e.mal_id IN (${marks}) OR e.canonical_id IN (${marks})
           ORDER BY t.kind DESC, e.start_date IS NULL, e.start_date, t.seq, t.label`,
          [...ids, ...ids],
        ),
        all<{ mal_id: number; name: string; r2_key: string }>(`SELECT mal_id, name, r2_key FROM anime_character WHERE mal_id IN (${marks}) ORDER BY slot`, ids),
        all<{ mal_id: number; r2_key: string }>(`SELECT mal_id, r2_key FROM anime_screenshot WHERE mal_id IN (${marks}) ORDER BY slot`, ids),
        all<{ kind: string; status: MediaStatus; n: number }>(countsSql),
      ])
    : [[], [], [], [], await all<{ kind: string; status: MediaStatus; n: number }>(countsSql)];

  const counts: AdminPage['counts'] = {};
  for (const c of countRows) (counts[c.kind] ??= {})[c.status] = Number(c.n);
  const mediaOf = Map.groupBy(media, (m) => Number(m.mal_id));
  const themesOf = Map.groupBy(themes, (t) => Number(t.show_id));
  const charsOf = Map.groupBy(chars, (c) => Number(c.mal_id));
  const shotsOf = Map.groupBy(shots, (s) => Number(s.mal_id));

  const items = rows.map((r): AdminTitle => {
    const id = Number(r.mal_id);
    const cells: AdminTitle['media'] = {};
    for (const m of mediaOf.get(id) ?? []) cells[m.kind] = { status: m.status, error: m.error, url: m.r2_key ? mediaUrl(m.r2_key) : null };
    return {
      malId: id,
      title: r.title,
      members: r.members == null ? null : Number(r.members),
      difficulty: difficultyOf(r.members == null ? null : Number(r.members)),
      cover: cells.cover?.url ?? r.cover_src,
      media: cells,
      themes: (themesOf.get(id) ?? []).map((t) => ({
        id: Number(t.id),
        kind: t.kind,
        label: t.label,
        title: t.song_title,
        artist: t.artist,
        entry: Number(t.entry_id) === id ? null : { malId: Number(t.entry_id), title: t.entry_title },
        audio: t.audio_url,
        status: t.status,
      })),
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
        ? Number((await one<{ n: number }>('SELECT COUNT(*) AS n FROM anime_screenshot WHERE mal_id = ?', [malId]))?.n ?? 0) >= SCREENSHOTS_PER_TITLE
        : Boolean(row.r2_key);
  if (!hasFiles) throw new HttpError(409, 'The files for this media are missing; rerun the pipeline with --refresh.');
  await run(`UPDATE anime_media SET status = 'ok', error = NULL WHERE mal_id = ? AND kind = ?`, [malId, kind]);
}

/** Rejects one song, or restores it (songs stream from AnimeThemes, so there are no files to check). */
export async function setThemeStatus(themeId: number, action: 'reject' | 'restore'): Promise<void> {
  if (!(await run('UPDATE anime_theme SET status = ? WHERE id = ?', [action === 'reject' ? 'rejected' : 'ok', themeId]))) throw new HttpError(404, 'Unknown song.');
}
