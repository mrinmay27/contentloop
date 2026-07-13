import React from 'react';
import { Icon } from '../ui/Icon';
import { ScoreRing, PlatformBadge } from '../ui/Badges';
import { api } from '../../lib/api';
import type { SuggestedFormat, Topic } from '../../lib/types';

type Props = {
  topic: Topic;
  pageId: string;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onEdit?: (topic: Topic) => void;
  onDiscard?: (id: string) => void;
  onFormatChange?: (id: string, format: SuggestedFormat) => void;
  onApproved?: (topicId: string) => void;
};

const STATUS_CLASS: Record<string, string> = {
  approved:  'badge-green',
  scheduled: 'badge-blue',
  posted:    'badge-muted',
  review:    'badge-amber',
};

const FORMAT_CONFIG: Record<SuggestedFormat, { label: string; emoji: string }> = {
  post:     { label: 'Post',     emoji: '📄' },
  carousel: { label: 'Carousel', emoji: '🎠' },
  reel:     { label: 'Reel',     emoji: '🎬' },
};

const CONFIDENCE_COLOR: Record<string, string> = {
  user:         'var(--green, #22c55e)',
  llm:          'var(--green, #22c55e)',
  rule:         'var(--amber, #f59e0b)',
  page_default: 'var(--text-muted)',
  learned:      'var(--purple, #8b5cf6)',
};

function isContentReady(topic: Topic): boolean {
  return topic.state === 'CONTENT_READY' || topic.state === 'QA_PASSED';
}

function resolveStatus(topic: Topic): string {
  if (topic.status) return topic.status;
  const map: Record<string, string> = {
    SELECTED: 'review', APPROVED: 'approved', SCHEDULED: 'scheduled', POSTED: 'posted',
  };
  return map[topic.state] ?? 'review';
}

function resolvePlatform(topic: Topic): string {
  if (topic.platform) return topic.platform;
  const src = topic.sources?.[0]?.toLowerCase() ?? '';
  if (src.includes('reddit'))                           return 'reddit';
  if (src.includes('twitter') || src.includes('x.com')) return 'twitter';
  if (src === 'trends' || src === 'google_trends')      return 'google_trends';
  return src || 'rss';
}

type PreviewData = { id: string; status: string; type: string; payload: any } | null;

export const TopicCard: React.FC<Props> = ({
  topic, pageId, selected, onSelect, onEdit, onDiscard, onFormatChange, onApproved,
}) => {
  const status   = resolveStatus(topic);
  const platform = resolvePlatform(topic);
  const tags     = topic.tags ?? topic.keywords?.slice(0, 3) ?? [];
  const rawScore = topic.score ?? 0;
  const score    = Math.round(rawScore > 1 ? Math.min(rawScore, 100) : rawScore * 100);
  const contentReady = isContentReady(topic);

  const [formatPickerOpen, setFormatPickerOpen] = React.useState(false);
  const [previewOpen,      setPreviewOpen]      = React.useState(false);
  const [preview,          setPreview]          = React.useState<PreviewData>(null);
  const [previewLoading,   setPreviewLoading]   = React.useState(false);
  const [approving,        setApproving]        = React.useState(false);
  const [localStatus,      setLocalStatus]      = React.useState(status);

  React.useEffect(() => { setLocalStatus(resolveStatus(topic)); }, [topic]);

  const loadPreview = async () => {
    if (preview || previewLoading) return;
    setPreviewLoading(true);
    try {
      const { preview: p } = await api.getTopicPreview(topic.id, pageId);
      setPreview(p);
    } catch {}
    setPreviewLoading(false);
  };

  const togglePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!previewOpen) loadPreview();
    setPreviewOpen(o => !o);
  };

  const handleApprove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!preview?.id || approving) return;
    setApproving(true);
    try {
      await api.approveContent(preview.id);
      setLocalStatus('approved');
      setPreview(p => p ? { ...p, status: 'approved' } : p);
      onApproved?.(topic.id);
    } catch {}
    setApproving(false);
  };

  const fmt     = topic.suggestedFormat;
  const fmtConf = topic.formatConfidence;
  const editLabel = contentReady && fmt
    ? `${FORMAT_CONFIG[fmt].emoji} Edit ${FORMAT_CONFIG[fmt].label}`
    : undefined;

  const firstImageUrl: string | null = (() => {
    if (!preview?.payload) return null;
    const imgs = preview.payload.images ?? [];
    const first = imgs[0];
    if (!first) return null;
    return typeof first === 'string' ? first : first.url ?? null;
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* ── Main card row ── */}
      <div className={`topic-card ${selected ? 'selected' : ''}`} onClick={() => onSelect?.(topic.id)}>
        <div
          className={`topic-check ${selected ? 'checked' : ''}`}
          onClick={e => { e.stopPropagation(); onSelect?.(topic.id); }}
        >
          {selected && <Icon name="check" size={10}/>}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="topic-title">{topic.title}</div>
          <div className="topic-meta">
            <PlatformBadge platform={platform}/>
            <ScoreRing score={score} size={28}/>
            {topic.scoreBreakdown?.learnedBoost != null && topic.scoreBreakdown.learnedBoost !== 1 && (
              <span
                className={`badge ${topic.scoreBreakdown.learnedBoost > 1 ? 'badge-green' : 'badge-amber'}`}
                title={`Learning boost ×${Number(topic.scoreBreakdown.learnedBoost).toFixed(2)} from past performance`}
                style={{ fontSize: 9, padding: '1px 5px' }}
              >
                {topic.scoreBreakdown.learnedBoost > 1 ? '▲ boosted' : '▼ damped'}
              </span>
            )}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
              {tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
            </div>

            {fmt && (
              <div style={{ position: 'relative' }}>
                <button
                  title={`Format: ${fmt} (${fmtConf ?? 'unknown'})`}
                  onClick={e => { e.stopPropagation(); setFormatPickerOpen(o => !o); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 3,
                    fontSize: 10, fontWeight: 600, padding: '2px 7px',
                    borderRadius: 10, cursor: 'pointer',
                    border: `1px solid ${CONFIDENCE_COLOR[fmtConf ?? 'page_default']}`,
                    background: 'transparent',
                    color: CONFIDENCE_COLOR[fmtConf ?? 'page_default'],
                    transition: 'all 0.15s',
                  }}>
                  <span style={{ fontSize: 11 }}>{FORMAT_CONFIG[fmt].emoji}</span>
                  {FORMAT_CONFIG[fmt].label}
                </button>
                {formatPickerOpen && (
                  <div onClick={e => e.stopPropagation()} style={{
                    position: 'absolute', bottom: 'calc(100% + 4px)', left: 0,
                    background: 'var(--bg-surface)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)', padding: 6, zIndex: 999,
                    display: 'flex', flexDirection: 'column', gap: 3, minWidth: 110,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  }}>
                    {(Object.keys(FORMAT_CONFIG) as SuggestedFormat[]).map(f => (
                      <button key={f}
                        onClick={() => { onFormatChange?.(topic.id, f); setFormatPickerOpen(false); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          fontSize: 11, padding: '4px 8px', borderRadius: 4,
                          background: f === fmt ? 'var(--accent-dim)' : 'transparent',
                          color: f === fmt ? 'var(--accent)' : 'var(--text-secondary)',
                          border: 'none', cursor: 'pointer', fontWeight: f === fmt ? 600 : 400,
                          textAlign: 'left',
                        }}>
                        {FORMAT_CONFIG[f].emoji} {FORMAT_CONFIG[f].label}
                        {f === fmt && <span style={{ marginLeft: 'auto', fontSize: 9 }}>✓</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <span className={`badge ${STATUS_CLASS[localStatus] ?? 'badge-muted'}`}>{localStatus}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}>
          {contentReady && (
            <button
              className="btn btn-sm btn-surface"
              title={previewOpen ? 'Hide preview' : 'Quick preview'}
              onClick={togglePreview}
              style={{ fontSize: 10, padding: '3px 7px' }}
            >
              {previewOpen ? '▲ Hide' : '▼ Preview'}
            </button>
          )}
          <button
            className={`btn btn-sm ${contentReady && fmt ? 'btn-primary' : 'btn-surface'}`}
            title={editLabel ?? 'Edit topic'}
            onClick={e => { e.stopPropagation(); onEdit?.(topic); }}
            style={editLabel ? { display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '3px 8px' } : {}}
          >
            {editLabel ?? <Icon name="edit" size={11}/>}
          </button>
          <button className="btn btn-sm btn-danger"
            title="Discard topic"
            onClick={e => { e.stopPropagation(); onDiscard?.(topic.id); }}>
            <Icon name="trash" size={11}/>
          </button>
        </div>
      </div>

      {/* ── Preview panel (expands below card) ── */}
      {previewOpen && (
        <div onClick={e => e.stopPropagation()} style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderTop: 'none',
          borderRadius: '0 0 var(--radius) var(--radius)',
          padding: '12px 16px',
          display: 'flex', gap: 14, alignItems: 'flex-start',
        }}>
          {previewLoading && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0' }}>
              Loading preview…
            </div>
          )}

          {!previewLoading && !preview && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              No content generated yet — run Generate step first.
            </div>
          )}

          {!previewLoading && preview && (
            <>
              {/* Thumbnail */}
              {firstImageUrl && (
                <img src={firstImageUrl} alt="preview"
                  style={{ width: 80, height: 80, objectFit: 'cover',
                    borderRadius: 'var(--radius-sm)', flexShrink: 0, border: '1px solid var(--border)' }}
                />
              )}

              {/* Text content */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {preview.payload?.hook && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                    {preview.payload.hook}
                  </div>
                )}
                {preview.payload?.caption && (
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5,
                    display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {preview.payload.caption}
                  </div>
                )}
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>
                  {preview.type} · {preview.payload?.images?.length ?? 0} image{(preview.payload?.images?.length ?? 0) !== 1 ? 's' : ''}
                  {preview.payload?.hashtags?.length > 0 && ` · ${preview.payload.hashtags.length} tags`}
                </div>
              </div>

              {/* Approve action */}
              <div style={{ flexShrink: 0 }}>
                {localStatus === 'approved' ? (
                  <button className="btn btn-sm" disabled style={{
                    background: 'var(--green, #22c55e)', color: '#fff',
                    border: '1px solid var(--green, #22c55e)', opacity: 1, cursor: 'default',
                  }}>
                    ✓ Approved
                  </button>
                ) : (
                  <button className="btn btn-primary btn-sm"
                    disabled={approving}
                    onClick={handleApprove}>
                    {approving ? '…' : '✓ Approve'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
