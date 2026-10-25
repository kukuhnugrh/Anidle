import { isSongMode } from '../shared/modes.js';
import { viewer } from '../server/accounts.js';
import { getPuzzle } from '../server/game.js';
import { HttpError, route } from '../server/http.js';
import { songSources, storedSongs, videoOf } from '../server/songs.js';

/** Response headers worth passing on from AnimeThemes (Range support lets the player seek). */
const PASSED = ['content-type', 'content-length', 'content-range', 'accept-ranges'];

/**
 * ?puzzle=&round=&kind=audio|video : streams a song round's full audio (or, once the player opened the
 * clue, the opening's video) from AnimeThemes. Same origin, so the file name, which is the anime's
 * name, never shows up in the browser.
 */
export const GET = route(async (req) => {
  const p = new URL(req.url).searchParams;
  const puzzle = await getPuzzle(p.get('puzzle') ?? '');
  if (!isSongMode(puzzle.mode)) throw new HttpError(400, 'Only Opening and Ending rounds have songs.');
  const round = Number(p.get('round'));
  const source = (await songSources(puzzle.id, puzzle.mode))[round];
  if (!source) throw new HttpError(404, 'Unknown round.');
  const kind = p.get('kind');
  let upstream = source.audioUrl;
  if (kind === 'video') {
    if (puzzle.mode !== 'opening') throw new HttpError(400, 'Only openings have a video clue.');
    const played = (await storedSongs(puzzle.id, (await viewer(req)).key))[round];
    if (!played?.c && (played?.g ?? null) === null) throw new HttpError(403, 'Open the clue first.');
    upstream = videoOf(source.audioUrl);
  } else if (kind !== 'audio') throw new HttpError(400, 'kind must be audio or video.');

  const range = req.headers.get('range');
  const res = await fetch(upstream, { headers: range ? { Range: range } : undefined, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new HttpError(502, 'The song host is not answering right now. Try again in a moment.');
  const headers = new Headers({ 'cache-control': 'private, max-age=3600' });
  for (const name of PASSED) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers });
});
