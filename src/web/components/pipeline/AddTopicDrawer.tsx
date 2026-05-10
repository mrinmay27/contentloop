import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Topic } from '../../lib/types';

type Mode = 'url' | 'manual';
type Format = 'post' | 'carousel' | 'reel';

interface Niche { id: string; name: string; }

interface Props {
  onCreated: (topic: Topic) => void;
  onClose:   () => void;
}

const FORMAT_OPTS: { key: Format; label: string; icon: string }[] = [
  { key: 'post',     label: 'Post',     icon: '📄' },
  { key: 'carousel', label: 'Carousel', icon: '🎠' },
  { key: 'reel',     label: 'Reel',     icon: '🎬' },
];

export const AddTopicDrawer: React.FC<Props> = ({ onCreated, onClose }) => {
  const [mode, setMode]             = useState<Mode>('url');
  const [niches, setNiches]         = useState<Niche[]>([]);
  const [nicheId, setNicheId]       = useState('');
  const [format, setFormat]         = useState<Format>('post');

  // URL mode state
  const [url, setUrl]               = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [extracted, setExtracted]   = useState<{
    title: string; description: string; keyPoints: string; imageUrl: string | null;
  } | null>(null);

  // Manual / editable fields (shared between both modes after extraction)
  const [title, setTitle]           = useState('');
  const [keyPoints, setKeyPoints]   = useState('');

  // Submit state
  const [creating, setCreating]     = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    api.getNiches().then(list => {
      setNiches(list);
      if (list.length > 0) setNicheId(list[0].id);
    }).catch(() => {});
  }, []);

  const handleExtract = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setExtracting(true); setExtractError(''); setExtracted(null);
    try {
      const { article } = await api.extractUrl(trimmed);
      setExtracted(article);
      setTitle(article.title);
      setKeyPoints(article.keyPoints || article.description);
    } catch (err: any) {
      setExtractError(err?.message ?? 'Could not extract article — fill in manually below');
      setMode('manual');
    } finally {
      setExtracting(false);
    }
  };

  const handleCreate = async () => {
    if (!title.trim() || !nicheId) return;
    setCreating(true); setCreateError('');
    try {
      const { topic } = await api.createManualTopic({
        nicheId,
        title:           title.trim(),
        keyPoints:       keyPoints.trim(),
        sourceUrl:       url.trim() || undefined,
        suggestedFormat: format,
      });
      onCreated(topic);
    } catch (err: any) {
      setCreateError(err?.message ?? 'Failed to create topic');
      setCreating(false);
    }
  };

  const canCreate = title.trim().length > 0 && nicheId.length > 0;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          background: 'rgba(0,0,0,0.45)',
        }}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 9001,
        width: 480, background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.35)',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              ✍️ Add Topic
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Paste an article URL or write one from scratch
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 18, color: 'var(--text-muted)', lineHeight: 1,
          }}>✕</button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

          {/* Mode toggle */}
          <div style={{
            display: 'flex', gap: 0, marginBottom: 20,
            border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden',
          }}>
            {(['url', 'manual'] as Mode[]).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', border: 'none',
                background: mode === m ? 'var(--accent)' : 'transparent',
                color: mode === m ? '#000' : 'var(--text-secondary)',
                transition: 'all 0.15s',
              }}>
                {m === 'url' ? '🔗 From URL' : '✏️ Manual'}
              </button>
            ))}
          </div>

          {/* ── URL MODE ── */}
          {mode === 'url' && (
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                Article URL
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleExtract()}
                  placeholder="https://techcrunch.com/..."
                  style={{ flex: 1, fontSize: 12 }}
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleExtract}
                  disabled={!url.trim() || extracting}
                  style={{ flexShrink: 0 }}
                >
                  {extracting ? '⏳' : '⚡ Extract'}
                </button>
              </div>
              {extractError && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--red, #ef4444)' }}>
                  {extractError} — switching to manual mode.
                </div>
              )}
            </div>
          )}

          {/* ── Extracted preview ── */}
          {extracted?.imageUrl && (
            <div style={{
              marginBottom: 16, borderRadius: 'var(--radius-sm)', overflow: 'hidden',
              border: '1px solid var(--border)', position: 'relative',
              paddingTop: '45%', background: '#000',
            }}>
              <img
                src={extracted.imageUrl}
                alt="Article thumbnail"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              />
            </div>
          )}

          {/* ── Editable fields (shown always in manual mode, after extraction in URL mode) ── */}
          {(mode === 'manual' || extracted) && (
            <>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  Title <span style={{ color: 'var(--red, #ef4444)' }}>*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="What's this content about?"
                  style={{ width: '100%', fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  Key Points / Notes
                  <span style={{ fontWeight: 400, marginLeft: 6 }}>(used in image prompts + captions)</span>
                </label>
                <textarea
                  value={keyPoints}
                  onChange={e => setKeyPoints(e.target.value)}
                  rows={5}
                  placeholder="• Key insight 1&#10;• Key insight 2&#10;• Key insight 3"
                  style={{ width: '100%', fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }}
                />
              </div>

              {/* Manual mode: URL as source reference */}
              {mode === 'manual' && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                    Source URL <span style={{ fontWeight: 400 }}>(optional)</span>
                  </label>
                  <input
                    type="url"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    placeholder="https://..."
                    style={{ width: '100%', fontSize: 12, boxSizing: 'border-box' }}
                  />
                </div>
              )}
            </>
          )}

          {/* ── Niche picker ── */}
          {(mode === 'manual' || extracted) && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                Niche / Page <span style={{ color: 'var(--red, #ef4444)' }}>*</span>
              </label>
              <select
                value={nicheId}
                onChange={e => setNicheId(e.target.value)}
                style={{ width: '100%', fontSize: 12, boxSizing: 'border-box' }}
              >
                {niches.length === 0 && <option value="">Loading…</option>}
                {niches.map(n => (
                  <option key={n.id} value={n.id}>{n.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* ── Format picker ── */}
          {(mode === 'manual' || extracted) && (
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
                Start as
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {FORMAT_OPTS.map(f => (
                  <button
                    key={f.key}
                    onClick={() => setFormat(f.key)}
                    style={{
                      flex: 1, padding: '8px 4px', fontSize: 11, fontWeight: 600,
                      cursor: 'pointer', borderRadius: 'var(--radius-sm)',
                      border: format === f.key ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
                      background: format === f.key ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--bg-base)',
                      color: format === f.key ? 'var(--accent)' : 'var(--text-secondary)',
                      transition: 'all 0.15s',
                    }}
                  >
                    {f.icon} {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {createError && (
            <div style={{ fontSize: 11, color: 'var(--red, #ef4444)', marginBottom: 12 }}>
              {createError}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{
          padding: '14px 20px', borderTop: '1px solid var(--border)',
          display: 'flex', gap: 10, flexShrink: 0,
          background: 'var(--bg-elevated)',
        }}>
          <button className="btn btn-surface btn-sm" onClick={onClose} style={{ flex: 1 }}>
            Cancel
          </button>
          {(mode === 'manual' || extracted) && (
            <button
              className="btn btn-primary btn-sm"
              onClick={handleCreate}
              disabled={!canCreate || creating}
              style={{ flex: 2 }}
            >
              {creating ? '⏳ Creating…' : '✨ Create & Edit'}
            </button>
          )}
        </div>
      </div>
    </>
  );
};
