import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';
import { MEDIUM_MIN_MEMBERS } from '../shared/catalog.js';
import { CHARACTER_QUIZ_SLOT } from '../shared/characters.js';
import { CHARACTERS_PER_TITLE, type MediaKind } from '../shared/modes.js';
import { all, db, nowIso, run } from '../server/db.js';
import { Limiter, sleep, UpstreamError } from './limiter.js';
import { putObject } from './r2.js';
import { firstThemes, type ThemeSource } from './sources/animeThemes.js';
import { animeCharacters, characterDetail } from './sources/jikanEdge.js';

const COVER_WIDTH = 400;
const PORTRAIT_WIDTH = 300;
/** Titles whose source was missing or broken are looked at again after this long. */
const RECHECK_DAYS = 30;

const malCdn = new Limiter('mal-cdn', [{ ms: 1000, max: 5 }]);

const log = (...args: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...args);

class MediaError extends Error {}

interface FfmpegResult {
  out: Uint8Array<ArrayBuffer>;
  /** Last `time=` ffmpeg reported: the length of what it encoded. */
  seconds: number;
  /** The last 4000 characters of stderr (filter metadata such as signalstats). */
  log: string;
}

/** Runs ffmpeg with `input` on stdin (or a URL in args) and returns stdout plus the encoded length. */
function ffmpeg(args: string[], input?: Uint8Array): Promise<FfmpegResult> {
  if (!ffmpegPath) throw new Error('ffmpeg-static tidak punya binary untuk platform ini.');
  const { promise, resolve, reject } = Promise.withResolvers<FfmpegResult>();
  const child = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-loglevel', 'info', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  const chunks: Buffer[] = [];
  let size = 0;
  let err = '';
  child.stdout.on('data', (b: Buffer) => {
    chunks.push(b);
    size += b.length;
  });
  child.stderr.on('data', (b: Buffer) => (err = (err + b.toString()).slice(-4000)));
  child.on('error', reject);
  child.on('close', (code) => {
    if (code !== 0) return reject(new MediaError(`ffmpeg ${code}: ${err.trim().split('\n').at(-1)}`));
    const out = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    const t = [...err.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].at(-1);
    resolve({ out, seconds: t ? Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]) : 0, log: err });
  });
  child.stdin.on('error', () => {}); // ffmpeg may close stdin early; the exit code reports real failures
  child.stdin.end(input);
  return promise;
}

const contentKey = (dir: string, body: Uint8Array, ext: string) => `v1/${dir}/${createHash('sha256').update(body).digest('hex').slice(0, 24)}.${ext}`;

/** GET through `limiter`, which retries network errors, 429 and 5xx. */
function download(limiter: Limiter, url: string): Promise<Uint8Array<ArrayBuffer>> {
  return limiter.schedule(async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new UpstreamError(res.status, `${res.status} ${url}`);
    return new Uint8Array(await res.arrayBuffer());
  });
}

/** Any MAL CDN image → WebP at most `width` wide, stored under v1/<dir>/<content hash>.webp. */
async function processImage(url: string, dir: string, width: number): Promise<string> {
  const source = await download(malCdn, url);
  // image2pipe, not the webp muxer: that one patches the RIFF size by seeking back, which a pipe
  // cannot do, and browsers reject the resulting size-0 header.
  const { out } = await ffmpeg(['-i', 'pipe:0', '-vf', `scale='min(${width},iw)':-2`, '-c:v', 'libwebp', '-quality', '82', '-f', 'image2pipe', 'pipe:1'], source);
  const riffSize = out.length >= 12 ? new DataView(out.buffer).getUint32(4, true) : 0;
  if (out.length < 1_000 || riffSize !== out.length - 8) throw new MediaError(`gambar rusak (${out.length} B, RIFF ${riffSize})`);
  const key = contentKey(dir, out, 'webp');
  await putObject(key, out, 'image/webp');
  return key;
}

interface MediaRow {
  mal_id: number;
  kind: MediaKind;
  status: 'ok' | 'missing' | 'broken' | 'rejected';
  source_url: string | null;
  checked_at: string;
}

/**
 * Whether a title's media of one kind needs (re)processing: never processed, or missing/broken and not
 * looked at since `stale`. ok and admin-rejected rows are only redone with --refresh.
 */
const isDue = (row: MediaRow | undefined, refreshAll: boolean, stale: string) =>
  refreshAll || !row || ((row.status === 'missing' || row.status === 'broken') && row.checked_at < stale);

async function save(malId: number, kind: MediaKind, row: { status: MediaRow['status']; key?: string | null; source?: string | null; theme?: ThemeSource | null; error?: string | null }) {
  await run(
    `INSERT INTO anime_media (mal_id, kind, status, r2_key, source_url, label, song_title, artist, error, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (mal_id, kind) DO UPDATE SET status = excluded.status, r2_key = excluded.r2_key, source_url = excluded.source_url,
       label = excluded.label, song_title = excluded.song_title, artist = excluded.artist, error = excluded.error, checked_at = excluded.checked_at`,
    [malId, kind, row.status, row.key ?? null, row.source ?? null, row.theme?.label ?? null, row.theme?.title ?? null, row.theme?.artist ?? null, row.error ?? null, nowIso()],
  );
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/**
 * The source itself is bad (ffmpeg rejects it, output fails validation, or its host answers 4xx), so
 * the title is marked broken. Anything else (network, R2, database) is transient and only skipped.
 */
const isSourceFault = (err: unknown) => err instanceof MediaError || (err instanceof UpstreamError && err.status >= 400 && err.status < 500 && err.status !== 429);

/**
 * Per playable title, most popular first: copies the cover to R2 and records the first OP and first ED
 * on AnimeThemes (audio URL + song info; the game streams them). Re-runs skip what is already ok;
 * missing/broken sources are retried after RECHECK_DAYS, or always with --refresh.
 */
export async function stepMedia(refreshAll: boolean, limit: number) {
  const anime = await all<{ mal_id: number; cover_src: string | null }>('SELECT mal_id, cover_src FROM anime WHERE excluded IS NULL ORDER BY members DESC');
  const rows = await all<MediaRow>('SELECT mal_id, kind, status, source_url, checked_at FROM anime_media');
  const byKey = new Map(rows.map((r) => [`${r.mal_id}:${r.kind}`, r]));
  const stale = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
  const due = (row: MediaRow | undefined) => isDue(row, refreshAll, stale);

  const jobs = anime
    .map((a) => ({
      id: Number(a.mal_id),
      coverSrc: a.cover_src,
      cover: refreshAll || due(byKey.get(`${a.mal_id}:cover`)) || byKey.get(`${a.mal_id}:cover`)?.source_url !== a.cover_src,
      themes: due(byKey.get(`${a.mal_id}:op`)) || due(byKey.get(`${a.mal_id}:ed`)),
    }))
    .filter((j) => j.cover || j.themes)
    .slice(0, limit);
  log(`media: ${jobs.length} judul (cover ${jobs.filter((j) => j.cover).length}, OP/ED ${jobs.filter((j) => j.themes).length})`);

  const counts: Record<string, number> = {};
  const count = (kind: MediaKind, status: string) => (counts[`${kind} ${status}`] = (counts[`${kind} ${status}`] ?? 0) + 1);
  let done = 0;
  const queue = [...jobs].reverse();
  // Limiters pace each host; enough workers keep the AnimeThemes API near its 80/min budget.
  const workers = Array.from({ length: 8 }, async () => {
    for (let job = queue.pop(); job; job = queue.pop()) {
      try {
        if (job.cover) {
          if (!job.coverSrc) await save(job.id, 'cover', { status: 'missing' });
          else
            try {
              await save(job.id, 'cover', { status: 'ok', key: await processImage(job.coverSrc, 'cover', COVER_WIDTH), source: job.coverSrc });
              count('cover', 'ok');
            } catch (err) {
              if (!isSourceFault(err)) throw err;
              await save(job.id, 'cover', { status: 'broken', source: job.coverSrc, error: errorText(err) });
              count('cover', 'broken');
            }
        }
        if (job.themes) {
          const themes = await firstThemes(job.id);
          for (const kind of ['op', 'ed'] as const) {
            const theme = themes[kind];
            const prev = byKey.get(`${job.id}:${kind}`);
            // Same source as last time and already decided (ok, or rejected by an admin): nothing to do.
            if (!refreshAll && (prev?.status === 'ok' || prev?.status === 'rejected') && prev.source_url === theme?.audioUrl) continue;
            if (!theme) {
              await save(job.id, kind, { status: 'missing' });
              count(kind, 'missing');
              continue;
            }
            // The game streams the song from AnimeThemes through /api/media; only the source is kept.
            await save(job.id, kind, { status: 'ok', source: theme.audioUrl, theme });
            count(kind, 'ok');
          }
        }
      } catch (err) {
        // Network, R2 or database trouble: nothing is marked, so the next run tries this title again.
        counts.skipped = (counts.skipped ?? 0) + 1;
        log(`media: ${job.id} dilewati (${errorText(err)})`);
      }
      if (++done % 25 === 0) log(`media: ${done}/${jobs.length}`, counts);
    }
  });
  await Promise.all(workers);
  log('media:', counts);
}

/** MAL's "no picture" placeholder, e.g. .../images/questionmark_23.gif */
const isPlaceholder = (url: string | null) => !url || url.includes('questionmark');

/**
 * Karakter mode: CHARACTERS_PER_TITLE portraits per title from jikan-edge, Main roles first, then by
 * MAL favorites. Stored so slot 0 (the least known of them) is shown first and the best known last.
 * Titles with fewer usable portraits are `missing` and stay out of the mode.
 */
export async function stepCharacters(refreshAll: boolean, limit: number) {
  const anime = await all<{ mal_id: number }>('SELECT mal_id FROM anime WHERE excluded IS NULL ORDER BY members DESC');
  const rows = await all<MediaRow>(`SELECT mal_id, kind, status, source_url, checked_at FROM anime_media WHERE kind = 'chars'`);
  const byId = new Map(rows.map((r) => [Number(r.mal_id), r]));
  const stale = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
  const queue = anime
    .map((a) => Number(a.mal_id))
    .filter((id) => isDue(byId.get(id), refreshAll, stale))
    .slice(0, limit)
    .reverse();
  const total = queue.length;
  log(`characters: ${total} judul`);
  const counts = { ok: 0, missing: 0, broken: 0, skipped: 0 };
  let done = 0;
  // jikan-edge allows 50 requests a minute; portraits come from MAL's CDN in parallel.
  const workers = Array.from({ length: 4 }, async () => {
    for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
      try {
        const picked = (await animeCharacters(id))
          .filter((c) => !isPlaceholder(c.imageUrl))
          .sort((a, b) => Number(b.role === 'Main') - Number(a.role === 'Main') || (b.favorites ?? 0) - (a.favorites ?? 0))
          .slice(0, CHARACTERS_PER_TITLE)
          .reverse();
        if (picked.length < CHARACTERS_PER_TITLE) {
          await save(id, 'chars', { status: 'missing', error: `${picked.length} karakter bergambar` });
          counts.missing++;
        } else {
          try {
            const keys = await Promise.all(picked.map((c) => processImage(c.imageUrl!, 'char', PORTRAIT_WIDTH)));
            await db().batch(
              [
                { sql: 'DELETE FROM anime_character WHERE mal_id = ?', args: [id] },
                ...picked.map((c, slot) => ({
                  sql: 'INSERT INTO anime_character (mal_id, slot, char_id, name, role, favorites, r2_key) VALUES (?, ?, ?, ?, ?, ?, ?)',
                  args: [id, slot, c.malId, c.name, c.role, c.favorites, keys[slot]!],
                })),
              ],
              'write',
            );
            await save(id, 'chars', { status: 'ok' });
            counts.ok++;
          } catch (err) {
            if (!isSourceFault(err)) throw err;
            await save(id, 'chars', { status: 'broken', error: errorText(err) });
            counts.broken++;
          }
        }
      } catch (err) {
        // Network, R2 or database trouble: nothing is marked, so the next run tries this title again.
        counts.skipped++;
        log(`characters: ${id} dilewati (${errorText(err)})`);
      }
      if (++done % 50 === 0) log(`characters: ${done}/${total}`, counts);
    }
  });
  await Promise.all(workers);
  log('characters:', counts);
}

/**
 * Nicknames and kanji name of every quiz character (CHARACTER_QUIZ_SLOT, from jikan-edge character detail), so Character mode
 * also accepts "Ed" or "Fullmetal Alchemist". Characters already fetched are skipped unless --refresh.
 */
export async function stepNicknames(refreshAll: boolean, limit: number) {
  const queue = (
    await all<{ mal_id: number; char_id: number }>(
      `SELECT c.mal_id, c.char_id FROM anime_character c JOIN anime a ON a.mal_id = c.mal_id
       WHERE c.slot = ? AND (? OR c.details_at IS NULL) ORDER BY a.members DESC`,
      [CHARACTER_QUIZ_SLOT, refreshAll ? 1 : 0],
    )
  )
    .slice(0, limit)
    .reverse();
  const total = queue.length;
  log(`nicknames: ${total} karakter`);
  const counts = { ok: 0, skipped: 0 };
  let done = 0;
  const workers = Array.from({ length: 3 }, async () => {
    for (let row = queue.pop(); row; row = queue.pop()) {
      try {
        const d = await characterDetail(Number(row.char_id));
        await run('UPDATE anime_character SET nicknames = ?, name_kanji = ?, details_at = ? WHERE mal_id = ? AND char_id = ?', [
          JSON.stringify((d.nicknames ?? []).filter(Boolean)),
          d.nameKanji || null,
          nowIso(),
          row.mal_id,
          row.char_id,
        ]);
        counts.ok++;
      } catch (err) {
        counts.skipped++;
        log(`nicknames: ${row.char_id} dilewati (${errorText(err)})`);
      }
      if (++done % 100 === 0) log(`nicknames: ${done}/${total}`, counts);
    }
  });
  await Promise.all(workers);
  log('nicknames:', counts);
}

/** Seconds into the opening to try, in order: the middle first, away from the title card at the start. */
const SHOT_TIMES = [45, 32, 58, 22];
const SCREENSHOT_WIDTH = 960;

interface Frame {
  out: Uint8Array<ArrayBuffer>;
  at: number;
}

/**
 * One frame of the opening's video: ffmpeg seeks over HTTP to each candidate time and keeps the first
 * frame that is neither near-black/near-white nor flat (signalstats mean and 10–90 % luma spread).
 * The video host answers 5xx under load and a cut-off read fails decoding, so an ffmpeg failure is
 * retried and, if it persists, reported as transient (the title is skipped, not marked broken).
 */
async function pickFrame(videoUrl: string): Promise<Frame | null> {
  for (const at of SHOT_TIMES) {
    let result: FfmpegResult | null = null;
    for (let attempt = 1; !result; attempt++) {
      try {
        result = await ffmpeg([
          '-ss', String(at), '-rw_timeout', '60000000', '-i', videoUrl, '-frames:v', '1',
          '-vf', `scale='min(${SCREENSHOT_WIDTH},iw)':-2,signalstats,metadata=print`,
          '-c:v', 'libwebp', '-quality', '80', '-f', 'image2pipe', 'pipe:1',
        ]);
      } catch (err) {
        if (!(err instanceof MediaError)) throw err;
        if (attempt >= 3) throw new Error(err.message);
        await sleep(10_000 * attempt);
      }
    }
    const stat = (name: string) => Number(result.log.match(new RegExp(`signalstats\\.${name}=([\\d.]+)`))?.[1] ?? NaN);
    const mean = stat('YAVG');
    const spread = stat('YHIGH') - stat('YLOW');
    if (result.out.length > 8_000 && mean >= 40 && mean <= 220 && spread >= 50) return { out: result.out, at };
  }
  return null;
}

/**
 * Screenshot mode: one frame per title from its first opening's video (the smallest file AnimeThemes
 * has), WebP 960 wide at v1/shot/<hash>.webp. Seeking a 1080p video over HTTP costs ~25 s and a few MB
 * per frame, so only easy + medium titles (≥ MEDIUM_MIN_MEMBERS, the daily pool) are processed.
 */
export async function stepScreenshots(refreshAll: boolean, limit: number) {
  const anime = await all<{ mal_id: number }>('SELECT mal_id FROM anime WHERE excluded IS NULL AND members >= ? ORDER BY members DESC', [MEDIUM_MIN_MEMBERS]);
  const rows = await all<MediaRow>(`SELECT mal_id, kind, status, source_url, checked_at FROM anime_media WHERE kind = 'shots'`);
  const byId = new Map(rows.map((r) => [Number(r.mal_id), r]));
  const stale = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
  const queue = anime
    .map((a) => Number(a.mal_id))
    .filter((id) => isDue(byId.get(id), refreshAll, stale))
    .slice(0, limit)
    .reverse();
  const total = queue.length;
  log(`screenshots: ${total} judul`);
  const counts = { ok: 0, missing: 0, broken: 0, skipped: 0 };
  let done = 0;
  // Video seeks are the heavy part; a few in parallel keeps AnimeThemes' file host comfortable.
  const workers = Array.from({ length: 3 }, async () => {
    for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
      try {
        const video = (await firstThemes(id)).op?.videoUrl ?? null;
        if (!video) {
          await save(id, 'shots', { status: 'missing', error: 'tidak ada video opening' });
          counts.missing++;
        } else {
          try {
            const frame = await pickFrame(video);
            if (!frame) {
              await save(id, 'shots', { status: 'missing', source: video, error: 'tidak ada frame yang layak' });
              counts.missing++;
            } else {
              const key = contentKey('shot', frame.out, 'webp');
              await putObject(key, frame.out, 'image/webp');
              await db().batch(
                [
                  { sql: 'DELETE FROM anime_screenshot WHERE mal_id = ?', args: [id] },
                  { sql: 'INSERT INTO anime_screenshot (mal_id, slot, r2_key, at_seconds) VALUES (?, 0, ?, ?)', args: [id, key, frame.at] },
                ],
                'write',
              );
              await save(id, 'shots', { status: 'ok', source: video });
              counts.ok++;
            }
          } catch (err) {
            if (!isSourceFault(err)) throw err;
            await save(id, 'shots', { status: 'broken', source: video, error: errorText(err) });
            counts.broken++;
          }
        }
      } catch (err) {
        counts.skipped++;
        log(`screenshots: ${id} dilewati (${errorText(err)})`);
      }
      if (++done % 25 === 0) log(`screenshots: ${done}/${total}`, counts);
    }
  });
  await Promise.all(workers);
  log('screenshots:', counts);
}
