import { isSongMode } from '../shared/modes.js';
import { viewer } from '../server/accounts.js';
import { sealMedia } from '../server/crypto.js';
import { getPuzzle } from '../server/game.js';
import { HttpError, queryOf, route } from '../server/http.js';
import { mediaUrl } from '../server/media.js';
import { clueKey, mediaTag, songSources, storedSongs } from '../server/songs.js';

/** Response headers worth passing on from AnimeThemes (Range support lets the player seek). */
const PASSED = ['content-type', 'content-length', 'content-range', 'accept-ranges'];

/** A copy on R2 (cheap, CDN) is sent there instead of being streamed through this function. */
const toR2 = (key: string) => new Response(null, { status: 302, headers: { location: mediaUrl(key), 'cache-control': 'private, max-age=3600' } });

/**
 * ?puzzle=&round=&kind=audio|video&v= : streams a song round's full audio (or, once the player opened the
 * clue, the theme's video) from AnimeThemes. Same origin, so the file name, which is the anime's
 * name, never shows up in the browser. Only the exact URL the game hands out is served (v must match),
 * so the public CDN copy of a daily song cannot be bypassed with extra or altered parameters. A clue
 * clip on R2 is fetched here and sent encrypted (clueKey), so the network log holds no playable file
 * and its R2 address never reaches the browser.
 */
export const GET = route(async (req) => {
  const p = queryOf(req, ['puzzle', 'round', 'kind', 'v']);
  const puzzle = await getPuzzle(p.get('puzzle') ?? '');
  if (!isSongMode(puzzle.mode)) throw new HttpError(400, 'Only Opening and Ending rounds have songs.');
  const round = Number(p.get('round'));
  const source = (await songSources(puzzle.id, puzzle.mode))[round];
  if (!source) throw new HttpError(404, 'Unknown round.');
  if (p.get('v') !== mediaTag(puzzle.id, round, source)) throw new HttpError(404, 'This song link is out of date.');
  const kind = p.get('kind');
  let upstream = source.audioUrl;
  if (kind === 'video') {
    const played = (await storedSongs(puzzle.id, (await viewer(req)).key))[round];
    if (!played?.c && (played?.g ?? null) === null) throw new HttpError(403, 'Open the clue first.');
    if (source.clipKey) {
      const clip = await fetch(mediaUrl(source.clipKey), { signal: AbortSignal.timeout(30_000) });
      if (!clip.ok) throw new HttpError(502, 'The clue video is not available right now.');
      const sealed = sealMedia(clueKey(puzzle.id, round, source), new Uint8Array(await clip.arrayBuffer()));
      return new Response(sealed, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'private, max-age=86400' } });
    }
    upstream = source.videoUrl;
  } else if (kind !== 'audio') throw new HttpError(400, 'kind must be audio or video.');
  else if (source.audioKey) return toR2(source.audioKey);

  // AnimeThemes takes ~5 s to answer each request, then the body streams for as long as it needs
  // (a video is tens of MB), so the timeout only covers the wait for the headers.
  const range = req.headers.get('range');
  const headersTimeout = new AbortController();
  const timer = setTimeout(() => headersTimeout.abort(), 30_000);
  const res = await fetch(upstream, { headers: range ? { Range: range } : undefined, signal: headersTimeout.signal }).finally(() => clearTimeout(timer));
  if (!res.ok) throw new HttpError(502, 'The song host is not answering right now. Try again in a moment.');
  // A daily song is the same for everyone and never replaced: Vercel's CDN may keep it (whole-file
  // responses only, never a 206 range), so only the first player of the day waits on AnimeThemes.
  // The video stays private: it is only for players who opened the clue.
  const shared = kind === 'audio' && puzzle.date != null && res.status === 200 && !range;
  const headers = new Headers({ 'cache-control': shared ? 'public, max-age=86400, s-maxage=172800' : 'private, max-age=86400' });
  for (const name of PASSED) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers });
});
