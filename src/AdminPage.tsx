import { useCallback, useEffect, useState } from 'react';
import { MEDIA_KINDS as KINDS, MEDIA_STATUSES as STATUSES, type MediaKind } from '../shared/modes';
import { api, errorMessage, type AdminPage as AdminData } from './api';
import { fmtNumber } from './format';

const KIND_LABELS: Record<MediaKind, string> = { cover: 'Cover', op: 'Opening', ed: 'Ending', chars: 'Character', shots: 'Screenshot' };

type Item = AdminData['items'][number];

function MediaPreview({ item, kind }: { item: Item; kind: MediaKind }) {
  const cell = item.media[kind];
  if (!cell || cell.status === 'missing') return null;
  if (kind === 'op' || kind === 'ed') return cell.url ? <audio controls preload="none" src={cell.url} /> : null;
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
  const [kind, setKind] = useState<MediaKind | ''>('');
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

  const act = async (item: Item, k: MediaKind, action: 'reject' | 'restore') => {
    setBusy(`${item.malId}:${k}`);
    try {
      await api.setMediaStatus(item.malId, k, action);
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
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
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
              {KINDS.map((k) => {
                const cell = item.media[k];
                return (
                  <div key={k} className="admin-row">
                    <span className="admin-kind">{KIND_LABELS[k]}</span>
                    <span className={`admin-status ${cell?.status ?? 'none'}`} title={cell?.error ?? undefined}>
                      {cell?.status ?? 'none'}
                    </span>
                    <div className="admin-preview">
                      {cell?.song && (
                        <span className="small muted">
                          {cell.label} · {cell.song}
                        </span>
                      )}
                      <MediaPreview item={item} kind={k} />
                      {cell?.error && cell.status !== 'ok' && <span className="small muted">{cell.error}</span>}
                    </div>
                    {cell?.status === 'ok' && (
                      <button className="ghost small danger" disabled={busy !== null} onClick={() => act(item, k, 'reject')}>
                        Reject
                      </button>
                    )}
                    {cell?.status === 'rejected' && (
                      <button className="ghost small" disabled={busy !== null} onClick={() => act(item, k, 'restore')}>
                        Restore
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </article>
        ))}
      </div>

      {data && pages > 1 && (
        <div className="db-paging">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← Previous
          </button>
          <span className="muted">
            Page {page} of {pages}
          </span>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
