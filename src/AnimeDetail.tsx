import { useEffect, useState } from 'react';
import type { DbDetail, DbSong } from '../shared/database';
import { MODE_LABELS } from '../shared/modes';
import { api, errorMessage } from './api';
import { fmtNumber, pretty } from './format';

/** The list's last filters (Database.tsx keeps them here), so "← Database" returns to the same page. */
export const DB_LIST_KEY = 'anidle:db-list';

const malHref = (malId: number) => `https://myanimelist.net/anime/${malId}`;

function SongCard({ kind, song }: { kind: string; song: DbSong | null }) {
  return (
    <div className="card ad-song">
      <span className="field-label">{kind}</span>
      {song ? (
        <>
          <div>
            <b>{song.title ?? 'Unknown title'}</b>
            {song.label && <span className="muted small"> · {song.label}</span>}
          </div>
          {song.artist && <div className="muted small">{song.artist}</div>}
          <audio controls preload="none" src={song.audio} />
          {song.clip ? (
            <figure className="ad-clip">
              <video className="clue-media" src={song.clip} muted loop playsInline controls preload="none" />
              <figcaption className="muted small">The clue clip, as the game shows it</figcaption>
            </figure>
          ) : (
            <span className="muted small">No clue clip yet: the clue is the blurred poster.</span>
          )}
        </>
      ) : (
        <span className="muted small">Not used: no song found for this show.</span>
      )}
    </div>
  );
}

export function AnimeDetail({ id }: { id: number }) {
  const [detail, setDetail] = useState<DbDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.animeDetail(id).then(setDetail, (err: unknown) => setError(errorMessage(err)));
  }, [id]);
  const back = (
    <a className="button ghost back-link" href={`/database${sessionStorage.getItem(DB_LIST_KEY) ?? ''}`}>
      ← Database
    </a>
  );

  if (error)
    return (
      <div className="stack">
        {back}
        <div className="error-box">{error}</div>
      </div>
    );
  if (!detail)
    return (
      <div className="stack">
        {back}
        <div className="spinner" />
      </div>
    );

  const d = detail;
  const aired = [d.season && pretty(d.season), d.year].filter(Boolean).join(' ');
  return (
    <div className="anime-detail stack">
      <div>{back}</div>

      <section className="ad-top">
        <a className="db-cover ad-cover" href={malHref(d.malId)} target="_blank" rel="noreferrer" title="Open on MAL">
          {d.cover ? <img src={d.cover} alt="" /> : <span className="muted small">no image</span>}
        </a>
        <div className="ad-facts">
          <header className="page-head">
            <span className="eyebrow">Database</span>
            <h1>{d.title}</h1>
            {d.titleEn && d.titleEn !== d.title && <div className="muted">{d.titleEn}</div>}
            {d.titleJa && <div className="muted small">{d.titleJa}</div>}
          </header>
          <dl className="ad-stats">
            <div>
              <dt>Aired</dt>
              <dd>{aired || '?'}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>
                {pretty(d.mediaType)}
                {d.episodes != null && ` · ${d.episodes} ep`}
              </dd>
            </div>
            <div>
              <dt>Score</dt>
              <dd>{d.score != null ? `★ ${d.score.toFixed(2)}` : '?'}</dd>
            </div>
            <div>
              <dt>Members</dt>
              <dd>
                {d.members != null ? fmtNumber(d.members) : '?'}
                {d.popularityRank != null && <span className="muted small"> #{d.popularityRank}</span>}
              </dd>
            </div>
            <div>
              <dt>Difficulty</dt>
              <dd>
                <span className={`difficulty ${d.difficulty}`}>{d.difficulty}</span>
              </dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{pretty(d.source)}</dd>
            </div>
          </dl>
          <div className="db-chips">
            {d.studios.map((s) => (
              <a key={s} className="chip studio" href={`/database?studio=${encodeURIComponent(s)}`}>
                {s}
              </a>
            ))}
            {d.genres.map((g) => (
              <a key={g.id} className={`chip ${g.type === 'themes' || g.type === 'demographics' ? 'tag' : 'genre'}`} href={`/database?genre=${g.id}`}>
                {g.name}
              </a>
            ))}
          </div>
          <div className="ad-modes">
            <span className="field-label">Asked in</span>
            <div className="chips">
              {d.modes.map((m) => (
                <span key={m} className="chip hit">
                  {MODE_LABELS[m]}
                </span>
              ))}
            </div>
          </div>
          <a href={malHref(d.malId)} target="_blank" rel="noreferrer">
            Open on MAL ↗
          </a>
        </div>
      </section>

      {d.synopsis && (
        <section className="card">
          <h2>Synopsis</h2>
          <p className="ad-synopsis">{d.synopsis}</p>
        </section>
      )}

      <section className="stack ad-section">
        <h2>Songs</h2>
        <div className="ad-songs">
          <SongCard kind="Opening" song={d.songs.op} />
          <SongCard kind="Ending" song={d.songs.ed} />
        </div>
      </section>

      <section className="stack ad-section">
        <h2>Characters</h2>
        {d.characters.length ? (
          <div className="ad-chars">
            {d.characters.map((c) => (
              <figure key={c.id} className="ad-char">
                <img src={c.portrait} alt="" loading="lazy" />
                <figcaption>
                  <b>{c.name}</b>
                  {c.nicknames.length > 0 && <span className="muted small">aka {c.nicknames.join(', ')}</span>}
                  <span className="muted small">
                    {c.role ? `${pretty(c.role)} · ` : ''}
                    {c.favorites != null ? `${fmtNumber(c.favorites)} favorites` : ''}
                  </span>
                  <span className={`difficulty ${c.difficulty}`} title="Character mode difficulty (MAL favorites)">
                    {c.difficulty}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className="muted">No characters used for this show.</p>
        )}
      </section>

      <section className="stack ad-section">
        <h2>Screenshots</h2>
        {d.screenshots.length ? (
          <div className="ad-shots">
            {d.screenshots.map((src, i) => (
              <img key={src} src={src} alt={`Screenshot ${i + 1}`} loading="lazy" />
            ))}
          </div>
        ) : (
          <p className="muted">No screenshots used for this show.</p>
        )}
      </section>

      <section className="stack ad-section">
        <h2>Entries in this show</h2>
        <ul className="ad-entries">
          {d.merged.map((e) => (
            <li key={e.malId}>
              <a href={malHref(e.malId)} target="_blank" rel="noreferrer">
                {e.title}
              </a>
              <span className="muted small">
                {' '}
                · {pretty(e.mediaType)}
                {e.year != null && ` · ${e.year}`}
                {e.episodes != null && ` · ${e.episodes} ep`}
              </span>
            </li>
          ))}
        </ul>
        {d.synonyms.length > 0 && <p className="muted small">Also known as: {d.synonyms.join(' · ')}</p>}
      </section>
    </div>
  );
}
