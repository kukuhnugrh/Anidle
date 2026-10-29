import { optionalEnv } from './env.js';

/** Public URL of an R2 object written by the pipeline step `media`. */
export const mediaUrl = (key: string) => `${optionalEnv('MEDIA_BASE_URL', 'https://media.velvetaco.dev')}/${key}`;

/** SQL (alias `a` = anime) for the R2 cover key, or NULL when the title has no copied cover yet. */
export const COVER_KEY_SQL = `(SELECT m.r2_key FROM anime_media m WHERE m.mal_id = a.mal_id AND m.kind = 'cover' AND m.status = 'ok')`;
/** Same, for the pre-blurred clue poster (NULL until the media step made one: then no poster clue). */
export const COVER_BLUR_KEY_SQL = `(SELECT m.blur_key FROM anime_media m WHERE m.mal_id = a.mal_id AND m.kind = 'cover' AND m.status = 'ok')`;
/**
 * R2 folder of the pre-blurred OP/ED clue clips (step `clips`). Older clips under v1/clip/ are sharp
 * (blurred by CSS only, so "open video in new tab" shows them clearly) and are never sent as a clue.
 */
export const CLUE_CLIP_DIR = 'clue';
export const isClueClip = (key: string | null): key is string => key?.startsWith(`v1/${CLUE_CLIP_DIR}/`) ?? false;

/** The R2 copy when there is one, else MAL's CDN URL. */
export const coverOf = (key: string | null, malCdn: string | null) => (key ? mediaUrl(key) : malCdn);
