import React, { useState } from 'react';
import { api } from '../../lib/api';

/**
 * Pexels stock video, pickable per slide.
 *
 * The sourcing existed since Phase A but ran only inside the background media
 * job, and only for reels that already had TTS audio — so there was no way to
 * choose a clip, or to get one at all before audio existed. This is the manual
 * control that was missing.
 */

type Props = {
  contentId: string | null;
  slideIndex: number;
  /** Seeds the search box so the first result set is usually usable. */
  defaultQuery: string;
  onAttached?: (url: string) => void;
};

export const StockFootagePicker: React.FC<Props> = ({
  contentId, slideIndex, defaultQuery, onAttached,
}) => {
  const [q, setQ]             = useState(defaultQuery);
  const [videos, setVideos]   = useState<any[] | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const [busy, setBusy]       = useState<'search' | 'attach' | null>(null);
  const [chosen, setChosen]   = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const disabled = !contentId;

  const search = async () => {
    if (!q.trim()) return;
    setBusy('search'); setError(null);
    try {
      const res = await api.searchStockVideos(q.trim());
      setNeedsKey(res.needsKey);
      setVideos(res.videos);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally { setBusy(null); }
  };

  const attach = async (v: any) => {
    if (!contentId) return;
    setBusy('attach'); setError(null);
    try {
      const { url } = await api.attachStockVideo(contentId, {
        downloadUrl: v.downloadUrl, slideIndex,
        width: v.width, height: v.height, durationSec: v.duration,
      });
      setChosen(url);
      onAttached?.(url);
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Could not attach that clip';
      try { setError(JSON.parse(raw).error ?? raw); } catch { setError(raw); }
    } finally { setBusy(null); }
  };

  if (chosen) {
    return (
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <video src={chosen} controls
          style={{ width: 110, borderRadius: 6, border: '1px solid var(--border)', background: '#000' }}/>
        <button className="btn btn-ghost btn-sm" onClick={() => { setChosen(null); setVideos(null); }}>
          Pick a different clip
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input type="text" value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') search(); }}
          placeholder="Search stock footage…"
          style={{ flex: 1, fontSize: 11 }} disabled={disabled}/>
        <button className="btn btn-primary btn-sm" onClick={search}
          disabled={disabled || busy !== null} style={{ fontSize: 11 }}>
          {busy === 'search' ? 'Searching…' : 'Search'}
        </button>
      </div>

      {needsKey && (
        <div style={{ fontSize: 11, lineHeight: 1.6, padding: '8px 10px',
          background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
          borderRadius: 'var(--radius-sm)' }}>
          Stock footage needs a free Pexels key. Add one in{' '}
          <strong>Settings → Generation → Stock Footage</strong>, then search again.
        </div>
      )}

      {videos && !needsKey && videos.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          No clips found for “{q}”. Try a broader term.
        </div>
      )}

      {videos && videos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
          gap: 6 }}>
          {videos.map(v => (
            <button key={v.id} onClick={() => attach(v)} disabled={busy !== null}
              title={`${v.width}×${v.height} · ${v.duration}s`}
              style={{ padding: 0, border: '1px solid var(--border)', borderRadius: 6,
                overflow: 'hidden', cursor: 'pointer', background: 'var(--bg-base)' }}>
              {v.previewImage
                ? <img src={v.previewImage} alt="" style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }}/>
                : <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}>clip</div>}
              <div style={{ fontSize: 9, color: 'var(--text-muted)', padding: '2px 0' }}>{v.duration}s</div>
            </button>
          ))}
        </div>
      )}

      {busy === 'attach' && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>Downloading clip…</div>
      )}
      {error && <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 6 }}>{error}</div>}
    </div>
  );
};
