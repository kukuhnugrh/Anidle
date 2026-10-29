import { useEffect, useState, type ReactNode } from 'react';
import { ANIDLE_CLUES } from '../shared/anidle';
import type { DbDetail, DbSong } from '../shared/database';
import { MODE_LABELS, MODES, type Mode } from '../shared/modes';
import { api, errorMessage } from './api';
import { fmtNumber, pretty } from './format';

/** The list's last filters (Database.tsx keeps them here), so "← Database" returns to the same page. */
export const DB_LIST_KEY = 'anidle:db-list';

const malHref = (malId: number) => `https://myanimelist.net/anime/${malId}`;
const clueAfter = (kind: (typeof ANIDLE_CLUES)[number]['kind']) => ANIDLE_CLUES.find((c) => c.kind === kind)!.after;

type Tab = Mode | 'about';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Ending shows the blurred poster beside the clip; both modes fall back to it when there is no clip. */
function SongPanel({ song, poster, withCover }: { song: DbSong | null; poster: string | null; withCover: boolean }) {
  if (!song) return <p className="muted">No song found for this show, so this mode never asks it.</p>;
  return (
    <div className="show-panel">
      <div>
        <span className="field-label">The song (played in full)</span>
        <div className="show-song-title">
          <b>{song.title ?? 'Unknown title'}</b>
          {song.label && <span className="muted small"> · {song.label}</span>}
        </div>
        {song.artist && <div className="muted small">{song.artist}</div>}
      </div>
      <audio controls preload="none" src={song.audio} />
      <div>
        <span className="field-label">The clue (halves the round's points)</span>
        <div className="clue-pair show-clue-pair">
          {song.clip ? (
            <div className="clue-frame">
              <video className="clue-media" src={song.clip} muted loop playsInline controls controlsList="nodownload" disablePictureInPicture preload="metadata" />
            </div>
          ) : (
            <p className="muted small">No clue clip yet: the clue is the blurred poster.</p>
          )}
          {(withCover || !song.clip) && poster && (
            <span className="clue-cover">
              <img className="clue-media cover" src={poster} alt="" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function AnidlePanel({ d }: { d: DbDetail }) {
  const genres = d.genres.filter((g) => g.type === 'genres' || g.type === 'explicit_genres');
  const tags = d.genres.filter((g) => g.type === 'themes' || g.type === 'demographics');
  return (
    <div className="show-panel">
      <div>
        <span className="field-label">Compared with every guess</span>
        <dl className="show-stats">
          <Fact label="Year">{d.year ?? '?'}</Fact>
          <Fact label="Score">{d.score?.toFixed(2) ?? '?'}</Fact>
          <Fact label="Source">{pretty(d.source)}</Fact>
          <Fact label="Studio">{d.studios.join(', ') || '?'}</Fact>
          <Fact label="Genre">{genres.map((g) => g.name).join(', ') || '—'}</Fact>
          <Fact label="Tags">{tags.map((g) => g.name).join(', ') || '—'}</Fact>
        </dl>
      </div>
      <section className="anidle-clues">
        <div className="anidle-clue cover">
          <span className="cell-label">Blurred poster · after {clueAfter('cover')} tries</span>
          {d.clues.poster ? (
            <span className="anidle-cover-frame">
              <img className="anidle-cover" src={d.clues.poster} alt="" />
            </span>
          ) : (
            <span className="muted small">No poster for this one.</span>
          )}
        </div>
        <div className="anidle-clue synopsis">
          <span className="cell-label">Synopsis · after {clueAfter('synopsis')} tries</span>
          <p className="anidle-synopsis">{d.clues.synopsis ?? 'MAL has no synopsis for this one.'}</p>
        </div>
        <div className="anidle-clue characters">
          <span className="cell-label">Two of its characters · after {clueAfter('characters')} tries</span>
          {d.clues.characters.length ? (
            <div className="anidle-chars">
              {d.clues.characters.map((c) => (
                <figure key={c.portrait}>
                  <img src={c.portrait} alt="" />
                  <figcaption>{c.name}</figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <span className="muted small">No characters for this one.</span>
          )}
        </div>
      </section>
    </div>
  );
}

function CharacterPanel({ d }: { d: DbDetail }) {
  if (!d.characters.length) return <p className="muted">No characters stored, so Character mode never asks this show.</p>;
  return (
    <div className="show-panel">
      <p className="muted small">Each round shows a character's portrait; you pick its name (or a nickname) and its anime. Difficulty comes from the character's own MAL favorites.</p>
      <div className="show-chars">
        {d.characters.map((c) => (
          <figure key={c.id} className="show-char">
            <img src={c.portrait} alt="" loading="lazy" />
            <figcaption>
              <b>{c.name}</b>
              {c.nicknames.length > 0 && <span className="muted small">aka {c.nicknames.join(', ')}</span>}
              <span className="muted small">
                {c.role ? `${pretty(c.role)} · ` : ''}
                {c.favorites != null ? `${fmtNumber(c.favorites)} favorites` : ''}
              </span>
              <span className={`difficulty ${c.difficulty}`}>{c.difficulty}</span>
              {c.alsoIn.length > 0 && (
                <span className="muted small">
                  Also right as the anime: {c.alsoIn.map((s, i) => [i > 0 && ', ', <a key={s.malId} href={`/database/${s.malId}`}>{s.title}</a>])}
                </span>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function ScreenshotPanel({ d }: { d: DbDetail }) {
  if (!d.screenshots.length) return <p className="muted">No screenshots stored, so Guess the Anime never asks this show.</p>;
  return (
    <div className="show-panel">
      <div className="show-shots">
        {d.screenshots.map((src, i) => (
          <figure key={src}>
            <img src={src} alt={`Screenshot ${i + 1}`} loading="lazy" />
            <figcaption className="muted small">{i === 0 ? 'Shown first' : `Clue ${i}`}</figcaption>
          </figure>
        ))}
      </div>
      <div>
        <span className="field-label">Title clue</span>
        <div className="show-hint">{d.clues.titleHint.title}</div>
        {d.clues.titleHint.english && <div className="show-hint muted">{d.clues.titleHint.english}</div>}
      </div>
    </div>
  );
}

function AboutPanel({ d }: { d: DbDetail }) {
  return (
    <div className="show-panel">
      {d.synopsis && (
        <div>
          <span className="field-label">Synopsis</span>
          <p className="show-synopsis">{d.synopsis}</p>
        </div>
      )}
      <div>
        <span className="field-label">MAL entries in this show (guessing any of them counts)</span>
        <ul className="show-entries">
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
      </div>
      {d.synonyms.length > 0 && <p className="muted small">Also known as: {d.synonyms.join(' · ')}</p>}
    </div>
  );
}

export function AnimeDetail({ id }: { id: number }) {
  const [detail, setDetail] = useState<DbDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('anidle');
  useEffect(() => {
    api.animeDetail(id).then(setDetail, (err: unknown) => setError(errorMessage(err)));
  }, [id]);
  const back = (
    <a className="button ghost small back-link" href={`/database${sessionStorage.getItem(DB_LIST_KEY) ?? ''}`}>
      ← Database
    </a>
  );
  if (!detail)
    return (
      <div className="stack">
        <div>{back}</div>
        {error ? <div className="error-box">{error}</div> : <div className="spinner" />}
      </div>
    );

  const d = detail;
  const tabs: Array<{ id: Tab; label: string; note: string }> = [
    ...MODES.map((m) => ({ id: m, label: MODE_LABELS[m], note: d.modes.includes(m) ? 'asked' : 'not asked' })),
    { id: 'about', label: 'About', note: `${d.merged.length} ${d.merged.length === 1 ? 'entry' : 'entries'}` },
  ];
  return (
    <div className="anime-detail stack">
      <div>{back}</div>

      <section className="show-top">
        <a className="db-cover show-cover" href={malHref(d.malId)} target="_blank" rel="noreferrer" title="Open on MAL">
          {d.cover ? <img src={d.cover} alt="" /> : <span className="muted small">no image</span>}
        </a>
        <div className="show-facts">
          <header className="page-head">
            <h1>{d.title}</h1>
            {d.titleEn && d.titleEn !== d.title && <div className="muted">{d.titleEn}</div>}
            {d.titleJa && <div className="muted small">{d.titleJa}</div>}
          </header>
          <dl className="show-stats">
            <Fact label="Aired">{[d.season && pretty(d.season), d.year].filter(Boolean).join(' ') || '?'}</Fact>
            <Fact label="Type">
              {pretty(d.mediaType)}
              {d.episodes != null && ` · ${d.episodes} ep`}
            </Fact>
            <Fact label="Members">
              {d.members != null ? fmtNumber(d.members) : '?'}
              {d.popularityRank != null && <span className="muted small"> #{d.popularityRank}</span>}
            </Fact>
            <Fact label="Difficulty">
              <span className={`difficulty ${d.difficulty}`}>{d.difficulty}</span>
            </Fact>
          </dl>
          <div className="db-chips">
            {d.studios.map((s) => (
              <a key={s} className="chip studio" href={`/database?studio=${encodeURIComponent(s)}`}>
                {s}
              </a>
            ))}
            {d.source && (
              <a className="chip source" href={`/database?source=${encodeURIComponent(d.source)}`}>
                {pretty(d.source)}
              </a>
            )}
            {d.genres.map((g) => (
              <a key={g.id} className={`chip ${g.type === 'themes' || g.type === 'demographics' ? 'tag' : 'genre'}`} href={`/database?genre=${g.id}`}>
                {g.name}
              </a>
            ))}
          </div>
          <a className="small" href={malHref(d.malId)} target="_blank" rel="noreferrer">
            Open on MAL ↗
          </a>
        </div>
      </section>

      <div className="round-tabs show-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`round-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            <b>{t.label}</b>
            <span>{t.note}</span>
          </button>
        ))}
      </div>

      <section className="card show-card" role="tabpanel">
        {tab === 'anidle' && <AnidlePanel d={d} />}
        {tab === 'opening' && <SongPanel song={d.songs.op} poster={d.clues.poster} withCover={false} />}
        {tab === 'ending' && <SongPanel song={d.songs.ed} poster={d.clues.poster} withCover />}
        {tab === 'character' && <CharacterPanel d={d} />}
        {tab === 'screenshot' && <ScreenshotPanel d={d} />}
        {tab === 'about' && <AboutPanel d={d} />}
      </section>
    </div>
  );
}
