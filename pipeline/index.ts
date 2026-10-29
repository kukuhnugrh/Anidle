import './env.js';
import { appendFileSync } from 'node:fs';
import { CANONICAL_SQL, EASY_MIN_MEMBERS, EXCLUDED_MEDIA_TYPES, exclusionReason, FRANCHISE_RELATIONS, MEDIUM_MIN_MEMBERS, POPULAR_MIN_MEMBERS } from '../shared/catalog.js';
import { franchiseIds } from '../shared/franchise.js';
import { all, db, nowIso, run } from '../server/db.js';
import { poolUsers } from '../server/env.js';
import { animeDetail, animeSynopsis, malGet, MalError } from '../server/mal.js';
import { syncCompleted } from '../server/players.js';
import { Limiter } from './limiter.js';
import { stepCharacters, stepClips, stepDaily, stepMedia, stepNicknames, stepScreenshots } from './media.js';
import { migrate } from './migrate.js';
import { animeGenres } from './sources/jikanEdge.js';

// MAL publishes no limit; ~3 req/s has been fine and is gentle.
const malLimiter = new Limiter('mal', [{ ms: 1000, max: 3 }]);

const REFRESH_AFTER_DAYS = 30;
const RANKING_PAGE = 500;

const log = (...args: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...args);

// ------------------------------------------------------------------ steps

async function stepGenres() {
  const genres = await animeGenres();
  await db().batch(
    genres.map((g) => ({
      sql: 'INSERT INTO genre (id, name, type) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET name = excluded.name, type = excluded.type',
      args: [g.malId, g.name, g.type],
    })),
    'write',
  );
  log(`genres: ${genres.length}`);
}

/** Shared pool (POOL_USERS) plus every account that linked MAL (their own `saya` pool). */
async function stepCompleted() {
  const linked = (await all<{ mal_username: string }>('SELECT mal_username FROM account WHERE mal_username IS NOT NULL')).map((r) => r.mal_username);
  const byLower = new Map([...poolUsers(), ...linked].map((u) => [u.toLowerCase(), u]));
  const users = [...byLower.values()];
  if (!users.length) {
    log('completed: POOL_USERS kosong dan belum ada akun yang menghubungkan MAL, dilewati');
    return;
  }
  for (const username of users) {
    try {
      const result = await syncCompleted(username, malLimiter.schedule);
      log(`completed: ${username} → ${result.completed} judul (via ${result.via})`);
    } catch (err) {
      const hint = err instanceof MalError && (err.status === 403 || err.status === 404) ? ' (list private? minta dia login sekali)' : '';
      log(`completed: ${username} GAGAL${hint}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

interface RankingPage {
  data: Array<{ node: { id: number; num_list_users?: number; media_type?: string }; ranking: { rank: number } }>;
  paging?: { next?: string };
}

/** MAL's popularity ranking (by members), down to POPULAR_MIN_MEMBERS. Replaces the whole `popular` table. */
async function stepPopular() {
  const picked: Array<{ id: number; rank: number }> = [];
  for (let offset = 0; ; offset += RANKING_PAGE) {
    const page = await malLimiter.schedule(() =>
      malGet<RankingPage>('/anime/ranking', { ranking_type: 'bypopularity', limit: RANKING_PAGE, offset, fields: 'num_list_users,media_type' }),
    );
    for (const { node, ranking } of page.data) {
      if ((node.num_list_users ?? 0) >= POPULAR_MIN_MEMBERS && !(node.media_type && EXCLUDED_MEDIA_TYPES[node.media_type])) {
        picked.push({ id: node.id, rank: ranking.rank });
      }
    }
    if ((page.data.at(-1)?.node.num_list_users ?? 0) < POPULAR_MIN_MEMBERS || !page.paging?.next) break;
  }
  await db().batch(
    [
      { sql: 'DELETE FROM popular', args: [] },
      ...picked.map((p) => ({ sql: 'INSERT OR IGNORE INTO popular (mal_id, rank) VALUES (?, ?)', args: [p.id, p.rank] })),
    ],
    'write',
  );
  log(`popular: ${picked.length} judul dengan ≥ ${POPULAR_MIN_MEMBERS.toLocaleString('id-ID')} member`);
}

/** Every title that is in some pool and has no fresh anime row. */
async function idsToEnrich(refreshAll: boolean): Promise<number[]> {
  const cutoff = new Date(Date.now() - REFRESH_AFTER_DAYS * 86_400_000).toISOString();
  const rows = await all<{ mal_id: number }>(
    `SELECT p.mal_id FROM (
       SELECT mal_id FROM completed UNION SELECT mal_id FROM popular UNION SELECT mal_id FROM enrich_queue
     ) p LEFT JOIN anime a ON a.mal_id = p.mal_id
     WHERE ? OR a.mal_id IS NULL OR a.fetched_at < ?
     ORDER BY p.mal_id`,
    [refreshAll ? 1 : 0, cutoff],
  );
  return rows.map((r) => Number(r.mal_id));
}

async function enrichOne(id: number): Promise<'ok' | 'excluded' | 'gone'> {
  let d;
  try {
    d = await malLimiter.schedule(() => animeDetail(id));
  } catch (err) {
    if (err instanceof MalError && err.status === 404) {
      await run('DELETE FROM enrich_queue WHERE mal_id = ?', [id]);
      return 'gone';
    }
    throw err;
  }
  const genres = d.genres ?? [];
  const excluded = exclusionReason(d.media_type ?? null, genres.map((g) => g.id), d.status ?? null);
  const alt = d.alternative_titles ?? {};
  await db().batch(
    [
      {
        sql: `INSERT INTO anime (mal_id, title, title_en, title_ja, synonyms, media_type, status, num_episodes, year, season,
                start_date, score, members, source, rating, studios, nsfw, cover_src, excluded, fetched_at, synopsis)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (mal_id) DO UPDATE SET
                title = excluded.title, title_en = excluded.title_en, title_ja = excluded.title_ja, synonyms = excluded.synonyms,
                media_type = excluded.media_type, status = excluded.status, num_episodes = excluded.num_episodes,
                year = excluded.year, season = excluded.season, start_date = excluded.start_date, score = excluded.score,
                members = excluded.members, source = excluded.source, rating = excluded.rating, studios = excluded.studios,
                nsfw = excluded.nsfw, cover_src = excluded.cover_src, excluded = excluded.excluded, fetched_at = excluded.fetched_at,
                synopsis = excluded.synopsis`,
        args: [
          d.id,
          d.title,
          alt.en || null,
          alt.ja || null,
          JSON.stringify((alt.synonyms ?? []).filter(Boolean)),
          d.media_type ?? null,
          d.status ?? null,
          d.num_episodes || null,
          d.start_season?.year ?? (d.start_date ? Number(d.start_date.slice(0, 4)) : null),
          d.start_season?.season ?? null,
          d.start_date ?? null,
          d.mean ?? null,
          d.num_list_users ?? null,
          d.source ?? null,
          d.rating ?? null,
          JSON.stringify((d.studios ?? []).map((s) => s.name)),
          d.nsfw ?? null,
          d.main_picture?.large ?? d.main_picture?.medium ?? null,
          excluded,
          nowIso(),
          d.synopsis || null,
        ],
      },
      { sql: 'DELETE FROM anime_genre WHERE mal_id = ?', args: [id] },
      ...genres.map((g) => ({ sql: 'INSERT OR IGNORE INTO anime_genre (mal_id, genre_id) VALUES (?, ?)', args: [id, g.id] })),
      { sql: 'DELETE FROM anime_relation WHERE mal_id = ?', args: [id] },
      ...(d.related_anime ?? []).map((r) => ({
        sql: 'INSERT OR IGNORE INTO anime_relation (mal_id, related_id, relation) VALUES (?, ?, ?)',
        args: [id, r.node.id, r.relation_type],
      })),
      { sql: 'DELETE FROM enrich_queue WHERE mal_id = ?', args: [id] },
    ],
    'write',
  );
  return excluded ? 'excluded' : 'ok';
}

async function stepEnrich(refreshAll: boolean, limit: number) {
  const ids = (await idsToEnrich(refreshAll)).slice(0, limit);
  log(`enrich: ${ids.length} judul`);
  const counts = { ok: 0, excluded: 0, gone: 0, failed: 0 };
  let done = 0;
  // The limiter paces requests; this just keeps enough of them in flight.
  const workers = Array.from({ length: 6 }, async () => {
    for (let id = ids.pop(); id !== undefined; id = ids.pop()) {
      try {
        counts[await enrichOne(id)]++;
      } catch (err) {
        counts.failed++;
        log(`enrich: ${id} GAGAL: ${err instanceof Error ? err.message : err}`);
      }
      if (++done % 100 === 0) log(`enrich: ${done} selesai`);
    }
  });
  await Promise.all(workers);
  log(`enrich: ok ${counts.ok}, dikecualikan ${counts.excluded}, tidak ada di MAL ${counts.gone}, gagal ${counts.failed}`);
}

/** Synopsis (Anidle's 2nd clue) of every show enriched before it was stored; `enrich` keeps it current after that. */
async function stepSynopsis(limit: number) {
  const ids = (
    await all<{ mal_id: number }>(`SELECT mal_id FROM anime a WHERE excluded IS NULL AND ${CANONICAL_SQL} AND synopsis IS NULL ORDER BY members DESC`)
  )
    .map((r) => Number(r.mal_id))
    .slice(0, limit)
    .reverse();
  log(`synopsis: ${ids.length} show`);
  const counts = { ok: 0, empty: 0, failed: 0 };
  const workers = Array.from({ length: 6 }, async () => {
    for (let id = ids.pop(); id !== undefined; id = ids.pop()) {
      try {
        const { synopsis } = await malLimiter.schedule(() => animeSynopsis(id));
        // '' marks "MAL has none", so the title is not asked again.
        await run('UPDATE anime SET synopsis = ? WHERE mal_id = ?', [synopsis?.trim() ?? '', id]);
        counts[synopsis?.trim() ? 'ok' : 'empty']++;
      } catch (err) {
        counts.failed++;
        log(`synopsis: ${id} GAGAL: ${err instanceof Error ? err.message : err}`);
      }
      if ((counts.ok + counts.empty + counts.failed) % 200 === 0) log('synopsis:', counts);
    }
  });
  await Promise.all(workers);
  log('synopsis:', counts);
}

/**
 * Groups a show's seasons, OVAs, movies, recaps, side stories and alternative versions (remakes) into
 * one franchise, and marks its canonical entry: the most popular playable one (most MAL members). Only
 * canonical entries are asked, listed and guessed; their member count sets the franchise's difficulty.
 * Spin-offs, alternative settings and shared-character links stay separate shows.
 */
async function stepFranchise() {
  const edges = await all<{ mal_id: number; related_id: number }>(
    `SELECT mal_id, related_id FROM anime_relation WHERE relation IN (${FRANCHISE_RELATIONS.map(() => '?').join(',')})`,
    [...FRANCHISE_RELATIONS],
  );
  const groups = franchiseIds(edges.map((e) => [Number(e.mal_id), Number(e.related_id)] as const));
  const anime = await all<{ mal_id: number; members: number | null; excluded: string | null }>('SELECT mal_id, members, excluded FROM anime');
  const canonical = new Map<number, { id: number; members: number }>();
  for (const a of anime) {
    const id = Number(a.mal_id);
    const group = groups.get(id) ?? -id;
    const members = a.excluded ? -1 : Number(a.members ?? 0);
    const best = canonical.get(group);
    if (!best || members > best.members || (members === best.members && id < best.id)) canonical.set(group, { id, members });
  }
  await db().batch(
    anime.map((a) => {
      const id = Number(a.mal_id);
      return { sql: 'UPDATE anime SET franchise_id = ?, canonical_id = ? WHERE mal_id = ?', args: [groups.get(id) ?? null, canonical.get(groups.get(id) ?? -id)!.id, id] };
    }),
    'write',
  );
  const shows = new Set([...canonical.values()].filter((c) => c.members >= 0).map((c) => c.id)).size;
  log(`franchise: ${anime.length} judul → ${shows} show (entri kanonik)`);
}

async function report() {
  const [row] = await all<Record<string, number>>(
    `SELECT
      (SELECT COUNT(*) FROM anime) AS anime,
      (SELECT COUNT(*) FROM anime WHERE excluded IS NOT NULL) AS excluded,
      (SELECT COUNT(DISTINCT mal_id) FROM completed) AS completed_titles,
      (SELECT COUNT(DISTINCT username) FROM completed) AS players,
      (SELECT COUNT(*) FROM popular) AS popular_titles,
      (SELECT COUNT(*) FROM anime a WHERE a.excluded IS NULL AND ${CANONICAL_SQL}) AS shows,
      (SELECT COUNT(*) FROM anime a WHERE a.excluded IS NULL AND ${CANONICAL_SQL} AND a.members >= ?) AS easy,
      (SELECT COUNT(*) FROM anime a WHERE a.excluded IS NULL AND ${CANONICAL_SQL} AND a.members >= ? AND a.members < ?) AS medium,
      (SELECT COUNT(*) FROM anime a WHERE a.excluded IS NULL AND ${CANONICAL_SQL} AND (a.members < ? OR a.members IS NULL)) AS hard,
      (SELECT COUNT(*) FROM enrich_queue) AS queue,
      (SELECT COUNT(*) FROM anime_media WHERE kind = 'cover' AND status = 'ok') AS cover_ok,
      (SELECT COUNT(*) FROM anime_theme WHERE kind = 'op' AND status = 'ok') AS op_ok,
      (SELECT COUNT(*) FROM anime_theme WHERE kind = 'ed' AND status = 'ok') AS ed_ok,
      (SELECT COUNT(*) FROM anime_media WHERE kind = 'chars' AND status = 'ok') AS chars_ok,
      (SELECT COUNT(*) FROM anime_media WHERE kind = 'shots' AND status = 'ok') AS shots_ok,
      (SELECT COUNT(*) FROM anime_media WHERE status = 'broken') AS media_broken`,
    [EASY_MIN_MEMBERS, MEDIUM_MIN_MEMBERS, EASY_MIN_MEMBERS, MEDIUM_MIN_MEMBERS],
  );
  log('ringkasan:', row);
  await writeActionsSummary(row ?? {});
}

/**
 * In GitHub Actions: counts plus media that broke in this run, as markdown in the job summary
 * (GITHUB_STEP_SUMMARY), so a weekly run shows what needs a look without reading the log.
 */
async function writeActionsSummary(row: Record<string, number>) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const broken = await all<{ mal_id: number; title: string; kind: string; error: string | null }>(
    `SELECT m.mal_id, a.title, m.kind, m.error FROM anime_media m JOIN anime a ON a.mal_id = m.mal_id
     WHERE m.status = 'broken' AND m.checked_at >= ? ORDER BY a.members DESC LIMIT 50`,
    [new Date(started).toISOString()],
  );
  const lines = [
    '## Anidle pipeline',
    '',
    '| | |',
    '| --- | --- |',
    ...Object.entries(row).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    `### Media rusak di run ini (${broken.length})`,
    '',
    ...(broken.length
      ? ['| MAL | Judul | Media | Error |', '| --- | --- | --- | --- |', ...broken.map((b) => `| ${b.mal_id} | ${b.title.replace(/\|/g, '/')} | ${b.kind} | ${(b.error ?? '').replace(/\|/g, '/')} |`)]
      : ['Tidak ada.']),
    '',
  ];
  appendFileSync(file, lines.join('\n'));
}

// ------------------------------------------------------------------ CLI

const STEPS = ['genres', 'completed', 'popular', 'enrich', 'synopsis', 'franchise', 'media', 'characters', 'nicknames', 'screenshots', 'clips', 'daily'] as const;
type Step = (typeof STEPS)[number];

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : Infinity;
const requested = args.filter((a) => !a.startsWith('--'));
const unknown = requested.filter((s) => !(STEPS as readonly string[]).includes(s) && s !== 'all');
if (unknown.length) {
  console.error(`Step tidak dikenal: ${unknown.join(', ')}. Pilihan: all, ${STEPS.join(', ')} [--refresh] [--limit=N] [--turso]`);
  process.exit(1);
}
const steps: Step[] = !requested.length || requested.includes('all') ? [...STEPS] : (requested as Step[]);

await migrate();
const started = Date.now();
for (const step of steps) {
  if (step === 'genres') await stepGenres();
  if (step === 'completed') await stepCompleted();
  if (step === 'popular') await stepPopular();
  if (step === 'enrich') await stepEnrich(flag('refresh'), limit);
  if (step === 'franchise') await stepFranchise();
  if (step === 'media') await stepMedia(flag('refresh'), limit);
  if (step === 'characters') await stepCharacters(flag('refresh'), limit);
  if (step === 'synopsis') await stepSynopsis(limit);
  if (step === 'nicknames') await stepNicknames(flag('refresh'), limit);
  if (step === 'screenshots') await stepScreenshots(flag('refresh'), limit);
  if (step === 'clips') await stepClips(flag('refresh'), limit);
  if (step === 'daily') await stepDaily();
}
await report();
log(`selesai dalam ${Math.round((Date.now() - started) / 1000)} dtk`);
