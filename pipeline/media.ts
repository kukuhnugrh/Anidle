import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { createWorker, OEM, type Worker as OcrWorker } from 'tesseract.js';
import { CANONICAL_SQL, MEDIUM_MIN_MEMBERS } from '../shared/catalog.js';
import { aliasOf, CHARACTER_MIN_FAVORITES, isRomaji, sameCharacterName } from '../shared/characters.js';
import { SCREENSHOTS_PER_TITLE, shiftDate, todayUtc7, type MediaKind } from '../shared/modes.js';
import { USABLE_THEME_SQL } from '../server/catalog.js';
import { all, db, nowIso, run } from '../server/db.js';
import { dailyPuzzle } from '../server/game.js';
import { mediaUrl } from '../server/media.js';
import { songSources, themeVideoUrl } from '../server/songs.js';
import { DETECT_FILTER, DETECT_SIZE, faceDetector } from './faces.js';
import { Limiter, sleep, UpstreamError } from './limiter.js';
import { deleteObject, putObject } from './r2.js';
import { entryThemes, type ThemeSource } from './sources/animeThemes.js';
import { anilistCharacters } from './sources/anilist.js';
import { animeCharacters, characterDetail, type JikanCharacter } from './sources/jikanEdge.js';
import { hiddenSpans, showsTitle, titleKeys } from './titleText.js';

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

/**
 * Runs ffmpeg with `input` on stdin (or a URL in args) and returns stdout plus the encoded length.
 * With `timeoutMs` it is killed past that long (a slow host makes a whole-video read take an hour).
 */
function ffmpeg(args: string[], input?: Uint8Array, timeoutMs?: number): Promise<FfmpegResult> {
  if (!ffmpegPath) throw new Error('ffmpeg-static tidak punya binary untuk platform ini.');
  const { promise, resolve, reject } = Promise.withResolvers<FfmpegResult>();
  const child = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-loglevel', 'info', ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  let timedOut = false;
  const timer = timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs)
    : undefined;
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
    clearTimeout(timer);
    // Not a MediaError: callers retry those (host hiccups), a timeout would only repeat.
    if (timedOut) return reject(new Error(`ffmpeg dihentikan setelah ${timeoutMs! / 1000} dtk (host lambat)`));
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

/** R2 key named after the content's hash, so objects never change and are cached forever (and URLs reveal nothing). */
export const contentKey = (dir: string, body: Uint8Array, ext: string) => `v1/${dir}/${createHash('sha256').update(body).digest('hex').slice(0, 24)}.${ext}`;

/** A download is given up after this long without a byte, however slow (but moving) the file is. */
const DOWNLOAD_IDLE_MS = 60_000;

/** GET through `limiter`, which retries network errors (a stalled download too), 429 and 5xx. */
function download(limiter: Limiter, url: string): Promise<Uint8Array<ArrayBuffer>> {
  return limiter.schedule(async () => {
    const abort = new AbortController();
    const stalled = () => abort.abort(new Error(`tidak ada data selama ${DOWNLOAD_IDLE_MS / 1000} dtk`));
    let timer = setTimeout(stalled, DOWNLOAD_IDLE_MS);
    try {
      const res = await fetch(url, { signal: abort.signal });
      if (!res.ok) throw new UpstreamError(res.status, `${res.status} ${url}`);
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of res.body ?? []) {
        clearTimeout(timer);
        timer = setTimeout(stalled, DOWNLOAD_IDLE_MS);
        chunks.push(chunk);
        size += chunk.length;
      }
      const out = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        out.set(c, at);
        at += c.length;
      }
      return out;
    } finally {
      clearTimeout(timer);
    }
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
 * kept; the clip and the scanned title spans are dropped when the audio changed), themes it no longer lists marked missing (kept, so
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
                checked_at = excluded.checked_at, clip_key = CASE WHEN anime_theme.audio_url = excluded.audio_url THEN anime_theme.clip_key END,
                title_spans = CASE WHEN anime_theme.audio_url = excluded.audio_url THEN anime_theme.title_spans END`,
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
 * Shows without any are `missing` (one is enough: Character mode asks one character per show, Anidle's
 * clue shows up to two). --refresh redoes every show, e.g. after a threshold changes.
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
        // A show without a known character is never asked; its rows stay, so old puzzles keep their slots.
        if (!picked.length) {
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

/** AniList pages (50 characters, best known first) read per MAL entry before moving to the next one. */
const ALIAS_PAGES_PER_ENTRY = 4;
/** Per show at most this many AniList requests: the last few unmatched names are rarely found further on. */
const ALIAS_REQUESTS_PER_SHOW = 8;

/**
 * AniList's alternative names of every stored character (Bentham: "Mr. 2", "Bon Clay"; Enji Todoroki:
 * "Endeavor"), without the spoiler ones and kana/kanji, so the name autocomplete finds them too. Per
 * show, most popular first: AniList's cast of the show's entries (the show's own first, then the most
 * popular) is matched to its stored characters by name (sameCharacterName; a name two of them share is
 * left alone), until all are found. Shows already asked are skipped unless --refresh.
 */
export async function stepAliases(refreshAll: boolean, limit: number) {
  const shows = await all<{ mal_id: number }>(
    `SELECT a.mal_id FROM anime a WHERE a.excluded IS NULL AND ${CANONICAL_SQL} AND (? OR a.aliases_at IS NULL)
       AND EXISTS (SELECT 1 FROM anime_character c WHERE c.mal_id = a.mal_id) ORDER BY a.members DESC`,
    [refreshAll ? 1 : 0],
  );
  const entries = Map.groupBy(
    await all<{ mal_id: number; show: number }>('SELECT mal_id, COALESCE(canonical_id, mal_id) AS show FROM anime WHERE excluded IS NULL ORDER BY members DESC'),
    (e) => Number(e.show),
  );
  const queue = shows.map((s) => Number(s.mal_id)).slice(0, limit).reverse();
  const total = queue.length;
  log(`aliases: ${total} judul`);
  const counts = { shows: 0, characters: 0, skipped: 0 };
  let done = 0;
  const workers = Array.from({ length: 2 }, async () => {
    for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
      try {
        const pending = new Map(
          (await all<{ char_id: number; name: string }>('SELECT char_id, name FROM anime_character WHERE mal_id = ?', [id])).map((c) => [Number(c.char_id), c.name]),
        );
        const found = new Map<number, string[]>();
        const order = [id, ...(entries.get(id) ?? []).map((e) => Number(e.mal_id)).filter((e) => e !== id)];
        let requests = 0;
        for (const entry of order) {
          for (let page = 1; page <= ALIAS_PAGES_PER_ENTRY && pending.size && requests < ALIAS_REQUESTS_PER_SHOW; page++) {
            requests++;
            const { characters, more } = await anilistCharacters(entry, page);
            for (const c of characters) {
              if (!c.full) continue;
              const matches = [...pending].filter(([, name]) => sameCharacterName(name, c.full!));
              if (matches.length !== 1) continue;
              const [charId] = matches[0]!;
              pending.delete(charId);
              found.set(charId, [...new Set(c.alternative.map(aliasOf).filter((a): a is string => a !== null))]);
            }
            if (!more) break;
          }
          if (!pending.size || requests >= ALIAS_REQUESTS_PER_SHOW) break;
        }
        await db().batch(
          [
            ...[...found].map(([charId, aliases]) => ({ sql: 'UPDATE anime_character SET aliases = ? WHERE char_id = ?', args: [JSON.stringify(aliases), charId] })),
            { sql: 'UPDATE anime SET aliases_at = ? WHERE mal_id = ?', args: [nowIso(), id] },
          ],
          'write',
        );
        counts.shows++;
        counts.characters += found.size;
      } catch (err) {
        // Network or AniList trouble: nothing is marked, so the next run asks for this show again.
        counts.skipped++;
        log(`aliases: ${id} dilewati (${errorText(err)})`);
      }
      if (++done % 50 === 0) log(`aliases: ${done}/${total}`, counts);
    }
  });
  await Promise.all(workers);
  log('aliases:', counts);
}

const SCREENSHOT_WIDTH = 960;
/** Frames read per second of the video to choose from (one pass over the whole video, at most SHOT_SECONDS of it). */
const SHOT_FPS = 0.5;
const SHOT_SECONDS = 120;
/** Frames before this are left out: black lead-in and the title card. */
const SHOT_SKIP_S = 5;
/** Two screenshots of a show are at least this far apart, so they show different scenes. */
const SHOT_GAP_S = 8;
/** Reading a 30–60 MB video takes minutes when AnimeThemes is slow; past this the show waits for the next run. */
const SHOT_VIDEO_MS = 10 * 60_000;
/** The weekly run stops taking new shows after this long; the rest wait for the next run. */
const SCREENSHOTS_BUDGET_MS = 60 * 60_000;

/**
 * Whether a screenshot (any image ffmpeg reads) shows one of the names (titleKeys): read upscaled to
 * OCR_HEIGHT in gray, like the clue videos (stepTitles).
 */
async function imageShowsTitle(worker: OcrWorker, image: Uint8Array, keys: readonly string[]): Promise<boolean> {
  if (!keys.length) return false;
  const { out } = await ffmpeg(['-i', 'pipe:0', '-vf', `scale=-2:${OCR_HEIGHT}:flags=lanczos,format=gray`, '-c:v', 'png', '-f', 'image2pipe', 'pipe:1'], image);
  const { data } = await worker.recognize(Buffer.from(out));
  return showsTitle(data.text, keys);
}

/** Neither near-black/near-white nor flat: signalstats mean and 10–90 % luma spread. */
async function wellLit(image: Uint8Array): Promise<boolean> {
  const { log: stats } = await ffmpeg(['-i', 'pipe:0', '-vf', 'signalstats,metadata=print', '-f', 'null', '-'], image);
  const stat = (name: string) => Number(stats.match(new RegExp(`signalstats\\.${name}=([\\d.]+)`))?.[1] ?? NaN);
  const mean = stat('YAVG');
  return mean >= 40 && mean <= 220 && stat('YHIGH') - stat('YLOW') >= 50;
}

interface VideoFrame {
  at: number;
  /** WebP SCREENSHOT_WIDTH wide, in `dir`. */
  file: string;
  /** Largest face's share of the frame (faceDetector), 0 = none. */
  face: number;
}

/**
 * Every frame of the video at SHOT_FPS, in one read: saved as WebP screenshots in `dir` and scored for
 * faces. The video host answers 5xx under load and a cut-off read fails decoding, so an ffmpeg failure is
 * retried and, if it persists, reported as transient (the show is skipped, not marked broken).
 */
async function videoFrames(videoUrl: string, dir: string, detect: (rgb: Uint8Array) => Promise<number>): Promise<VideoFrame[]> {
  let result: FfmpegResult | null = null;
  for (let attempt = 1; !result; attempt++) {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    try {
      result = await ffmpeg(
        [
          '-rw_timeout', '60000000', '-t', String(SHOT_SECONDS), '-i', videoUrl, '-an',
          '-filter_complex', `[0:v]fps=${SHOT_FPS},split[a][b];[a]scale='min(${SCREENSHOT_WIDTH},iw)':-2[full];[b]${DETECT_FILTER}[det]`,
          '-map', '[full]', '-c:v', 'libwebp', '-quality', '80', path.join(dir, '%04d.webp'),
          '-map', '[det]', '-f', 'rawvideo', 'pipe:1',
        ],
        undefined,
        SHOT_VIDEO_MS,
      );
    } catch (err) {
      if (!(err instanceof MediaError)) throw err;
      if (attempt >= 3) throw new Error(err.message);
      await sleep(10_000 * attempt);
    }
  }
  const size = DETECT_SIZE * DETECT_SIZE * 3;
  const files = (await readdir(dir)).sort();
  const frames: VideoFrame[] = [];
  for (const [i, file] of files.entries()) {
    if ((i + 1) * size > result.out.length) break;
    frames.push({ at: i / SHOT_FPS, file: path.join(dir, file), face: await detect(result.out.subarray(i * size, (i + 1) * size)) });
  }
  return frames;
}

interface StoredShot {
  mal_id: number;
  slot: number;
  r2_key: string;
  at_seconds: number;
  checked_at: string | null;
}

/** What one show's screenshots are made from: its song videos (best first), its stored frames, and the names its title card could read. */
interface ShotSources {
  videos: Map<number, Array<{ video_url: string }>>;
  stored: Map<number, StoredShot[]>;
  names: Map<number, string[]>;
}

/** ShotSources for `ids` (every show when omitted). */
async function shotSources(ids?: number[]): Promise<ShotSources> {
  const only = ids ? `IN (${ids.map(() => '?').join(',')})` : null;
  const args = ids ?? [];
  // Each show's song videos in the order they are tried: openings before endings, the show's own entry before
  // its merged ones (most popular first), then OP1 before OP1-TV before OP2.
  const videos = await all<{ show: number; video_url: string }>(
    `SELECT COALESCE(e.canonical_id, e.mal_id) AS show, t.video_url FROM anime_theme t JOIN anime e ON e.mal_id = t.mal_id
     WHERE t.status = 'ok' AND t.video_url <> '' AND e.excluded IS NULL${only ? ` AND COALESCE(e.canonical_id, e.mal_id) ${only}` : ''}
     ORDER BY t.kind = 'ed', e.canonical_id IS NOT NULL AND e.canonical_id <> e.mal_id, e.members DESC, t.seq, length(t.label)`,
    args,
  );
  const stored = await all<StoredShot>(`SELECT mal_id, slot, r2_key, at_seconds, checked_at FROM anime_screenshot${only ? ` WHERE mal_id ${only}` : ''} ORDER BY slot`, args);
  // A frame can come from any entry of the show (a season's opening), so every entry's names count.
  const names = await all<{ show: number; names: string }>(
    `SELECT show, json_group_array(value) AS names FROM (
       SELECT COALESCE(e.canonical_id, e.mal_id) AS show, n.value FROM anime e, json_each(json_array(e.title, e.title_en, e.title_ja)) n
       UNION ALL SELECT COALESCE(e.canonical_id, e.mal_id), n.value FROM anime e, json_each(e.synonyms) n)
     WHERE value IS NOT NULL${only ? ` AND show ${only}` : ''} GROUP BY show`,
    args,
  );
  return {
    videos: Map.groupBy(videos, (v) => Number(v.show)),
    stored: Map.groupBy(stored, (s) => Number(s.mal_id)),
    names: new Map(names.map((row) => [Number(row.show), titleKeys(JSON.parse(row.names) as string[])])),
  };
}

/**
 * Picks one show's SCREENSHOTS_PER_TITLE frames (shows whose stored frames predate this choice,
 * anime_screenshot.checked_at NULL, or are due; --refresh: every show from scratch). The whole video is read
 * once (videoFrames) and frames go best first: the largest character face, then (faceless) nearest the middle
 * of the opening, at least SHOT_GAP_S apart, skipping dark, flat and title-showing ones ("SAKAMOTO DAYS").
 * Slot 0, the screenshot a round opens with, gets the smallest face of the three and slot 2 the largest, so
 * each clue helps more. New frames replace the stored ones slot by slot; a slot without one keeps its old
 * frame (puzzles already made need all three). Returns the show's resulting status.
 */
async function shootShow(id: number, src: ShotSources, ctx: { worker: OcrWorker; detect: (rgb: Uint8Array) => Promise<number>; dir: string }, refreshAll: boolean): Promise<'ok' | 'missing' | 'broken'> {
  const video = src.videos.get(id)?.[0]?.video_url ?? null;
  if (!video) {
    await save(id, 'shots', { status: 'missing', error: 'tidak ada video opening/ending' });
    return 'missing';
  }
  const keys = src.names.get(id) ?? [];
  try {
    const frames = (await videoFrames(video, ctx.dir, ctx.detect))
      .filter((f) => f.at >= SHOT_SKIP_S)
      .sort((a, b) => b.face - a.face || Math.abs(a.at - 45) - Math.abs(b.at - 45));
    const chosen: Array<VideoFrame & { image: Uint8Array<ArrayBuffer> }> = [];
    for (const f of frames) {
      if (chosen.length === SCREENSHOTS_PER_TITLE) break;
      if (chosen.some((c) => Math.abs(c.at - f.at) < SHOT_GAP_S)) continue;
      const image = new Uint8Array(await readFile(f.file));
      if (image.length > 8_000 && (await wellLit(image)) && !(await imageShowsTitle(ctx.worker, image, keys))) chosen.push({ ...f, image });
    }
    chosen.sort((a, b) => a.face - b.face);
    const fresh: Array<{ slot: number; key: string; at: number }> = [];
    for (const [slot, c] of chosen.entries()) {
      const key = contentKey('shot', c.image, 'webp');
      await putObject(key, c.image, 'image/webp');
      fresh.push({ slot, key, at: c.at });
    }
    const old = refreshAll ? [] : (src.stored.get(id) ?? []);
    const kept = old.filter((s) => Number(s.slot) >= fresh.length);
    const replaced = old.filter((s) => Number(s.slot) < fresh.length && !fresh.some((f) => f.key === s.r2_key));
    const now = nowIso();
    await db().batch(
      [
        ...(refreshAll ? [{ sql: 'DELETE FROM anime_screenshot WHERE mal_id = ?', args: [id] }] : []),
        ...fresh.map((f) => ({ sql: 'INSERT OR REPLACE INTO anime_screenshot (mal_id, slot, r2_key, at_seconds, checked_at) VALUES (?, ?, ?, ?, ?)', args: [id, f.slot, f.key, f.at, now] })),
        ...kept.map((s) => ({ sql: 'UPDATE anime_screenshot SET checked_at = ? WHERE mal_id = ? AND slot = ?', args: [now, id, s.slot] })),
      ],
      'write',
    );
    for (const s of replaced) if (!(await all('SELECT 1 FROM anime_screenshot WHERE r2_key = ? LIMIT 1', [s.r2_key])).length) await deleteObject(s.r2_key);
    const found = fresh.length + kept.length;
    if (found < SCREENSHOTS_PER_TITLE) {
      await save(id, 'shots', { status: 'missing', source: video, error: `hanya ${found} frame yang layak` });
      return 'missing';
    }
    await save(id, 'shots', { status: 'ok', source: video });
    return 'ok';
  } catch (err) {
    if (!isSourceFault(err)) throw err;
    await save(id, 'shots', { status: 'broken', source: video, error: errorText(err) });
    return 'broken';
  }
}

/**
 * Screenshot mode: SCREENSHOTS_PER_TITLE frames per show from a video of its own songs (anime_theme, step
 * `media`): the first opening of the show's own entry, else of its most popular merged entry, and the ending
 * the same way for shows without any opening video (most movies). The smallest file AnimeThemes has, WebP
 * 960 wide at v1/shot/<hash>.webp, chosen for character faces (shootShow). Reading a video costs 30–60 MB
 * and up to minutes, so shows go most popular first (easy, medium, then hard, which round 3 of the daily
 * needs), for SCREENSHOTS_BUDGET_MS at most unless --limit sets the amount instead, and the next run picks up
 * where this one stopped.
 */
export async function stepScreenshots(refreshAll: boolean, limit: number) {
  const anime = await all<{ mal_id: number }>(`SELECT mal_id FROM anime a WHERE excluded IS NULL AND ${CANONICAL_SQL} ORDER BY members DESC`);
  const rows = await all<MediaRow>(`SELECT mal_id, kind, status, source_url, checked_at FROM anime_media WHERE kind = 'shots'`);
  const byId = new Map(rows.map((r) => [Number(r.mal_id), r]));
  const src = await shotSources();
  const stale = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
  const queue = anime
    .map((a) => Number(a.mal_id))
    // Besides the due ones: shows with frames chosen before faces counted (an admin's rejection stands).
    .filter((id) => isDue(byId.get(id), refreshAll, stale) || (byId.get(id)?.status !== 'rejected' && (src.stored.get(id) ?? []).some((s) => !s.checked_at)))
    .slice(0, limit)
    .reverse();
  const total = queue.length;
  log(`screenshots: ${total} judul`);
  const counts = { ok: 0, missing: 0, broken: 0, skipped: 0 };
  const until = Number.isFinite(limit) ? Infinity : Date.now() + SCREENSHOTS_BUDGET_MS;
  const detect = await faceDetector();
  const root = await mkdtemp(path.join(tmpdir(), 'anidle-shots-'));
  let done = 0;
  // Whole-video reads are the heavy part; a few in parallel keeps AnimeThemes' file host comfortable.
  const workers = Array.from({ length: 3 }, async (_, w) => {
    const ctx = { worker: await ocrWorker(), detect, dir: path.join(root, String(w)) };
    try {
      for (let id = queue.pop(); id !== undefined && Date.now() < until; id = queue.pop()) {
        try {
          counts[await shootShow(id, src, ctx, refreshAll)]++;
        } catch (err) {
          counts.skipped++;
          log(`screenshots: ${id} dilewati (${errorText(err)})`);
        }
        if (++done % 25 === 0) log(`screenshots: ${done}/${total}`, counts);
      }
    } finally {
      await ctx.worker.terminate();
    }
  });
  await Promise.all(workers);
  await rm(root, { recursive: true, force: true });
  log('screenshots:', counts, queue.length ? `${queue.length} judul menunggu run berikutnya` : '');
}

const CLIP_HEIGHT = 240;
/** The weekly run stops taking new songs after this long; the rest wait for the next run. */
const CLIPS_BUDGET_MS = 60 * 60_000;

/**
 * One theme's clue clip: encoded from `videoUrl`, uploaded, and recorded as its anime_theme.clip_key ('' when
 * the encoder's result is unusable, so it is streamed instead). Throws when the host is in trouble, so the
 * theme is tried again on a later run. `file` is a scratch path (mp4 needs a seekable output).
 */
export async function makeClip(themeId: number, videoUrl: string, file: string, timeoutMs?: number): Promise<'ok' | 'failed'> {
  // The video host answers 5xx in bursts when busy: wait and try again (30 s, 60 s, 90 s) before giving up.
  let result: FfmpegResult | null = null;
  for (let attempt = 1; !result; attempt++) {
    try {
      result = await ffmpeg(
        [
          '-rw_timeout', '60000000', '-i', videoUrl, '-an',
          '-vf', `scale=-2:${CLIP_HEIGHT},fps=24`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-pix_fmt', 'yuv420p',
          // +faststart puts the index first, so the browser can start right away.
          '-movflags', '+faststart', '-y', file,
        ],
        undefined,
        timeoutMs,
      );
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
 * keeps playing and the clip follows it), ~1.3 MB instead of 30–60 MB, at v1/clip/<hash>.mp4, sent to the
 * page encrypted. It is shown blurred, so the low resolution does not show. R2's free 10 GB sets the scope:
 * every easy and medium song (its own entry's members, like the catalog), ~4,500 songs ≈ 6 GB; hard songs
 * stream their video_url through /api/media (step `daily` still clips each daily round's song). Most popular
 * entry first, for CLIPS_BUDGET_MS at most unless --limit sets the amount instead. A video the encoder
 * rejects gets clip_key '' (streamed instead), retried with --refresh.
 */
export async function stepClips(refreshAll: boolean, limit: number) {
  const queue = (
    await all<{ id: number; mal_id: number; label: string; video_url: string | null; audio_url: string }>(
      `SELECT t.id, t.mal_id, t.label, t.video_url, t.audio_url FROM ${USABLE_THEME_SQL}
         AND e.members >= ? AND (? OR t.clip_key IS NULL)
       ORDER BY e.members DESC, t.kind DESC, t.seq, t.id`,
      [MEDIUM_MIN_MEMBERS, refreshAll ? 1 : 0],
    )
  )
    .slice(0, limit)
    .reverse();
  const total = queue.length;
  log(`clips: ${total} lagu`);
  const counts = { ok: 0, failed: 0, skipped: 0 };
  const until = Number.isFinite(limit) ? Infinity : Date.now() + CLIPS_BUDGET_MS;
  const dir = await mkdtemp(path.join(tmpdir(), 'anidle-clip-'));
  let done = 0;
  // Each clip reads the whole 30–60 MB video; two at a time keeps AnimeThemes' file host comfortable.
  const workers = Array.from({ length: 2 }, async (_, w) => {
    const file = path.join(dir, `clip-${w}.mp4`);
    // The budget is checked before taking a song, so none is dropped from the "waiting" count.
    for (let row; Date.now() < until && (row = queue.pop()); ) {
      try {
        counts[await makeClip(Number(row.id), themeVideoUrl(row.video_url, row.audio_url), file)]++;
      } catch (err) {
        counts.skipped++;
        log(`clips: ${row.mal_id} ${row.label} ${errorText(err)}`);
      }
      if (++done % 25 === 0) log(`clips: ${done}/${total}`, counts);
    }
  });
  await Promise.all(workers);
  await rm(dir, { recursive: true, force: true });
  log('clips:', counts, queue.length ? `${queue.length} lagu menunggu run berikutnya` : '');
}

/** Romaji/English logos and Japanese ones. Language data is fetched once into data/tessdata (gitignored). */
const OCR_LANGS = ['eng', 'jpn'];
const OCR_CACHE = 'data/tessdata';
/** Frames are read upscaled to this height: at the clip's 240p Tesseract reads almost nothing. */
const OCR_HEIGHT = 720;
/**
 * Frames read per second. An animated logo reads in some frames and not others: at 1 per second Charlotte's
 * OP1 matched one frame of its 5-second title card, at 2 three, spread over all of it.
 */
const OCR_FPS = 2;
/** The weekly run stops taking new songs after this long (~70 s per song); the rest wait for the next run. */
const TITLES_BUDGET_MS = 60 * 60_000;
/** A song without a clip is read from AnimeThemes, minutes on a slow day; past this it waits for the next run. */
const TITLES_VIDEO_MS = 10 * 60_000;

interface TitleScanRow {
  id: number;
  label: string;
  mal_id: number;
  audio_url: string;
  video_url: string;
  clip_key: string | null;
  /** JSON array: the song's entry's and its show's titles, English and Japanese titles, and synonyms. */
  names: string;
}

/** Songs to scan with every name their title could appear under; `where` filters anime_theme t. */
const titleScanRows = (where: string, args: Array<string | number>) =>
  all<TitleScanRow>(
    `SELECT t.id, t.label, t.mal_id, t.audio_url, t.video_url, t.clip_key,
       (SELECT json_group_array(value) FROM (
          SELECT value FROM json_each(json_array(e.title, e.title_en, e.title_ja, s.title, s.title_en, s.title_ja))
          UNION ALL SELECT value FROM json_each(e.synonyms) UNION ALL SELECT value FROM json_each(s.synonyms))) AS names
     FROM anime_theme t JOIN anime e ON e.mal_id = t.mal_id JOIN anime s ON s.mal_id = COALESCE(e.canonical_id, e.mal_id)
     WHERE ${where}`,
    args,
  );

/**
 * Reads one frame per second of the song's video (its 240p clip when there is one, else the AnimeThemes
 * video) and stores the seconds showing the anime's title as anime_theme.title_spans, which the clue
 * covers while they play. Throws when the video cannot be read, so the song is tried again next run.
 */
async function scanTitles(worker: OcrWorker, row: TitleScanRow, dir: string, timeoutMs?: number): Promise<number> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const video = row.clip_key ? mediaUrl(row.clip_key) : themeVideoUrl(row.video_url, row.audio_url);
  await ffmpeg(['-rw_timeout', '60000000', '-i', video, '-an', '-vf', `fps=${OCR_FPS},scale=-2:${OCR_HEIGHT}:flags=lanczos,format=gray`, path.join(dir, '%05d.png')], undefined, timeoutMs);
  const keys = titleKeys(JSON.parse(row.names) as Array<string | null>);
  const seen: number[] = [];
  // The fps filter numbers frame n (from 1) for second (n - 1) / OCR_FPS.
  for (const [i, frame] of (await readdir(dir)).sort().entries()) {
    const { data } = await worker.recognize(path.join(dir, frame));
    if (showsTitle(data.text, keys)) seen.push(i / OCR_FPS);
  }
  const spans = hiddenSpans(seen);
  await run('UPDATE anime_theme SET title_spans = ? WHERE id = ?', [JSON.stringify(spans), row.id]);
  return spans.length;
}

async function ocrWorker(): Promise<OcrWorker> {
  await mkdir(OCR_CACHE, { recursive: true });
  const worker = await createWorker(OCR_LANGS, OEM.LSTM_ONLY, { cachePath: OCR_CACHE });
  // Otherwise every frame with a sliver of a line prints "Image too small to scale!!" to the run log.
  await worker.setParameters({ debug_file: '/dev/null' });
  return worker;
}

/**
 * Title cards in clue videos: scans every usable song not scanned yet (its clip when it has one, else the
 * AnimeThemes video), most popular entry first, so easy and medium songs are ready for unlimited puzzles
 * soonest (CatalogSong.ready), for TITLES_BUDGET_MS at most unless --limit sets the amount instead; step
 * `daily` scans each daily round's song right away. OCR reads printed titles ("SWORD ART ONLINE"); hand-drawn
 * or heavily stylized logos usually slip through.
 */
export async function stepTitles(refreshAll: boolean, limit: number) {
  const queue = (
    await titleScanRows(
      `t.status = 'ok' AND e.excluded IS NULL AND s.excluded IS NULL AND (? OR t.title_spans IS NULL) ORDER BY e.members DESC, t.kind DESC, t.id`,
      [refreshAll ? 1 : 0],
    )
  )
    .slice(0, limit)
    .reverse();
  const total = queue.length;
  log(`titles: ${total} lagu`);
  const counts = { scanned: 0, withTitle: 0, skipped: 0 };
  const until = Number.isFinite(limit) ? Infinity : Date.now() + TITLES_BUDGET_MS;
  const dir = await mkdtemp(path.join(tmpdir(), 'anidle-titles-'));
  let done = 0;
  // OCR is the slow part and uses one core per worker.
  const lanes = Array.from({ length: 3 }, async (_, w) => {
    const worker = await ocrWorker();
    try {
      for (let row; Date.now() < until && (row = queue.pop()); ) {
        try {
          if (await scanTitles(worker, row, path.join(dir, String(w)), TITLES_VIDEO_MS)) counts.withTitle++;
          counts.scanned++;
        } catch (err) {
          counts.skipped++;
          log(`titles: ${row.mal_id} ${row.label} ${errorText(err)}`);
        }
        if (++done % 25 === 0) log(`titles: ${done}/${total}`, counts);
      }
    } finally {
      await worker.terminate();
    }
  });
  await Promise.all(lanes);
  await rm(dir, { recursive: true, force: true });
  log('titles:', counts, queue.length ? `${queue.length} lagu menunggu run berikutnya` : '');
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
 * A daily clue clip reads the whole 30–60 MB video; on a day AnimeThemes sends ~10 KB/s that is an hour.
 * Past this the round keeps streaming its video instead, and the next run tries again.
 */
const DAILY_CLIP_MS = 10 * 60_000;

/**
 * Gets the Opening and Ending of today and tomorrow (UTC+7) ready before players arrive, so a late or skipped
 * scheduled run does not matter: creates the day's puzzles if nobody has yet, copies each round's full song to
 * R2 re-encoded (puzzle_round.audio_key, v1/song/<hash>.m4a, so the file name gives nothing away) and makes any
 * missing clue clip, then scans each song's video for the anime's title (stepTitles). Players then stream ~1 MB
 * from Cloudflare instead of ~3.5 MB from AnimeThemes. Copies older than SONG_COPY_DAYS are removed (R2's free
 * 10 GB); a round without a copy streams through /api/media.
 * Every song is copied before any clip is made: a round plays without its clip, not without its song.
 * Guess the Anime of the same days gets its screenshots read for the title (shootShow) the same way.
 */
export async function stepDaily() {
  const today = todayUtc7();
  const counts = { songs: 0, clips: 0, scanned: 0, shots: 0, kept: 0, failed: 0, removed: 0 };
  const dir = await mkdtemp(path.join(tmpdir(), 'anidle-daily-'));
  const clips = new Map<number, { label: string; videoUrl: string }>();
  const unscanned = new Map<number, string>();
  for (const date of [today, shiftDate(today, 1)]) {
    for (const mode of ['opening', 'ending'] as const) {
      const puzzle = await dailyPuzzle(mode, date);
      const sources = await songSources(puzzle.id, mode);
      for (const [round, source] of sources.entries()) {
        const label = `${date} ${mode} ronde ${round + 1} (${source.malId})`;
        if (!source.clipKey && source.videoUrl) clips.set(source.themeId, { label, videoUrl: source.videoUrl });
        if (!source.titleSpans) unscanned.set(source.themeId, label);
        if (source.audioKey) {
          counts.kept++;
          continue;
        }
        try {
          const original = await download(songHost, source.audioUrl);
          const file = path.join(dir, 'song.m4a');
          const { seconds } = await ffmpeg(['-i', 'pipe:0', '-vn', '-ac', '2', '-c:a', 'aac', '-b:a', SONG_BITRATE, '-movflags', '+faststart', '-y', file], original);
          const song = new Uint8Array(await readFile(file));
          if (song.length < 100_000 || seconds < 20) throw new MediaError(`lagu terlalu pendek (${song.length} B, ${seconds} dtk)`);
          const key = contentKey('song', song, 'm4a');
          await putObject(key, song, 'audio/mp4');
          await run('UPDATE puzzle_round SET audio_key = ? WHERE puzzle_id = ? AND round = ?', [key, puzzle.id, round]);
          counts.songs++;
        } catch (err) {
          counts.failed++;
          log(`daily: ${label} ${errorText(err)}`);
        }
      }
    }
  }
  for (const [themeId, { label, videoUrl }] of clips) {
    try {
      if ((await makeClip(themeId, videoUrl, path.join(dir, 'clip.mp4'), DAILY_CLIP_MS)) === 'ok') counts.clips++;
    } catch (err) {
      counts.failed++;
      log(`daily: ${label} klip: ${errorText(err)}`);
    }
  }
  if (unscanned.size) {
    // After the clips: a song clipped just now is read from its 1.5 MB clip, not the 30–60 MB video.
    const worker = await ocrWorker();
    try {
      for (const row of await titleScanRows(`t.id IN (${[...unscanned.keys()].map(() => '?').join(',')})`, [...unscanned.keys()])) {
        try {
          await scanTitles(worker, row, path.join(dir, 'frames'), DAILY_CLIP_MS);
          counts.scanned++;
        } catch (err) {
          counts.failed++;
          log(`daily: ${unscanned.get(Number(row.id))} judul: ${errorText(err)}`);
        }
      }
    } finally {
      await worker.terminate();
    }
  }
  const shows: number[] = [];
  for (const date of [today, shiftDate(today, 1)]) {
    const puzzle = await dailyPuzzle('screenshot', date);
    shows.push(...(await all<{ mal_id: number }>('SELECT mal_id FROM puzzle_round WHERE puzzle_id = ?', [puzzle.id])).map((r) => Number(r.mal_id)));
  }
  const shots = await shotSources(shows);
  const unread = shows.filter((id) => (shots.stored.get(id) ?? []).some((s) => !s.checked_at));
  if (unread.length) {
    const ctx = { worker: await ocrWorker(), detect: await faceDetector(), dir: path.join(dir, 'shots') };
    try {
      for (const id of unread) {
        try {
          await shootShow(id, shots, ctx, false);
          counts.shots++;
        } catch (err) {
          counts.failed++;
          log(`daily: screenshot ${id}: ${errorText(err)}`);
        }
      }
    } finally {
      await ctx.worker.terminate();
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
