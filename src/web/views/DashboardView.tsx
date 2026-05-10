import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Icon } from '../components/ui/Icon';
import { MetricCards } from '../components/dashboard/MetricCards';
import { PipelineBar } from '../components/dashboard/PipelineBar';
import { TopicCard } from '../components/dashboard/TopicCard';
import { TopicSourcePanel } from '../components/dashboard/TopicSourcePanel';
import { ConfirmModal } from '../components/modals/ConfirmModal';
import { api } from '../lib/api';
import type { SuggestedFormat, ThemePage, Topic, Stats } from '../lib/types';

type Props = {
  page: ThemePage;
  topics: Topic[];
  stats: Stats;
  busy: string | null;
  onOpenEditor: (t: Topic) => void;
  onRunJob: (job: string) => void;
};

const TABS = [
  { key:'scored',    label:'Selected',  desc:'Topics passed scoring — ready to generate content', icon:'⭐' },
  { key:'backup',    label:'Backup',    desc:'Passed scoring but lower priority',                  icon:'🔄' },
  { key:'review',    label:'Review',    desc:'Content generated — needs your approval',            icon:'📝' },
  { key:'scheduled', label:'Scheduled', desc:'Approved and queued to post',                        icon:'📅' },
  { key:'posted',    label:'Posted',    desc:'Live on platform',                                   icon:'✅' },
] as const;

type TabKey = typeof TABS[number]['key'];

// ─── Sort state ───────────────────────────────────────────────────────────────
type SortField = 'score' | 'date' | 'source' | 'title';
type SortDir   = 'desc' | 'asc';
type SortState = { field: SortField; dir: SortDir };
const DEFAULT_SORT: SortState = { field: 'score', dir: 'desc' };

const SORT_OPTIONS: { field: SortField; label: string }[] = [
  { field: 'score',  label: 'Score'  },
  { field: 'date',   label: 'Date'   },
  { field: 'source', label: 'Source' },
  { field: 'title',  label: 'Title'  },
];

function applySort(topics: Topic[], sort: SortState): Topic[] {
  return [...topics].sort((a, b) => {
    let cmp = 0;
    if      (sort.field === 'score')  cmp = (a.score ?? 0) - (b.score ?? 0);
    else if (sort.field === 'date')   cmp = (a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : 0) - (b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : 0);
    else if (sort.field === 'source') cmp = (a.sources?.[0] ?? '').localeCompare(b.sources?.[0] ?? '');
    else if (sort.field === 'title')  cmp = a.title.localeCompare(b.title);
    return sort.dir === 'desc' ? -cmp : cmp;
  });
}

// ─── Filter state ──────────────────────────────────────────────────────────────
type FilterState = {
  sources:   string[];          // [] = all
  scoreMin:  number;            // 0–1, 0 = no minimum
  scoreMax:  number;            // 0–1, 1 = no maximum
  formats:   SuggestedFormat[]; // [] = all formats
};

const DEFAULT_FILTER: FilterState = { sources: [], scoreMin: 0, scoreMax: 1, formats: [] };

const SOURCE_OPTIONS = [
  { value: 'reddit',             label: '🔴 Reddit'          },
  { value: 'twitter',            label: '🐦 Twitter / X'     },
  { value: 'google_news',        label: '📰 Google News'     },
  { value: 'medium',             label: '✍️ Medium'           },
  { value: 'hacker_news',        label: '🟠 Hacker News'     },
  { value: 'devto',              label: '👩‍💻 Dev.to'           },
  { value: 'substack',           label: '📧 Substack'        },
  { value: 'arxiv',              label: '🎓 arXiv'           },
  { value: 'pubmed',             label: '🔬 PubMed'          },
  { value: 'exploding_topics',   label: '🚀 Exploding Topics' },
  { value: 'product_hunt',       label: '🐱 Product Hunt'    },
  { value: 'crypto_news',        label: '₿ Crypto'           },
  { value: 'finance_newsletter', label: '💰 Finance'         },
  { value: 'youtube_trends',     label: '▶️ YouTube'          },
  { value: 'rss',                label: '📡 RSS'             },
];

const FORMAT_OPTIONS: { value: SuggestedFormat; label: string }[] = [
  { value: 'post',     label: '📄 Post'     },
  { value: 'carousel', label: '🎠 Carousel' },
  { value: 'reel',     label: '🎬 Reel'     },
];

const SCORE_PRESETS = [
  { label: 'All scores',  min: 0,    max: 1   },
  { label: 'High (≥0.7)', min: 0.70, max: 1   },
  { label: 'Mid (0.5–0.7)', min: 0.50, max: 0.70 },
  { label: 'Low (<0.5)',  min: 0,    max: 0.50 },
];

function isFiltered(f: FilterState) {
  return f.sources.length > 0 || f.scoreMin > 0 || f.scoreMax < 1 || f.formats.length > 0;
}

/**
 * Maps a topic's DB state+decision to the dashboard tab it belongs in.
 */
function resolveTab(topic: Topic): string {
  const s = topic.state;
  if (s === 'CONTENT_READY' || s === 'QA_PASSED')     return 'review';
  if (s === 'SCHEDULED')                               return 'scheduled';
  if (s === 'POSTED' || s === 'ANALYZED')              return 'posted';
  if (s === 'SCORED' && topic.decision === 'selected') return 'scored';
  if (s === 'SCORED' && topic.decision === 'backup')   return 'backup';
  return 'hidden';
}

function applyFilters(topics: Topic[], f: FilterState, search: string, tab: TabKey): Topic[] {
  return topics.filter(t => {
    if (resolveTab(t) !== tab) return false;
    // search
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    // source filter
    if (f.sources.length > 0) {
      const topicSources = (t.sources ?? []).map((s: string) => s.toLowerCase());
      const platform     = (t.platform ?? '').toLowerCase();
      const matchesSrc   = f.sources.some(src =>
        topicSources.some(ts => ts.includes(src)) || platform.includes(src)
      );
      if (!matchesSrc) return false;
    }
    // score filter
    if (t.score !== null && t.score !== undefined) {
      if (t.score < f.scoreMin || t.score > f.scoreMax) return false;
    }
    // format filter (Task 1.5)
    if (f.formats.length > 0 && t.suggestedFormat) {
      if (!f.formats.includes(t.suggestedFormat)) return false;
    }
    return true;
  });
}

function FilterDropdown({
  filter, onChange, onReset, anchorRect,
}: {
  filter: FilterState;
  onChange: (f: FilterState) => void;
  onReset: () => void;
  anchorRect: DOMRect;
}) {
  const toggleSource = (src: string) => {
    const next = filter.sources.includes(src)
      ? filter.sources.filter(s => s !== src)
      : [...filter.sources, src];
    onChange({ ...filter, sources: next });
  };

  const toggleFormat = (fmt: SuggestedFormat) => {
    const next = filter.formats.includes(fmt)
      ? filter.formats.filter(f => f !== fmt)
      : [...filter.formats, fmt];
    onChange({ ...filter, formats: next });
  };

  const setScorePreset = (min: number, max: number) => {
    onChange({ ...filter, scoreMin: min, scoreMax: max });
  };

  const activePreset = SCORE_PRESETS.find(
    p => p.min === filter.scoreMin && p.max === filter.scoreMax
  );

  const style: React.CSSProperties = {
    position: 'fixed',
    top:  anchorRect.bottom + 8,
    right: window.innerWidth - anchorRect.right,
    zIndex: 99999,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
    minWidth: 260,
    padding: '14px 16px',
  };

  return ReactDOM.createPortal(
    <div data-filter-dropdown style={style}>
      {/* Format filter (Task 1.5) */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
          letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
          Format
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {FORMAT_OPTIONS.map(opt => {
            const active = filter.formats.includes(opt.value);
            return (
              <button key={opt.value}
                onClick={() => toggleFormat(opt.value)}
                style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  background: active ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                  color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  fontWeight: active ? 600 : 400,
                  transition: 'all 0.15s',
                }}>
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Source filter */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
          letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
          Source
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {SOURCE_OPTIONS.map(opt => {
            const active = filter.sources.includes(opt.value);
            return (
              <button key={opt.value}
                onClick={() => toggleSource(opt.value)}
                style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  background: active ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                  color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  fontWeight: active ? 600 : 400,
                  transition: 'all 0.15s',
                }}>
                {opt.label}
              </button>
            );
          })}
        </div>
        {filter.sources.length === 0 && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 5 }}>
            Showing all sources
          </div>
        )}
      </div>

      {/* Score filter */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
          letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
          Score Range
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {SCORE_PRESETS.map(p => {
            const active = activePreset?.label === p.label;
            return (
              <button key={p.label}
                onClick={() => setScorePreset(p.min, p.max)}
                style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  background: active ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                  color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  fontWeight: active ? 600 : 400,
                  transition: 'all 0.15s',
                }}>
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Divider + reset */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {[
            filter.formats.length > 0 && `${filter.formats.length} format${filter.formats.length > 1 ? 's' : ''}`,
            filter.sources.length > 0 && `${filter.sources.length} source${filter.sources.length > 1 ? 's' : ''}`,
            (filter.scoreMin > 0 || filter.scoreMax < 1) && `score ${filter.scoreMin.toFixed(1)}–${filter.scoreMax.toFixed(1)}`,
          ].filter(Boolean).join(' · ') || 'No filters'}
        </span>
        <button
          onClick={onReset}
          style={{ fontSize: 11, color: 'var(--accent)', background: 'none',
            border: 'none', cursor: 'pointer', fontWeight: 600, padding: '2px 0' }}>
          Reset
        </button>
      </div>
    </div>,
    document.body
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────
export const DashboardView: React.FC<Props> = ({ page, topics, stats, busy, onOpenEditor, onRunJob }) => {
  const [pipelineStep, setPipelineStep]     = useState('review');
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [localTopics, setLocalTopics]       = useState<Topic[]>(topics);
  const [activeTab, setActiveTab]           = useState<TabKey>('scored');
  const [search, setSearch]                 = useState('');
  const [pendingDelete, setPendingDelete]   = useState<Topic | null>(null);
  const [filter, setFilter]                 = useState<FilterState>(DEFAULT_FILTER);
  const [filterOpen, setFilterOpen]         = useState(false);
  const [filterRect, setFilterRect]         = useState<DOMRect | null>(null);
  const [sort, setSort]                     = useState<SortState>(DEFAULT_SORT);
  const btnRef                              = useRef<HTMLButtonElement>(null);

  // Sync localTopics when parent topics prop changes
  React.useEffect(() => { setLocalTopics(topics); }, [topics]);

  // Close filter dropdown on outside click.
  // Must exclude BOTH the trigger button wrapper AND the portal content
  // (portal renders on document.body so is outside [data-filter-root]).
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const insideTrigger  = (e.target as Element).closest?.('[data-filter-root]');
      const insideDropdown = (e.target as Element).closest?.('[data-filter-dropdown]');
      if (!insideTrigger && !insideDropdown) {
        setFilterOpen(false);
      }
    };
    if (filterOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [filterOpen]);

  const toggle = (id: string) => setSelectedTopics(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const requestDiscard = (id: string) => {
    const topic = localTopics.find(t => t.id === id);
    if (topic) setPendingDelete(topic);
  };

  const confirmDiscard = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    setLocalTopics(prev => prev.filter(t => t.id !== id));
    setSelectedTopics(s => { const n = new Set(s); n.delete(id); return n; });
    try { await api.rejectContent(id); } catch {}
  };

  const filtered = applySort(applyFilters(localTopics, filter, search, activeTab), sort);

  // Tab counts respect source/score filter but not search (so counts stay stable while typing)
  const tabCounts = Object.fromEntries(
    TABS.map(tab => [
      tab.key,
      applyFilters(localTopics, filter, '', tab.key).length,
    ])
  );

  const pipelineCounts = {
    ingest:   stats.topics,
    score:    stats.selected_topics,
    generate: stats.qa_ready,
    review:   stats.approved,
    schedule: stats.scheduled,
  };

  const hasFilter = isFiltered(filter);

  return (
    <>
    <div style={{ display:'flex', flex:1, overflow:'hidden', minHeight:0 }}>
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* Topbar */}
        <div className="topbar">
          <div style={{ width:8, height:8, borderRadius:'50%', background:page.accent }}/>
          <div>
            <div className="topbar-title">{page.name}</div>
            <div className="topbar-sub">{page.niche} · {page.followers} followers</div>
          </div>
          <div className="topbar-right">
            <div className="search-wrap">
              <span className="search-icon"><Icon name="search" size={12}/></span>
              <input type="text" className="search-input" placeholder="Search topics… ⌘K"
                value={search} onChange={e => setSearch(e.target.value)}/>
            </div>

            {/* Filter button + dropdown portal */}
            <div data-filter-root style={{ position:'relative' }}>
              <button
                ref={btnRef}
                className={`btn btn-sm ${hasFilter ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => {
                  if (btnRef.current) setFilterRect(btnRef.current.getBoundingClientRect());
                  setFilterOpen(o => !o);
                }}
              >
                <Icon name="filter" size={12}/>
                Filter
                {hasFilter && (
                  <span style={{
                    marginLeft: 4, fontSize: 10, fontWeight: 700,
                    background: 'rgba(255,255,255,0.25)', borderRadius: 10,
                    padding: '1px 6px',
                  }}>
                    {filter.sources.length + filter.formats.length + (filter.scoreMin > 0 || filter.scoreMax < 1 ? 1 : 0)}
                  </span>
                )}
              </button>

              {filterOpen && filterRect && (
                <FilterDropdown
                  filter={filter}
                  onChange={setFilter}
                  onReset={() => setFilter(DEFAULT_FILTER)}
                  anchorRect={filterRect}
                />
              )}
            </div>

            <button className="btn btn-primary btn-sm" disabled={!!busy}
              onClick={() => onRunJob('ingest')}>
              <Icon name="send" size={12}/> Run Pipeline
            </button>
          </div>
        </div>

        {/* Content area */}
        <div className="view-area">
          <MetricCards stats={stats}/>

          <div style={{ marginBottom:16 }}>
            <div className="section-label" style={{ marginBottom:8 }}>Pipeline</div>
            <PipelineBar
              activeStep={pipelineStep}
              setActiveStep={setPipelineStep}
              counts={pipelineCounts}
              busy={busy}
              onRunJob={onRunJob}
            />
          </div>

          {/* Bulk action bar */}
          {selectedTopics.size > 0 && (
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px',
              background:'var(--accent-dim)', border:'1px solid var(--accent)',
              borderRadius:'var(--radius-sm)', marginBottom:12 }}>
              <span style={{ fontSize:13, fontWeight:500, color:'var(--accent)' }}>
                {selectedTopics.size} selected
              </span>
              <button className="btn btn-sm btn-primary">Approve All</button>
              <button className="btn btn-sm btn-surface">Schedule</button>
              <button className="btn btn-sm btn-ghost" style={{ marginLeft:'auto' }}
                onClick={() => setSelectedTopics(new Set())}>Clear</button>
            </div>
          )}

          {/* Active filter summary bar */}
          {hasFilter && (
            <div style={{
              display:'flex', alignItems:'center', gap:8, padding:'6px 12px',
              background:'var(--accent-dim)', border:'1px solid var(--accent)',
              borderRadius:'var(--radius-sm)', marginBottom:10, fontSize:11,
            }}>
              <span style={{ color:'var(--accent)', fontWeight:600 }}>Filters active:</span>
              {filter.sources.length > 0 && (
                <span style={{ color:'var(--text-secondary)' }}>
                  Source: {filter.sources.join(', ')}
                </span>
              )}
              {(filter.scoreMin > 0 || filter.scoreMax < 1) && (
                <span style={{ color:'var(--text-secondary)' }}>
                  Score: {filter.scoreMin.toFixed(1)}–{filter.scoreMax.toFixed(1)}
                </span>
              )}
              <button
                onClick={() => setFilter(DEFAULT_FILTER)}
                style={{ marginLeft:'auto', fontSize:11, color:'var(--accent)',
                  background:'none', border:'none', cursor:'pointer', fontWeight:600 }}>
                Clear filters ×
              </button>
            </div>
          )}

          {/* Tabs */}
          <div className="tabs">
            {TABS.map(t => {
              const count = tabCounts[t.key] ?? 0;
              return (
                <div key={t.key}
                  className={`tab-item ${activeTab === t.key ? 'active' : ''}`}
                  onClick={() => setActiveTab(t.key)}
                  title={t.desc}
                  style={{ opacity: count === 0 ? 0.45 : 1 }}>
                  {t.icon} {t.label}
                  <span className="tab-count" style={{
                    background: activeTab === t.key ? 'var(--accent)' : 'var(--bg-hover)',
                    color:      activeTab === t.key ? '#fff' : 'var(--text-muted)',
                  }}>
                    {count}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Tab context hints */}
          {activeTab === 'scored' && (
            <div style={{ fontSize:11, color:'var(--text-muted)', padding:'8px 2px',
              display:'flex', alignItems:'center', gap:6 }}>
              ⭐ These topics passed scoring. Click <strong>✏️ Edit</strong> to open the Content Editor and generate a post, carousel or reel.
            </div>
          )}
          {activeTab === 'backup' && (
            <div style={{ fontSize:11, color:'var(--text-muted)', padding:'8px 2px',
              display:'flex', alignItems:'center', gap:6 }}>
              🔄 Backup topics scored below 0.50 but above 0.35. Use these when selected topics run dry.
            </div>
          )}
          {activeTab === 'review' && (
            <div style={{ fontSize:11, color:'var(--text-muted)', padding:'8px 2px',
              display:'flex', alignItems:'center', gap:6 }}>
              📝 Content is ready for your review.
              Click <strong>Edit</strong> on any card — the editor will open on the correct
              <strong> Post / Carousel / Reel</strong> tab based on the AI-suggested format.
            </div>
          )}

          {/* Sort control */}
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4, marginTop:6, justifyContent:'flex-end' }}>
            <span style={{ fontSize:10, color:'var(--text-muted)', fontWeight:600,
              textTransform:'uppercase', letterSpacing:'0.06em', flexShrink:0 }}>
              Sort:
            </span>
            {SORT_OPTIONS.map(opt => {
              const active = sort.field === opt.field;
              return (
                <button
                  key={opt.field}
                  onClick={() => setSort(s =>
                    s.field === opt.field
                      ? { ...s, dir: s.dir === 'desc' ? 'asc' : 'desc' }
                      : { field: opt.field, dir: opt.field === 'title' || opt.field === 'source' ? 'asc' : 'desc' }
                  )}
                  style={{
                    fontSize: 11, padding: '3px 9px', borderRadius: 20, cursor: 'pointer',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    background: active ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                    color: active ? 'var(--accent)' : 'var(--text-secondary)',
                    fontWeight: active ? 700 : 400,
                    display: 'flex', alignItems: 'center', gap: 3,
                    transition: 'all 0.15s',
                  }}
                >
                  {opt.label}
                  {active && (
                    <span style={{ fontSize: 10 }}>{sort.dir === 'desc' ? '↓' : '↑'}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Topic list */}
          <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:8 }} className="stagger">
            {filtered.length > 0
              ? filtered.map(topic => (
                <TopicCard key={topic.id} topic={topic} pageId={page.id}
                  selected={selectedTopics.has(topic.id)}
                  onSelect={toggle} onEdit={onOpenEditor}
                  onDiscard={requestDiscard}
                  onFormatChange={async (id, fmt) => {
                    // Optimistic update
                    setLocalTopics(prev => prev.map(t =>
                      t.id === id ? { ...t, suggestedFormat: fmt, formatConfidence: 'user' } : t
                    ));
                    try {
                      await api.patch(`/api/topics/${id}/format`, {
                        suggested_format: fmt,
                        format_confidence: 'user',
                      });
                    } catch {
                      // revert on failure
                      setLocalTopics(topics);
                    }
                  }}
                />
              ))
              : (
                <div className="empty-state">
                  <div style={{ fontSize:28, opacity:0.3 }}>◉</div>
                  <div style={{ fontWeight:600 }}>
                    {hasFilter ? 'No topics match the current filters' : `No ${activeTab} topics`}
                  </div>
                  <div style={{ fontSize:12, color:'var(--text-muted)' }}>
                    {hasFilter
                      ? <button onClick={() => setFilter(DEFAULT_FILTER)}
                          style={{ color:'var(--accent)', background:'none', border:'none',
                            cursor:'pointer', fontSize:12, fontWeight:600 }}>
                          Clear filters to see all topics
                        </button>
                      : 'Topics will appear here after pipeline processing'
                    }
                  </div>
                </div>
              )
            }
          </div>
        </div>
      </div>

      <TopicSourcePanel/>
    </div>

    {pendingDelete && (
      <ConfirmModal
        title="Discard Topic?"
        message={`"${pendingDelete.title}" will be removed from the queue and marked as rejected. This cannot be undone.`}
        confirmLabel="Yes, Discard"
        onConfirm={confirmDiscard}
        onCancel={() => setPendingDelete(null)}
      />
    )}
    </>
  );
};
