import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { CANONICAL_SQL, MEDIUM_MIN_MEMBERS } from '../shared/catalog.js';
import { CHARACTER_MIN_FAVORITES, CHARACTERS_PER_DIFFICULTY, characterDifficultyOf, isRomaji } from '../shared/characters.js';
import { SCREENSHOTS_PER_TITLE, type MediaKind } from '../shared/modes.js';
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
  video_url: string | null;
  checked_at: string;
}

/**
 * Whether a title's media of one kind needs (re)processing: never processed, or missing/broken and not
 * looked at since `stale`. ok and admin-rejected rows are only redone with --refresh.
 */
const isDue = (row: MediaRow | undefined, refreshAll: boolean, stale: string) =>
  refreshAll || !row || ((row.status === 'missing' || row.status === 'broken') && row.checked_at < stale);

/** A clip made for an earlier source of the same theme is dropped when the source changes. */
async function save(malId: number, kind: MediaKind, row: { status: MediaRow['status']; key?: string | null; source?: string | null; theme?: ThemeSource | null; error?: string | null }) {
  await run(
    `INSERT INTO anime_media (mal_id, kind, status, r2_key, source_url, label, song_title, artist, video_url, error, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (mal_id, kind) DO UPDATE SET status = excluded.status, r2_key = excluded.r2_key, source_url = excluded.source_url,
       label = excluded.label, song_title = excluded.song_title, artist = excluded.artist, video_url = excluded.video_url, error = excluded.error,
       checked_at = excluded.checked_at, clip_key = CASE WHEN anime_media.source_url IS excluded.source_url THEN anime_media.clip_key END`,
    [
      malId,
      kind,
      row.status,
      row.key ?? null,
      row.source ?? null,
      row.theme?.label ?? null,
      row.theme?.title ?? null,
      row.theme?.artist ?? null,
      row.theme ? (row.theme.videoUrl ?? '') : null,
      row.error ?? null,
      nowIso(),
    ],
  );
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/**
 * The source itself is bad (ffmpeg rejects it, output fails validation, or its host answers 4xx), so
 * the title is marked broken. Anything else (network, R2, database) is transient and only skipped.
 */
const isSourceFault = (err: unknown) => err instanceof MediaError || (err instanceof UpstreamError && err.status >= 400 && err.status < 500 && err.status !== 429);

/**
 * Per playable show (canonical entry), most popular first: copies the cover to R2 and records the first OP and first ED
 * on AnimeThemes (audio URL + song info; the game streams them). Re-runs skip what is already ok;
 * missing/broken sources are retried after RECHECK_DAYS, or always with --refresh.
 */
export async function stepMedia(refreshAll: boolean, limit: number) {
  const anime = await all<{ mal_id: number; cover_src: string | null }>(`SELECT mal_id, cover_src FROM anime a WHERE excluded IS NULL AND ${CANONICAL_SQL} ORDER BY members DESC`);
  const rows = await all<MediaRow>('SELECT mal_id, kind, status, source_url, video_url, checked_at FROM anime_media');
  const byKey = new Map(rows.map((r) => [`${r.mal_id}:${r.kind}`, r]));
  const stale = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
  const due = (row: MediaRow | undefined) => isDue(row, refreshAll, stale);
  // OP/ED recorded before their smallest video was: fetch the theme again for its video_url.
  const needsVideo = (row: MediaRow | undefined) => row?.status === 'ok' && row.video_url == null;

  const jobs = anime
    .map((a) => ({
      id: Number(a.mal_id),
      coverSrc: a.cover_src,
      cover: refreshAll || due(byKey.get(`${a.mal_id}:cover`)) || byKey.get(`${a.mal_id}:cover`)?.source_url !== a.cover_src,
      themes: [`${a.mal_id}:op`, `${a.mal_id}:ed`].some((key) => due(byKey.get(key)) || needsVideo(byKey.get(key))),
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
            // Same source as last time, already decided (ok, or rejected by an admin) and its video known: nothing to do.
            if (!refreshAll && (prev?.status === 'ok' || prev?.status === 'rejected') && prev.source_url === theme?.audioUrl && !needsVideo(prev)) continue;
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
 * Character mode and Anidle's last clue: per show, the CHARACTERS_PER_DIFFICULTY best-known characters
 * of each difficulty (by MAL favorites, characterDifficultyOf), from jikan-edge, with a portrait and at
 * least CHARACTER_MIN_FAVORITES. Stored best known first (slot 0). Shows with fewer than two are
 * `missing` (Anidle shows two). --refresh redoes every show, e.g. after a threshold changes.
 */
export async function stepCharacters(refreshAll: boolean, limit: number) {
  const anime = await all<{ mal_id: number }>(`SELECT mal_id FROM anime a WHERE excluded IS NULL AND ${CANONICAL_SQL} ORDER BY members DESC`);
  const rows = await all<MediaRow>(`SELECT mal_id, kind, status, source_url, video_url, checked_at FROM anime_media WHERE kind = 'chars'`);
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
        const known = (await animeCharacters(id))
          .filter((c) => !isPlaceholder(c.imageUrl) && (c.favorites ?? 0) >= CHARACTER_MIN_FAVORITES)
          .sort((a, b) => (b.favorites ?? 0) - (a.favorites ?? 0));
        const perDifficulty = Map.groupBy(known, (c) => characterDifficultyOf(c.favorites ?? 0));
        const picked = [...perDifficulty.values()].flatMap((list) => list.slice(0, CHARACTERS_PER_DIFFICULTY)).sort((a, b) => (b.favorites ?? 0) - (a.favorites ?? 0));
        // Every known character of the show, kept or not: Character mode accepts any show a character is in.
        const appearances = [
          { sql: 'DELETE FROM character_show WHERE mal_id = ?', args: [id] },
          ...known.map((c) => ({ sql: 'INSERT OR IGNORE INTO character_show (char_id, mal_id) VALUES (?, ?)', args: [c.malId, id] })),
        ];
        if (picked.length < 2) {
          await db().batch(appearances, 'write');
          await save(id, 'chars', { status: 'missing', error: `${picked.length} karakter bergambar dengan ≥ ${CHARACTER_MIN_FAVORITES} favorit` });
          counts.missing++;
        } else {
          try {
            const keys = await Promise.all(picked.map((c) => processImage(c.imageUrl!, 'char', PORTRAIT_WIDTH)));
            // Nicknames already fetched for a character (step `nicknames`) carry over.
            const details = new Map(
              (await all<{ char_id: number; nicknames: string; details_at: string | null }>('SELECT char_id, nicknames, details_at FROM anime_character WHERE mal_id = ?', [id])).map(
                (d) => [Number(d.char_id), d],
              ),
            );
            await db().batch(
              [
                ...appearances,
                { sql: 'DELETE FROM anime_character WHERE mal_id = ?', args: [id] },
                ...picked.map((c, slot) => {
                  const d = details.get(c.malId);
                  return {
                    sql: `INSERT INTO anime_character (mal_id, slot, char_id, name, role, favorites, r2_key, nicknames, details_at)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    args: [id, slot, c.malId, c.name, c.role, c.favorites, keys[slot]!, d?.nicknames ?? '[]', d?.details_at ?? null],
                  };
                }),
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
 * Romaji nicknames of every stored character (jikan-edge character detail), so the name autocomplete
 * also finds "Ed" or "Fullmetal Alchemist" (kana/kanji ones are dropped: names are answered in romaji).
 * Best-known characters first; ones already fetched are skipped unless --refresh. A character listed
 * under several shows is asked for once.
 */
export async function stepNicknames(refreshAll: boolean, limit: number) {
  const queue = (
    await all<{ char_id: number }>(
      `SELECT char_id FROM anime_character WHERE (? OR details_at IS NULL) GROUP BY char_id ORDER BY MAX(favorites) DESC`,
      [refreshAll ? 1 : 0],
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
        await run('UPDATE anime_character SET nicknames = ?, details_at = ? WHERE char_id = ?', [
          JSON.stringify((d.nicknames ?? []).filter((n) => n && isRomaji(n))),
          nowIso(),
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

/**
 * Seconds into the opening to try, in order: spread over the song so the screenshots show different
 * scenes, away from the title card at the start.
 */
const SHOT_TIMES = [45, 70, 22, 58, 82, 32, 12, 64];
const SCREENSHOT_WIDTH = 960;

interface Frame {
  out: Uint8Array<ArrayBuffer>;
  at: number;
}

/**
 * One frame of the opening's video at the first of `times` that is neither near-black/near-white nor
 * flat (signalstats mean and 10–90 % luma spread); ffmpeg seeks over HTTP. The video host answers 5xx
 * under load and a cut-off read fails decoding, so an ffmpeg failure is retried and, if it persists,
 * reported as transient (the title is skipped, not marked broken).
 */
async function pickFrame(videoUrl: string, times: number[]): Promise<Frame | null> {
  for (const at of times) {
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
    // A clip shorter than `at` yields no frame at all.
    if (result.out.length > 8_000 && mean >= 40 && mean <= 220 && spread >= 50) return { out: result.out, at };
  }
  return null;
}

/**
 * Screenshot mode: SCREENSHOTS_PER_TITLE frames per show from its first opening's video (the smallest
 * file AnimeThemes has), WebP 960 wide at v1/shot/<hash>.webp. Frames already stored are kept, so a
 * show that had fewer only fetches the rest. Seeking a 1080p video over HTTP costs ~25 s and a few MB
 * per frame, so only easy + medium shows (≥ MEDIUM_MIN_MEMBERS, the daily pool) are processed.
 */
export async function stepScreenshots(refreshAll: boolean, limit: number) {
  const anime = await all<{ mal_id: number }>(`SELECT mal_id FROM anime a WHERE excluded IS NULL AND ${CANONICAL_SQL} AND members >= ? ORDER BY members DESC`, [MEDIUM_MIN_MEMBERS]);
  const rows = await all<MediaRow>(`SELECT mal_id, kind, status, source_url, checked_at FROM anime_media WHERE kind = 'shots'`);
  const byId = new Map(rows.map((r) => [Number(r.mal_id), r]));
  const stored = Map.groupBy(await all<{ mal_id: number; slot: number; at_seconds: number }>('SELECT mal_id, slot, at_seconds FROM anime_screenshot ORDER BY slot'), (s) => Number(s.mal_id));
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
            // --refresh starts over; otherwise stored frames stay and only the missing slots are fetched.
            const kept = refreshAll ? [] : (stored.get(id) ?? []).map((s) => ({ slot: Number(s.slot), at: Number(s.at_seconds) }));
            const used = new Set(kept.map((k) => k.at));
            const fresh: Array<{ slot: number; key: string; at: number }> = [];
            for (let slot = 0; slot < SCREENSHOTS_PER_TITLE; slot++) {
              if (kept.some((k) => k.slot === slot)) continue;
              const frame = await pickFrame(video, SHOT_TIMES.filter((t) => !used.has(t)));
              if (!frame) break;
              used.add(frame.at);
              const key = contentKey('shot', frame.out, 'webp');
              await putObject(key, frame.out, 'image/webp');
              fresh.push({ slot, key, at: frame.at });
            }
            // Frames found are kept even when too few, so a later run only looks for the rest.
            await db().batch(
              [
                ...(refreshAll ? [{ sql: 'DELETE FROM anime_screenshot WHERE mal_id = ?', args: [id] }] : []),
                ...fresh.map((f) => ({ sql: 'INSERT OR REPLACE INTO anime_screenshot (mal_id, slot, r2_key, at_seconds) VALUES (?, ?, ?, ?)', args: [id, f.slot, f.key, f.at] })),
              ],
              'write',
            );
            const found = kept.length + fresh.length;
            if (found < SCREENSHOTS_PER_TITLE) {
              await save(id, 'shots', { status: 'missing', source: video, error: `hanya ${found} frame yang layak` });
              counts.missing++;
            } else {
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

const CLIP_HEIGHT = 240;

/**
 * The OP/ED clue as a small clip: the theme's video re-encoded to 240p H.264 without sound (the song
 * keeps playing and the clip follows it), ~1.5 MB instead of 30–60 MB, at v1/clip/<hash>.mp4. It is
 * shown blurred, so the low resolution does not show. R2's free 10 GB sets the scope: easy + medium
 * shows (the daily pool) only; other titles stream video_url through /api/media as before. A video
 * the encoder rejects gets clip_key '' (streamed instead), retried with --refresh.
 */
export async function stepClips(refreshAll: boolean, limit: number) {
  const queue = (
    await all<{ mal_id: number; kind: MediaKind; video_url: string }>(
      `SELECT m.mal_id, m.kind, m.video_url FROM anime_media m JOIN anime a ON a.mal_id = m.mal_id
       WHERE m.kind IN ('op', 'ed') AND m.status = 'ok' AND m.video_url <> '' AND (? OR m.clip_key IS NULL)
         AND a.excluded IS NULL AND ${CANONICAL_SQL} AND a.members >= ?
       ORDER BY a.members DESC, m.kind DESC`,
      [refreshAll ? 1 : 0, MEDIUM_MIN_MEMBERS],
    )
  )
    .slice(0, limit)
    .reverse();
  const total = queue.length;
  log(`clips: ${total} lagu`);
  const counts = { ok: 0, failed: 0, skipped: 0 };
  const dir = await mkdtemp(path.join(tmpdir(), 'anidle-clip-'));
  let done = 0;
  // Each clip reads the whole 30–60 MB video; two at a time keeps AnimeThemes' file host comfortable.
  const workers = Array.from({ length: 2 }, async (_, w) => {
    const file = path.join(dir, `clip-${w}.mp4`);
    for (let row = queue.pop(); row; row = queue.pop()) {
      const id = Number(row.mal_id);
      try {
        // mp4 needs a seekable output for +faststart (the index first, so the browser can start right away).
        // The video host answers 5xx in bursts when busy: wait and try again (30 s, 60 s, 90 s) before skipping.
        let result: FfmpegResult | null = null;
        for (let attempt = 1; !result; attempt++) {
          try {
            result = await ffmpeg([
              '-rw_timeout', '60000000', '-i', row.video_url, '-an',
              '-vf', `scale=-2:${CLIP_HEIGHT},fps=24`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-pix_fmt', 'yuv420p',
              '-movflags', '+faststart', '-y', file,
            ]);
          } catch (err) {
            if (!(err instanceof MediaError) || attempt >= 4) throw err;
            await sleep(30_000 * attempt);
          }
        }
        const { seconds } = result;
        const out = new Uint8Array(await readFile(file));
        if (out.length < 50_000 || seconds < 20) throw new MediaError(`klip terlalu pendek (${out.length} B, ${seconds} dtk)`);
        const key = contentKey('clip', out, 'mp4');
        await putObject(key, out, 'video/mp4');
        await run('UPDATE anime_media SET clip_key = ? WHERE mal_id = ? AND kind = ?', [key, id, row.kind]);
        counts.ok++;
      } catch (err) {
        // ffmpeg exits non-zero for a 5xx from the host as well; only a clean but bad result marks the theme.
        if (err instanceof MediaError && err.message.startsWith('klip')) {
          await run("UPDATE anime_media SET clip_key = '' WHERE mal_id = ? AND kind = ?", [id, row.kind]);
          counts.failed++;
        } else counts.skipped++;
        log(`clips: ${id} ${row.kind} ${errorText(err)}`);
      }
      if (++done % 25 === 0) log(`clips: ${done}/${total}`, counts);
    }
  });
  await Promise.all(workers);
  await rm(dir, { recursive: true, force: true });
  log('clips:', counts);
}
