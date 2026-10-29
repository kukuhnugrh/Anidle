import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { CANONICAL_SQL, MEDIUM_MIN_MEMBERS } from '../shared/catalog.js';
import { CHARACTER_MIN_FAVORITES, isRomaji } from '../shared/characters.js';
import { SCREENSHOTS_PER_TITLE, shiftDate, todayUtc7, type MediaKind } from '../shared/modes.js';
import { all, db, nowIso, run } from '../server/db.js';
import { dailyPuzzle } from '../server/game.js';
import { songSources } from '../server/songs.js';
import { Limiter, sleep, UpstreamError } from './limiter.js';
import { deleteObject, putObject } from './r2.js';
import { entryThemes, firstTheme, type ThemeSource } from './sources/animeThemes.js';
import { animeCharacters, characterDetail, type JikanCharacter } from './sources/jikanEdge.js';

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

async function save(malId: number, kind: MediaKind, row: { status: MediaRow['status']; key?: string | null; source?: string | null; error?: string | null }) {
  await run(
    `INSERT INTO anime_media (mal_id, kind, status, r2_key, source_url, error, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (mal_id, kind) DO UPDATE SET status = excluded.status, r2_key = excluded.r2_key, source_url = excluded.source_url,
       error = excluded.error, checked_at = excluded.checked_at`,
    [malId, kind, row.status, row.key ?? null, row.source ?? null, row.error ?? null, nowIso()],
  );
}

/**
 * Stores what AnimeThemes now lists for one MAL entry: themes upserted by id (an admin's rejection is
 * kept; the clip is dropped when the audio changed), themes it no longer lists marked missing (kept, so
 * old rounds still find their song; never asked again), themes_at set.
 */
async function saveThemes(malId: number, themes: ThemeSource[]) {
  const now = nowIso();
  await db().batch(
    [
      ...themes.map((t) => ({
        sql: `INSERT INTO anime_theme (id, mal_id, kind, seq, label, song_title, artist, audio_url, video_url, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (id) DO UPDATE SET mal_id = excluded.mal_id, kind = excluded.kind, seq = excluded.seq, label = excluded.label,
                song_title = excluded.song_title, artist = excluded.artist, audio_url = excluded.audio_url, video_url = excluded.video_url,
                status = CASE WHEN anime_theme.status = 'rejected' THEN 'rejected' ELSE 'ok' END,
                checked_at = excluded.checked_at, clip_key = CASE WHEN anime_theme.audio_url = excluded.audio_url THEN anime_theme.clip_key END`,
        args: [t.id, malId, t.kind, t.seq, t.label, t.title, t.artist, t.audioUrl, t.videoUrl ?? '', now],
      })),
      {
        sql: `UPDATE anime_theme SET status = 'missing', checked_at = ? WHERE mal_id = ? AND status = 'ok' AND id NOT IN (SELECT value FROM json_each(?))`,
        args: [now, malId, JSON.stringify(themes.map((t) => t.id))],
      },
      { sql: 'UPDATE anime SET themes_at = ? WHERE mal_id = ?', args: [now, malId] },
    ],
    'write',
  );
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/**
 * The source itself is bad (ffmpeg rejects it, output fails validation, or its host answers 4xx), so
 * the title is marked broken. Anything else (network, R2, database) is transient and only skipped.
 */
const isSourceFault = (err: unknown) => err instanceof MediaError || (err instanceof UpstreamError && err.status >= 400 && err.status < 500 && err.status !== 429);

/**
 * Per playable show (canonical entry), most popular first: copies the cover to R2, and records every OP
 * and ED of each of its MAL entries (the canonical one and those merged into it) from AnimeThemes in
 * anime_theme (audio URL, smallest video, song info; the game streams them). Re-runs skip what is already
 * done: an entry with themes is only asked again with --refresh, one without after RECHECK_DAYS; a
 * missing/broken cover is retried after RECHECK_DAYS, or always with --refresh.
 */
export async function stepMedia(refreshAll: boolean, limit: number) {
  const anime = await all<{ mal_id: number; cover_src: string | null }>(`SELECT mal_id, cover_src FROM anime a WHERE excluded IS NULL AND ${CANONICAL_SQL} ORDER BY members DESC`);
  const covers = new Map((await all<MediaRow>("SELECT mal_id, kind, status, source_url, checked_at FROM anime_media WHERE kind = 'cover'")).map((r) => [Number(r.mal_id), r]));
  const stale = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
  const entries = await all<{ mal_id: number; show: number; themes_at: string | null; themes: number }>(
    `SELECT e.mal_id, a.mal_id AS show, e.themes_at, (SELECT COUNT(*) FROM anime_theme t WHERE t.mal_id = e.mal_id) AS themes
     FROM anime e JOIN anime a ON a.mal_id = COALESCE(e.canonical_id, e.mal_id)
     WHERE e.excluded IS NULL AND a.excluded IS NULL AND ${CANONICAL_SQL}
     ORDER BY e.members DESC`,
  );
  const themesDue = Map.groupBy(
    entries.filter((e) => refreshAll || e.themes_at == null || (Number(e.themes) === 0 && e.themes_at < stale)),
    (e) => Number(e.show),
  );

  const jobs = anime
    .map((a) => ({
      id: Number(a.mal_id),
      coverSrc: a.cover_src,
      cover: isDue(covers.get(Number(a.mal_id)), refreshAll, stale) || covers.get(Number(a.mal_id))?.source_url !== a.cover_src,
      entries: (themesDue.get(Number(a.mal_id)) ?? []).map((e) => Number(e.mal_id)),
    }))
    .filter((j) => j.cover || j.entries.length)
    .slice(0, limit);
  log(`media: ${jobs.length} judul (cover ${jobs.filter((j) => j.cover).length}, entri OP/ED ${jobs.reduce((n, j) => n + j.entries.length, 0)})`);

  const counts: Record<string, number> = {};
  const count = (key: string, n = 1) => (counts[key] = (counts[key] ?? 0) + n);
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
              count('cover ok');
            } catch (err) {
              if (!isSourceFault(err)) throw err;
              await save(job.id, 'cover', { status: 'broken', source: job.coverSrc, error: errorText(err) });
              count('cover broken');
            }
        }
      } catch (err) {
        // Network, R2 or database trouble: nothing is marked, so the next run tries this cover again.
        count('skipped');
        log(`media: ${job.id} cover dilewati (${errorText(err)})`);
      }
      for (const entry of job.entries) {
        try {
          // The game streams the songs from AnimeThemes through /api/media; only the sources are kept.
          const themes = await entryThemes(entry);
          await saveThemes(entry, themes);
          count('op', themes.filter((t) => t.kind === 'op').length);
          count('ed', themes.filter((t) => t.kind === 'ed').length);
          if (!themes.length) count('entri tanpa lagu');
        } catch (err) {
          // Network, host or database trouble: the entry is left as it was, so the next run asks again.
          count('skipped');
          log(`media: ${entry} OP/ED dilewati (${errorText(err)})`);
        }
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
 * Character mode and Anidle's last clue: every character with a portrait and at least
 * CHARACTER_MIN_FAVORITES from every MAL entry of the show (the canonical entry and each season, movie
 * or OVA merged into it), from jikan-edge, stored under the show id best known first (slot 0). A
 * character in several entries is stored once (its most favorites; Main if any entry says so).
 * Shows with fewer than two are `missing` (Anidle shows two) and keep no characters. --refresh redoes
 * every show, e.g. after a threshold changes.
 */
export async function stepCharacters(refreshAll: boolean, limit: number) {
  const anime = await all<{ mal_id: number }>(`SELECT mal_id FROM anime a WHERE excluded IS NULL AND ${CANONICAL_SQL} ORDER BY members DESC`);
  // The entries of each show, the canonical one included.
  const entries = Map.groupBy(
    await all<{ mal_id: number; show: number }>('SELECT mal_id, COALESCE(canonical_id, mal_id) AS show FROM anime WHERE excluded IS NULL'),
    (e) => Number(e.show),
  );
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
        // One request per entry. The show's own entry must load (else the show is skipped below, nothing
        // marked); a merged entry jikan-edge refuses is left as it was for the next run.
        const failed: number[] = [];
        const lists = (
          await Promise.all(
            (entries.get(id) ?? []).map(async (e) => {
              const entry = Number(e.mal_id);
              try {
                const known = (await animeCharacters(entry)).filter((c) => !isPlaceholder(c.imageUrl) && (c.favorites ?? 0) >= CHARACTER_MIN_FAVORITES);
                return { entry, known };
              } catch (err) {
                if (entry === id) throw err;
                failed.push(entry);
                log(`characters: ${id} entri ${entry} dilewati (${errorText(err)})`);
                return null;
              }
            }),
          )
        ).filter((l) => l !== null);
        const merged = new Map<number, JikanCharacter>();
        for (const c of lists.flatMap((l) => l.known)) {
          const seen = merged.get(c.malId);
          if (!seen) merged.set(c.malId, c);
          else {
            const best = (c.favorites ?? 0) > (seen.favorites ?? 0) ? c : seen;
            merged.set(c.malId, { ...best, role: seen.role === 'Main' || c.role === 'Main' ? 'Main' : (best.role ?? seen.role ?? c.role) });
          }
        }
        // With an entry missing this run, the show's stored characters stay (their portraits are reused).
        if (failed.length)
          for (const c of await all<{ char_id: number; name: string; role: string | null; favorites: number | null }>(
            'SELECT char_id, name, role, favorites FROM anime_character WHERE mal_id = ?',
            [id],
          ))
            if (!merged.has(Number(c.char_id))) merged.set(Number(c.char_id), { malId: Number(c.char_id), name: c.name, imageUrl: null, role: c.role, favorites: c.favorites });
        const picked = [...merged.values()].sort((a, b) => (b.favorites ?? 0) - (a.favorites ?? 0));
        // Each entry's own characters: Character mode accepts any show a character is in.
        const appearances = lists.flatMap(({ entry, known }) => [
          { sql: 'DELETE FROM character_show WHERE mal_id = ?', args: [entry] },
          ...known.map((c) => ({ sql: 'INSERT OR IGNORE INTO character_show (char_id, mal_id) VALUES (?, ?)', args: [c.malId, entry] })),
        ]);
        // A show without two characters is never asked; its rows stay, so old puzzles keep their slots.
        if (picked.length < 2) {
          await db().batch(appearances, 'write');
          await save(id, 'chars', { status: 'missing', error: `${picked.length} karakter bergambar dengan ≥ ${CHARACTER_MIN_FAVORITES} favorit` });
          counts.missing++;
        } else {
          try {
            // Portrait, nicknames and details already stored for a character (under any show) carry over;
            // only characters never stored before are downloaded.
            const stored = new Map<number, { r2_key: string; nicknames: string; details_at: string | null }>();
            const prior = await all<{ char_id: number; r2_key: string; nicknames: string; details_at: string | null }>(
              `SELECT char_id, r2_key, nicknames, details_at FROM anime_character WHERE char_id IN (${picked.map(() => '?').join(', ')}) ORDER BY details_at IS NULL`,
              picked.map((c) => c.malId),
            );
            for (const d of prior) if (!stored.has(Number(d.char_id))) stored.set(Number(d.char_id), d);
            const keys = await Promise.all(picked.map((c) => stored.get(c.malId)?.r2_key ?? processImage(c.imageUrl!, 'char', PORTRAIT_WIDTH)));
            await db().batch(
              [
                ...appearances,
                { sql: 'DELETE FROM anime_character WHERE mal_id = ?', args: [id] },
                ...picked.map((c, slot) => {
                  const d = stored.get(c.malId);
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
        const video = firstTheme(await entryThemes(id), 'op')?.videoUrl ?? null;
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
 * One theme's clue clip: encoded from `videoUrl`, uploaded, and recorded as its anime_theme.clip_key ('' when
 * the encoder's result is unusable, so it is streamed instead). Throws when the host is in trouble, so the
 * theme is tried again on a later run. `file` is a scratch path (mp4 needs a seekable output).
 */
export async function makeClip(themeId: number, videoUrl: string, file: string): Promise<'ok' | 'failed'> {
  // The video host answers 5xx in bursts when busy: wait and try again (30 s, 60 s, 90 s) before giving up.
  let result: FfmpegResult | null = null;
  for (let attempt = 1; !result; attempt++) {
    try {
      result = await ffmpeg([
        '-rw_timeout', '60000000', '-i', videoUrl, '-an',
        '-vf', `scale=-2:${CLIP_HEIGHT},fps=24`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-pix_fmt', 'yuv420p',
        // +faststart puts the index first, so the browser can start right away.
        '-movflags', '+faststart', '-y', file,
      ]);
    } catch (err) {
      if (!(err instanceof MediaError) || attempt >= 4) throw err;
      await sleep(30_000 * attempt);
    }
  }
  const out = new Uint8Array(await readFile(file));
  // ffmpeg exits non-zero for a 5xx from the host as well (thrown above); only a clean but bad result marks the theme.
  if (out.length < 50_000 || result.seconds < 20) {
    await run("UPDATE anime_theme SET clip_key = '' WHERE id = ?", [themeId]);
    log(`clips: lagu ${themeId} klip terlalu pendek (${out.length} B, ${result.seconds} dtk)`);
    return 'failed';
  }
  const key = contentKey('clip', out, 'mp4');
  await putObject(key, out, 'video/mp4');
  await run('UPDATE anime_theme SET clip_key = ? WHERE id = ?', [key, themeId]);
  return 'ok';
}

/**
 * The OP/ED clue as a small clip: the theme's video re-encoded to 240p H.264 without sound (the song
 * keeps playing and the clip follows it), ~1.5 MB instead of 30–60 MB, at v1/clip/<hash>.mp4. It is
 * shown blurred, so the low resolution does not show. R2's free 10 GB sets the scope: the first OP and
 * first ED of the canonical entry of easy + medium shows (the daily pool) only; every other song streams
 * its video_url through /api/media (step `daily` still clips each daily round's song). A video the
 * encoder rejects gets clip_key '' (streamed instead), retried with --refresh.
 */
export async function stepClips(refreshAll: boolean, limit: number) {
  const queue = (
    await all<{ id: number; mal_id: number; label: string; video_url: string }>(
      `SELECT id, mal_id, label, video_url FROM (
         SELECT t.id, t.mal_id, t.kind, t.label, t.video_url, t.clip_key, a.members,
           ROW_NUMBER() OVER (PARTITION BY t.mal_id, t.kind ORDER BY t.seq, length(t.label), t.id) AS n
         FROM anime_theme t JOIN anime a ON a.mal_id = t.mal_id
         WHERE t.status = 'ok' AND a.excluded IS NULL AND ${CANONICAL_SQL} AND a.members >= ?)
       WHERE n = 1 AND video_url <> '' AND (? OR clip_key IS NULL)
       ORDER BY members DESC, kind DESC`,
      [MEDIUM_MIN_MEMBERS, refreshAll ? 1 : 0],
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
      try {
        counts[await makeClip(Number(row.id), row.video_url, file)]++;
      } catch (err) {
        counts.skipped++;
        log(`clips: ${row.mal_id} ${row.label} ${errorText(err)}`);
      }
      if (++done % 25 === 0) log(`clips: ${done}/${total}`, counts);
    }
  });
  await Promise.all(workers);
  await rm(dir, { recursive: true, force: true });
  log('clips:', counts);
}

/** Daily song copies on R2 are kept this long; older days' rounds stream from AnimeThemes again. */
const SONG_COPY_DAYS = 7;
/**
 * The copy is re-encoded: AnimeThemes' files are ~3.5 MB (rips at ~300 kb/s), and the player downloads the
 * whole song before it starts. AAC at 112 kb/s in .m4a plays in every browser and is ~1.2 MB for 90 s.
 */
const SONG_BITRATE = '112k';
const songHost = new Limiter('animethemes-files', [{ ms: 1000, max: 2 }]);

/**
 * Gets the Opening and Ending of today and tomorrow (UTC+7) ready before players arrive, so a late or skipped
 * scheduled run does not matter: creates the day's puzzles if nobody has yet, copies each round's full song to
 * R2 re-encoded (puzzle_round.audio_key, v1/song/<hash>.m4a, so the file name gives nothing away) and makes any
 * missing clue clip. Players then stream ~1 MB from Cloudflare instead of ~3.5 MB from AnimeThemes. Copies older
 * than SONG_COPY_DAYS are removed (R2's free 10 GB); a round without a copy streams through /api/media.
 */
export async function stepDaily() {
  const today = todayUtc7();
  const counts = { songs: 0, clips: 0, kept: 0, failed: 0, removed: 0 };
  const dir = await mkdtemp(path.join(tmpdir(), 'anidle-daily-'));
  for (const date of [today, shiftDate(today, 1)]) {
    for (const mode of ['opening', 'ending'] as const) {
      const puzzle = await dailyPuzzle(mode, date);
      const sources = await songSources(puzzle.id, mode);
      for (const [round, source] of sources.entries()) {
        try {
          if (source.audioKey) counts.kept++;
          else {
            const original = await download(songHost, source.audioUrl);
            const file = path.join(dir, 'song.m4a');
            const { seconds } = await ffmpeg(['-i', 'pipe:0', '-vn', '-ac', '2', '-c:a', 'aac', '-b:a', SONG_BITRATE, '-movflags', '+faststart', '-y', file], original);
            const song = new Uint8Array(await readFile(file));
            if (song.length < 100_000 || seconds < 20) throw new MediaError(`lagu terlalu pendek (${song.length} B, ${seconds} dtk)`);
            const key = contentKey('song', song, 'm4a');
            await putObject(key, song, 'audio/mp4');
            await run('UPDATE puzzle_round SET audio_key = ? WHERE puzzle_id = ? AND round = ?', [key, puzzle.id, round]);
            counts.songs++;
          }
          if (!source.clipKey && source.videoUrl && (await makeClip(source.themeId, source.videoUrl, path.join(dir, 'clip.mp4'))) === 'ok') counts.clips++;
        } catch (err) {
          counts.failed++;
          log(`daily: ${date} ${mode} ronde ${round + 1} (${source.malId}) ${errorText(err)}`);
        }
      }
    }
  }
  await rm(dir, { recursive: true, force: true });

  const old = await all<{ puzzle_id: string; round: number; audio_key: string }>(
    `SELECT r.puzzle_id, r.round, r.audio_key FROM puzzle_round r JOIN puzzle p ON p.id = r.puzzle_id WHERE r.audio_key IS NOT NULL AND p.date < ?`,
    [shiftDate(today, -SONG_COPY_DAYS)],
  );
  for (const row of old) {
    await run('UPDATE puzzle_round SET audio_key = NULL WHERE puzzle_id = ? AND round = ?', [row.puzzle_id, row.round]);
    // The same song can back a newer round (same content, same key): only delete an object nothing uses.
    if (!(await all('SELECT 1 FROM puzzle_round WHERE audio_key = ? LIMIT 1', [row.audio_key])).length) await deleteObject(row.audio_key);
    counts.removed++;
  }
  log(`daily: ${today} + ${shiftDate(today, 1)}`, counts);
}
