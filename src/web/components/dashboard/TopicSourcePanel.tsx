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

const ALL_SOURCES = [
  { key: 'reddit',             label: 'Reddit'        },
  { key: 'twitter',            label: 'Twitter/X'     },
  { key: 'google_news',        label: 'Google News'   },
  { key: 'medium',             label: 'Medium'        },
  { key: 'hacker_news',        label: 'HN'            },
  { key: 'devto',              label: 'Dev.to'        },
  { key: 'substack',           label: 'Substack'      },
  { key: 'arxiv',              label: 'arXiv'         },
  { key: 'pubmed',             label: 'PubMed'        },
  { key: 'exploding_topics',   label: 'Exploding'     },
  { key: 'product_hunt',       label: 'Product Hunt'  },
  { key: 'crypto_news',        label: 'Crypto'        },
  { key: 'finance_newsletter', label: 'Finance'       },
  { key: 'youtube_trends',     label: 'YouTube'       },
  { key: 'rss',                label: 'RSS'           },
];

function topicSource(t: Topic): string {
  const first = (t.sources?.[0] ?? '').toLowerCase();
  if (first.includes('reddit'))  return 'reddit';
  if (first.includes('twitter') || first.includes('x.com')) return 'twitter';
  if (first === 'trends' || first === 'google_trends') return 'google_trends';
  return first || 'rss';
}

export const TopicSourcePanel: React.FC = () => {
  const [filter,   setFilter]   = useState<string>('All');
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


  const shown = filter === 'All'
    ? topics
    : topics.filter(t => topicSource(t) === filter);

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
      <div className="source-filter" style={{ flexWrap: 'wrap' }}>
        <button className={`source-chip ${filter === 'All' ? 'active' : ''}`}
          onClick={() => setFilter('All')}>All</button>
        {ALL_SOURCES.map(s => (
          <button key={s.key} className={`source-chip ${filter === s.key ? 'active' : ''}`}
            onClick={() => setFilter(s.key)}>
            {s.label}
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
          const platform = topicSource(item);
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
