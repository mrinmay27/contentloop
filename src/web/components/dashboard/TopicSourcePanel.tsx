/**
 * TopicSourcePanel — right sidebar showing the latest SELECTED/BACKUP topics
 * from the real database, grouped by source.
 *
 * Refresh button re-fetches live data.
 * Score ring shows the actual score from the DB (0–100).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Icon } from '../ui/Icon';
import { ScoreRing, PlatformBadge } from '../ui/Badges';
import { api } from '../../lib/api';
import type { Topic } from '../../lib/types';

const SOURCE_FILTER = ['All', 'Reddit', 'Twitter/X', 'Google Trends', 'RSS'] as const;
type SourceFilter = typeof SOURCE_FILTER[number];

const PLATFORM_MAP: Record<string, string> = {
  reddit: 'Reddit', twitter: 'Twitter/X', trends: 'Google Trends', rss: 'RSS',
  'Google Trends': 'Google Trends', 'Twitter/X': 'Twitter/X',
};

function topicPlatform(t: Topic): string {
  // sources is string[] of source names like ['reddit'], ['Google Trends']
  const first = (t.sources?.[0] ?? '').toLowerCase();
  if (first.includes('reddit'))  return 'reddit';
  if (first.includes('twitter') || first.includes('x.com')) return 'twitter';
  if (first.includes('trend'))   return 'trends';
  return 'rss';
}

export const TopicSourcePanel: React.FC = () => {
  const [filter,   setFilter]   = useState<SourceFilter>('All');
  const [topics,   setTopics]   = useState<Topic[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [spinning, setSpinning] = useState(false);

  const load = useCallback(async (spin = false) => {
    if (spin) setSpinning(true);
    setLoading(true);
    try {
      // Fetch all topics, then keep only scored ones with a decision
      const all: Topic[] = await api.getTopics();
      const scored = all
        .filter(t => t.decision === 'selected' || t.decision === 'backup')
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 30);
      setTopics(scored);
    } catch { /* fail silently */ }
    finally { setLoading(false); setSpinning(false); }
  }, []);

  useEffect(() => { load(); }, [load]);


  // Simpler filter
  const shown = filter === 'All'
    ? topics
    : topics.filter(t => {
        const p = topicPlatform(t);
        return (
          (filter === 'Reddit'       && p === 'reddit')  ||
          (filter === 'Twitter/X'    && p === 'twitter') ||
          (filter === 'Google Trends'&& p === 'trends')  ||
          (filter === 'RSS'          && p === 'rss')
        );
      });

  return (
    <div className="right-panel">
      <div className="panel-header">
        <span style={{ fontSize:12, fontWeight:700, textTransform:'uppercase',
          letterSpacing:'0.08em', color:'var(--text-muted)' }}>
          Recent Topics
        </span>
        <button
          className="btn btn-sm btn-surface"
          onClick={() => load(true)}
          disabled={spinning}
          style={{ display:'flex', alignItems:'center', gap:4 }}
        >
          <span style={{ display:'inline-block', animation: spinning ? 'spin 0.8s linear infinite' : 'none' }}>
            <Icon name="refresh" size={11}/>
          </span>
          Refresh
        </button>
      </div>

      {/* Source filter chips */}
      <div className="source-filter">
        {SOURCE_FILTER.map(s => (
          <button key={s} className={`source-chip ${filter === s ? 'active' : ''}`}
            onClick={() => setFilter(s)}>
            {s === 'All' ? 'All' : s}
          </button>
        ))}
      </div>

      <div className="panel-body stagger" style={{ paddingTop:10 }}>
        {loading ? (
          <div style={{ color:'var(--text-muted)', fontSize:12, padding:'16px 0', textAlign:'center' }}>
            Loading…
          </div>
        ) : shown.length === 0 ? (
          <div style={{ color:'var(--text-muted)', fontSize:12, padding:'20px 0', textAlign:'center' }}>
            <div style={{ fontSize:22, marginBottom:6 }}>📭</div>
            {filter === 'All'
              ? 'No scored topics yet. Run the Score stage.'
              : `No ${filter} topics scored yet.`
            }
          </div>
        ) : shown.map(item => {
          const score100 = Math.round((item.score ?? 0) * 100);
          const platform = topicPlatform(item);
          const isBackup = item.decision === 'backup';
          return (
            <div key={item.id} className="source-card">
              <div className="source-card-title" style={{ opacity: isBackup ? 0.75 : 1 }}>
                {item.title}
                {isBackup && (
                  <span style={{ fontSize:9, marginLeft:4, color:'var(--text-muted)', fontWeight:600 }}>
                    backup
                  </span>
                )}
              </div>
              <div className="source-card-meta">
                <PlatformBadge platform={platform}/>
                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <ScoreRing score={score100} size={24}/>
                  {/* No action buttons — topics are managed from the main panel */}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
