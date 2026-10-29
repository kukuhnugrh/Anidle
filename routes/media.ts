import { isSongMode } from '../shared/modes.js';
import { getPuzzle } from '../server/game.js';
import { HttpError, route } from '../server/http.js';
import { songSources } from '../server/songs.js';

/** Response headers worth passing on from AnimeThemes (Range support lets the player seek). */
const PASSED = ['content-type', 'content-length', 'content-range', 'accept-ranges'];

/**
 * ?puzzle=&round=&kind=audio : streams a song round's full audio from AnimeThemes. Same origin, so the
 * file name, which is the anime's name, never shows up in the browser. Videos are not streamed: the
 * clue is a pre-blurred clip on R2, as the sharp source would show through "open video in new tab".
 */
export const GET = route(async (req) => {
  const p = new URL(req.url).searchParams;
  const puzzle = await getPuzzle(p.get('puzzle') ?? '');
  if (!isSongMode(puzzle.mode)) throw new HttpError(400, 'Only Opening and Ending rounds have songs.');
  const round = Number(p.get('round'));
  const source = (await songSources(puzzle.id, puzzle.mode))[round];
  if (!source) throw new HttpError(404, 'Unknown round.');
  if (p.get('kind') !== 'audio') throw new HttpError(400, 'kind must be audio.');

  // AnimeThemes takes ~5 s to answer each request, then the body streams for as long as it needs
  // (a full song is several MB), so the timeout only covers the wait for the headers.
  const range = req.headers.get('range');
  const headersTimeout = new AbortController();
  const timer = setTimeout(() => headersTimeout.abort(), 30_000);
  const res = await fetch(source.audioUrl, { headers: range ? { Range: range } : undefined, signal: headersTimeout.signal }).finally(() => clearTimeout(timer));
  if (!res.ok) throw new HttpError(502, 'The song host is not answering right now. Try again in a moment.');
  // A daily song is the same for everyone and never replaced: Vercel's CDN may keep it (whole-file
  // requests only), so only the first player of the day waits on AnimeThemes.
  const shared = puzzle.date != null;
  const headers = new Headers({ 'cache-control': shared ? 'public, max-age=86400, s-maxage=172800' : 'private, max-age=86400' });
  for (const name of PASSED) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers });
});
