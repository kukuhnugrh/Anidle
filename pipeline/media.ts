import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import ffmpegPath from 'ffmpeg-static';
import { all, nowIso, run } from '../server/db.js';
import { Limiter, UpstreamError } from './limiter.js';
import { putObject } from './r2.js';
import { firstThemes, type FirstThemes, type ThemeKind, type ThemeSource } from './sources/animeThemes.js';

export type MediaKind = 'cover' | ThemeKind;

/** Clips are 30 s from the first sound; anything shorter than this is a broken source. */
const CLIP_SECONDS = 30;
const MIN_CLIP_SECONDS = 20;
const COVER_WIDTH = 400;
/** Titles whose source was missing or broken are looked at again after this long. */
const RECHECK_DAYS = 30;

const malCdn = new Limiter('mal-cdn', [{ ms: 1000, max: 5 }]);
const audioHost = new Limiter('animethemes-audio', [{ ms: 1000, max: 3 }]);

const log = (...args: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...args);

class MediaError extends Error {}

interface FfmpegResult {
  out: Uint8Array<ArrayBuffer>;
  /** Last `time=` ffmpeg reported: the length of what it encoded. */
  seconds: number;
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
    resolve({ out, seconds: t ? Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]) : 0 });
  });
  child.stdin.on('error', () => {}); // ffmpeg may close stdin early; the exit code reports real failures
  child.stdin.end(input);
  return promise;
}

const contentKey = (dir: string, body: Uint8Array, ext: string) => `v1/${dir}/${createHash('sha256').update(body).digest('hex').slice(0, 24)}.${ext}`;

/** GET through `limiter` (which retries network errors, 429 and 5xx); `bytes` limits it to a prefix. */
function download(limiter: Limiter, url: string, bytes?: number): Promise<Uint8Array<ArrayBuffer>> {
  return limiter.schedule(async () => {
    const res = await fetch(url, { headers: bytes ? { Range: `bytes=0-${bytes - 1}` } : undefined, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new UpstreamError(res.status, `${res.status} ${url}`);
    return new Uint8Array(await res.arrayBuffer());
  });
}

/**
 * AnimeThemes audio is ~320 kbps Ogg of the whole song; 1.6 MB is ~40 s, enough for a 30 s clip after
 * leading silence. Downloading the prefix is faster than letting ffmpeg stream the URL (the Ogg demuxer
 * seeks to the end for the duration), and AnimeThemes' bandwidth is the bottleneck of the whole step.
 */
const AUDIO_PREFIX_BYTES = 1_600_000;

/**
 * 30 s from the first sound, loudness-normalised, mp3 96 kbps (~360 KB). Keys are content hashes
 * (no mal_id), so the URL does not give the answer away.
 */
async function processAudio(url: string): Promise<string> {
  const source = await download(audioHost, url, AUDIO_PREFIX_BYTES);
  const { out, seconds } = await ffmpeg(
    [
      '-i', 'pipe:0',
      '-af', 'silenceremove=start_periods=1:start_threshold=-50dB,loudnorm=I=-16:TP=-1.5:LRA=11',
      // -write_xing 0: the Xing header is patched by seeking back, impossible on a pipe; leave it out.
      '-t', String(CLIP_SECONDS), '-ac', '2', '-ar', '44100', '-b:a', '96k', '-map_metadata', '-1', '-write_xing', '0', '-f', 'mp3', 'pipe:1',
    ],
    source,
  );
  if (seconds < MIN_CLIP_SECONDS || out.length < 100_000) throw new MediaError(`klip terlalu pendek (${seconds.toFixed(1)} dtk, ${out.length} B)`);
  const key = contentKey('audio', out, 'mp3');
  await putObject(key, out, 'audio/mpeg');
  return key;
}

async function processCover(url: string): Promise<string> {
  const source = await download(malCdn, url);
  // image2pipe, not the webp muxer: that one patches the RIFF size by seeking back, which a pipe
  // cannot do, and browsers reject the resulting size-0 header.
  const { out } = await ffmpeg(['-i', 'pipe:0', '-vf', `scale='min(${COVER_WIDTH},iw)':-2`, '-c:v', 'libwebp', '-quality', '82', '-f', 'image2pipe', 'pipe:1'], source);
  const riffSize = out.length >= 12 ? new DataView(out.buffer).getUint32(4, true) : 0;
  if (out.length < 2_000 || riffSize !== out.length - 8) throw new MediaError(`cover rusak (${out.length} B, RIFF ${riffSize})`);
  const key = contentKey('cover', out, 'webp');
  await putObject(key, out, 'image/webp');
  return key;
}

interface MediaRow {
  mal_id: number;
  kind: MediaKind;
  status: 'ok' | 'missing' | 'broken';
  source_url: string | null;
  checked_at: string;
}

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
 * Copies cover + first OP + first ED of every playable title to R2, most popular first (so the daily
 * pool is covered before the long tail). Re-runs skip what is already ok; missing/broken sources are
 * retried after RECHECK_DAYS, or always with --refresh.
 */
export async function stepMedia(refreshAll: boolean, limit: number) {
  const anime = await all<{ mal_id: number; cover_src: string | null }>('SELECT mal_id, cover_src FROM anime WHERE excluded IS NULL ORDER BY members DESC');
  const rows = await all<MediaRow>('SELECT mal_id, kind, status, source_url, checked_at FROM anime_media');
  const byKey = new Map(rows.map((r) => [`${r.mal_id}:${r.kind}`, r]));
  const stale = new Date(Date.now() - RECHECK_DAYS * 86_400_000).toISOString();
  const due = (row: MediaRow | undefined) => refreshAll || !row || (row.status !== 'ok' && row.checked_at < stale);

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
      if (job.cover) {
        if (!job.coverSrc) await save(job.id, 'cover', { status: 'missing' });
        else
          try {
            await save(job.id, 'cover', { status: 'ok', key: await processCover(job.coverSrc), source: job.coverSrc });
            count('cover', 'ok');
          } catch (err) {
            await save(job.id, 'cover', { status: 'broken', source: job.coverSrc, error: errorText(err) });
            count('cover', 'broken');
          }
      }
      if (job.themes) {
        let themes: FirstThemes;
        try {
          themes = await firstThemes(job.id);
        } catch (err) {
          log(`media: ${job.id} AnimeThemes GAGAL: ${errorText(err)}`);
          count('op', 'api-error');
          continue;
        }
        for (const kind of ['op', 'ed'] as const) {
          const theme = themes[kind];
          const prev = byKey.get(`${job.id}:${kind}`);
          if (!refreshAll && prev?.status === 'ok' && prev.source_url === theme?.audioUrl) continue;
          if (!theme) {
            await save(job.id, kind, { status: 'missing' });
            count(kind, 'missing');
            continue;
          }
          try {
            await save(job.id, kind, { status: 'ok', key: await processAudio(theme.audioUrl), source: theme.audioUrl, theme });
            count(kind, 'ok');
          } catch (err) {
            await save(job.id, kind, { status: 'broken', source: theme.audioUrl, theme, error: errorText(err) });
            count(kind, 'broken');
            log(`media: ${job.id} ${theme.label} rusak: ${errorText(err)}`);
          }
        }
      }
      if (++done % 25 === 0) log(`media: ${done}/${jobs.length}`, counts);
    }
  });
  await Promise.all(workers);
  log('media:', counts);
}
