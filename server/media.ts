import { optionalEnv } from './env.js';

/** Public URL of an R2 object written by the pipeline step `media`. */
export const mediaUrl = (key: string) => `${optionalEnv('MEDIA_BASE_URL', 'https://media.velvetaco.dev')}/${key}`;

/** SQL (alias `a` = anime) for the R2 cover key, or NULL when the title has no copied cover yet. */
export const COVER_KEY_SQL = `(SELECT m.r2_key FROM anime_media m WHERE m.mal_id = a.mal_id AND m.kind = 'cover' AND m.status = 'ok')`;

/** The R2 copy when there is one, else MAL's CDN URL. */
export const coverOf = (key: string | null, malCdn: string | null) => (key ? mediaUrl(key) : malCdn);
