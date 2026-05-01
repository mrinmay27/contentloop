import React from 'react';
import { Icon } from '../ui/Icon';
import { ScoreRing, PlatformBadge } from '../ui/Badges';
import type { SuggestedFormat, Topic } from '../../lib/types';

type Props = {
  topic: Topic;
  selected?: boolean;
  onSelect?: (id: string) => void;
  onEdit?: (topic: Topic) => void;
  onDiscard?: (id: string) => void;
  onFormatChange?: (id: string, format: SuggestedFormat) => void;
};

const STATUS_CLASS: Record<string, string> = {
  approved:  'badge-green',
  scheduled: 'badge-blue',
  posted:    'badge-muted',
  review:    'badge-amber',
};

// Task 1.5: Format badge config
const FORMAT_CONFIG: Record<SuggestedFormat, { label: string; emoji: string }> = {
  post:     { label: 'Post',     emoji: '📄' },
  carousel: { label: 'Carousel', emoji: '🎠' },
  reel:     { label: 'Reel',     emoji: '🎬' },
};

// Confidence → colour
const CONFIDENCE_COLOR: Record<string, string> = {
  user:         'var(--green, #22c55e)',
  llm:          'var(--green, #22c55e)',
  rule:         'var(--amber, #f59e0b)',
  page_default: 'var(--text-muted)',
};

/** True when a topic has content generated and ready for review */
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
  if (src.includes('reddit'))  return 'reddit';
  if (src.includes('twitter') || src.includes('x.com')) return 'twitter';
  if (src.includes('rss'))     return 'rss';
  return 'trends';
}

export const TopicCard: React.FC<Props> = ({ topic, selected, onSelect, onEdit, onDiscard, onFormatChange }) => {
  const status   = resolveStatus(topic);
  const platform = resolvePlatform(topic);
  const tags     = topic.tags ?? topic.keywords?.slice(0, 3) ?? [];
  const score    = topic.score ?? 0;

  const [formatPickerOpen, setFormatPickerOpen] = React.useState(false);
  const fmt = topic.suggestedFormat;
  const fmtConf = topic.formatConfidence;
  const contentReady = isContentReady(topic);

  // Task 3.4: format-aware edit button
  const editLabel = contentReady && fmt
    ? `${FORMAT_CONFIG[fmt].emoji} Edit ${FORMAT_CONFIG[fmt].label}`
    : undefined;
  const editTitle = contentReady && fmt
    ? `Open in editor — ${FORMAT_CONFIG[fmt].label} tab`
    : 'Edit topic';

  return (
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
          <ScoreRing score={Math.round(score)} size={28}/>
          <div style={{ display:'flex', gap:4, flexWrap:'wrap', flex:1 }}>
            {tags.map(tag => <span key={tag} className="tag">{tag}</span>)}
          </div>

          {/* Task 1.5: Format badge — clickable inline picker */}
          {fmt && (
            <div style={{ position:'relative' }}>
              <button
                title={`Format: ${fmt} (${fmtConf ?? 'unknown'})`}
                onClick={e => { e.stopPropagation(); setFormatPickerOpen(o => !o); }}
                style={{
                  display:'flex', alignItems:'center', gap:3,
                  fontSize:10, fontWeight:600, padding:'2px 7px',
                  borderRadius:10, cursor:'pointer',
                  border: `1px solid ${CONFIDENCE_COLOR[fmtConf ?? 'page_default']}`,
                  background:'transparent',
                  color: CONFIDENCE_COLOR[fmtConf ?? 'page_default'],
                  transition:'all 0.15s',
                }}>
                <span style={{ fontSize:11 }}>{FORMAT_CONFIG[fmt].emoji}</span>
                {FORMAT_CONFIG[fmt].label}
              </button>

              {formatPickerOpen && (
                <div
                  onClick={e => e.stopPropagation()}
                  style={{
                    position:'absolute', bottom:'calc(100% + 4px)', left:0,
                    background:'var(--bg-surface)', border:'1px solid var(--border)',
                    borderRadius:'var(--radius-sm)', padding:6, zIndex:999,
                    display:'flex', flexDirection:'column', gap:3, minWidth:110,
                    boxShadow:'0 4px 12px rgba(0,0,0,0.3)',
                  }}>
                  {(Object.keys(FORMAT_CONFIG) as SuggestedFormat[]).map(f => (
                    <button key={f}
                      onClick={() => {
                        onFormatChange?.(topic.id, f);
                        setFormatPickerOpen(false);
                      }}
                      style={{
                        display:'flex', alignItems:'center', gap:5,
                        fontSize:11, padding:'4px 8px', borderRadius:4,
                        background: f === fmt ? 'var(--accent-dim)' : 'transparent',
                        color: f === fmt ? 'var(--accent)' : 'var(--text-secondary)',
                        border:'none', cursor:'pointer', fontWeight: f === fmt ? 600 : 400,
                        textAlign:'left',
                      }}>
                      {FORMAT_CONFIG[f].emoji} {FORMAT_CONFIG[f].label}
                      {f === fmt && <span style={{ marginLeft:'auto', fontSize:9 }}>✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <span className={`badge ${STATUS_CLASS[status] ?? 'badge-muted'}`}>{status}</span>
        </div>
      </div>

      <div style={{ display:'flex', gap:4, flexShrink:0, alignItems:'center' }}>
        {/* Task 3.4: format-aware edit button — primary+labeled when content is ready */}
        <button
          className={`btn btn-sm ${contentReady && fmt ? 'btn-primary' : 'btn-surface'}`}
          title={editTitle}
          onClick={e => { e.stopPropagation(); onEdit?.(topic); }}
          style={editLabel ? { display:'flex', alignItems:'center', gap:4, fontSize:10, padding:'3px 8px' } : {}}
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
  );
};
