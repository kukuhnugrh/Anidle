import { useCallback, useEffect, useState } from 'react';
import type { ReviewKind } from '../server/admin';
import { MEDIA_KINDS, MEDIA_STATUSES as STATUSES, type MediaKind, type ThemeKind } from '../shared/modes';
import { api, errorMessage, type AdminPage as AdminData } from './api';
import { fmtNumber } from './format';
import { TextField } from './sakuga';

const SONG_KINDS: readonly ThemeKind[] = ['op', 'ed'];
/** Filter and count rows: media kinds, and the songs of each kind. */
const KINDS: readonly ReviewKind[] = ['cover', 'op', 'ed', 'chars', 'shots'];
const KIND_LABELS: Record<ReviewKind, string> = { cover: 'Cover', op: 'Opening', ed: 'Ending', chars: 'Character', shots: 'Screenshot' };

type Item = AdminData['items'][number];

function MediaPreview({ item, kind }: { item: Item; kind: MediaKind }) {
  const cell = item.media[kind];
  if (!cell || cell.status === 'missing') return null;
  if (kind === 'cover') return cell.url ? <img className="admin-thumb" src={cell.url} alt="" loading="lazy" /> : null;
  const urls = kind === 'chars' ? item.characters.map((c) => c.url) : item.screenshots;
  return (
    <div className="admin-thumbs">
      {urls.map((u) => (
        <img key={u} className={kind === 'shots' ? 'admin-shot' : 'admin-thumb'} src={u} alt="" loading="lazy" />
      ))}
    </div>
  );
}

export function AdminPage() {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<ReviewKind | ''>('');
  const [status, setStatus] = useState<(typeof STATUSES)[number] | ''>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (kind) p.set('kind', kind);
    if (status) p.set('status', status);
    p.set('page', String(page));
    api.adminMedia(p.toString()).then(
      (d) => {
        setData(d);
        setError(null);
      },
      (err: unknown) => setError(errorMessage(err)),
    );
  }, [q, kind, status, page]);

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const act = async (key: string, request: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await request();
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="stack">
      <header className="page-head">
        <span className="eyebrow">Admin</span>
        <h1>Review media</h1>
        <p className="muted">Pipeline results per title. Rejected media are not used in new puzzles and are not reprocessed by the pipeline (unless `--refresh`).</p>
      </header>

      {data && (
        <section className="card admin-counts">
          <table>
            <thead>
              <tr>
                <th />
                {STATUSES.map((s) => (
                  <th key={s}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {KINDS.map((k) => (
                <tr key={k}>
                  <th>{KIND_LABELS[k]}</th>
                  {STATUSES.map((s) => (
                    <td key={s}>
                      <button
                        className="link-button"
                        onClick={() => {
                          setKind(k);
                          setStatus(s);
                          setPage(1);
                        }}
                      >
                        {fmtNumber(data.counts[k]?.[s] ?? 0)}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card db-filters">
        <label className="db-search">
          Search titles
          <TextField
            label="Search titles"
            value={q}
            onValue={(value) => {
              setQ(value);
              setPage(1);
            }}
            placeholder="Romaji or English title"
          />
        </label>
        <label>
          Media
          <select
            value={kind}
            onChange={(e) => {
              setKind(KINDS.find((k) => k === e.target.value) ?? '');
              setPage(1);
            }}
          >
            <option value="">All</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(e) => {
              setStatus(STATUSES.find((s) => s === e.target.value) ?? '');
              setPage(1);
            }}
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </section>

      {error && <div className="error-box">{error}</div>}
      {data && <div className="muted small">{fmtNumber(data.total)} titles</div>}

      <div className="admin-list">
        {data?.items.map((item) => (
          <article key={item.malId} className="card admin-item">
            <div className="admin-head">
              {item.cover && <img className="admin-cover" src={item.cover} alt="" loading="lazy" />}
              <div>
                <a href={`https://myanimelist.net/anime/${item.malId}`} target="_blank" rel="noreferrer">
                  <b>{item.title}</b>
                </a>
                <div className="muted small">
                  #{item.malId} · {item.members != null ? `${fmtNumber(item.members)} members` : 'members ?'} · <span className={`difficulty ${item.difficulty}`}>{item.difficulty}</span>
                </div>
              </div>
            </div>
            <div className="admin-media">
              {MEDIA_KINDS.map((k) => {
                const cell = item.media[k];
                return (
                  <div key={k} className="admin-row">
                    <span className="admin-kind">{KIND_LABELS[k]}</span>
                    <span className={`admin-status ${cell?.status ?? 'none'}`} title={cell?.error ?? undefined}>
                      {cell?.status ?? 'none'}
                    </span>
                    <div className="admin-preview">
                      <MediaPreview item={item} kind={k} />
                      {cell?.error && cell.status !== 'ok' && <span className="small muted">{cell.error}</span>}
                    </div>
                    {cell?.status === 'ok' && (
                      <sakuga-button
                        variant="secondary"
                        className="danger"
                        disabled={busy !== null}
                        onClick={(e) => !e.currentTarget.disabled && act(`${item.malId}:${k}`, () => api.setMediaStatus(item.malId, k, 'reject'))}
                      >
                        Reject
                      </sakuga-button>
                    )}
                    {cell?.status === 'rejected' && (
                      <sakuga-button
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={(e) => !e.currentTarget.disabled && act(`${item.malId}:${k}`, () => api.setMediaStatus(item.malId, k, 'restore'))}
                      >
                        Restore
                      </sakuga-button>
                    )}
                  </div>
                );
              })}
              {SONG_KINDS.map((k) => {
                const songs = item.themes.filter((t) => t.kind === k);
                if (!songs.length)
                  return (
                    <div key={k} className="admin-row">
                      <span className="admin-kind">{KIND_LABELS[k]}</span>
                      <span className="admin-status none">none</span>
                    </div>
                  );
                return songs.map((t) => (
                  <div key={t.id} className="admin-row">
                    <span className="admin-kind">{KIND_LABELS[k]}</span>
                    <span className={`admin-status ${t.status}`}>{t.status}</span>
                    <div className="admin-preview">
                      <span className="small muted">{[t.label, t.title && `“${t.title}”`, t.artist, t.entry && `from ${t.entry.title}`].filter(Boolean).join(' · ')}</span>
                      <audio controls preload="none" src={t.audio} />
                    </div>
                    {t.status === 'ok' ? (
                      <sakuga-button
                        variant="secondary"
                        className="danger"
                        disabled={busy !== null}
                        onClick={(e) => !e.currentTarget.disabled && act(`theme:${t.id}`, () => api.setThemeStatus(t.id, 'reject'))}
                      >
                        Reject
                      </sakuga-button>
                    ) : (
                      <sakuga-button
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={(e) => !e.currentTarget.disabled && act(`theme:${t.id}`, () => api.setThemeStatus(t.id, 'restore'))}
                      >
                        Restore
                      </sakuga-button>
                    )}
                  </div>
                ));
              })}
            </div>
          </article>
        ))}
      </div>

      {data && pages > 1 && (
        <div className="db-paging">
          <sakuga-button variant="secondary" disabled={page <= 1} onClick={(e) => !e.currentTarget.disabled && setPage(page - 1)}>
            ← Previous
          </sakuga-button>
          <span className="muted">
            Page {page} of {pages}
          </span>
          <sakuga-button variant="secondary" disabled={page >= pages} onClick={(e) => !e.currentTarget.disabled && setPage(page + 1)}>
            Next →
          </sakuga-button>
        </div>
      )}
    </div>
  );
}
