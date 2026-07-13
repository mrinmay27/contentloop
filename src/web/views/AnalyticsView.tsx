import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { ThemePage } from '../lib/types';

type Post = {
  id: string;
  topic_title: string;
  type: string;
  posted_at: string | null;
  views: number;
  saves: number;
  engagement_rate: number;
};

type ByType = {
  type: string;
  total: number;
  avg_engagement: number;
};

type AnalyticsData = { posts: Post[]; byType: ByType[]; simulated?: boolean };
type LearningData = {
  keywords: Array<{ label: string; score: number; sample_size: number }>;
  formats: Array<{ label: string; score: number; sample_size: number }>;
  mode: 'real' | 'simulated';
};

const TYPE_COLOR: Record<string, string> = {
  carousel: 'var(--accent)',
  reel:     'var(--blue)',
  post:     'var(--green)',
};

function fmt(n: number): string {
  if (n >= 1_000_000) return (n/1_000_000).toFixed(1)+'M';
  if (n >= 1_000)     return (n/1_000).toFixed(1)+'K';
  return String(n);
}

const PERIODS = ['7d','30d','90d','All'] as const;
type Period = typeof PERIODS[number];

function filterByPeriod(posts: Post[], period: Period): Post[] {
  if (period === 'All') return posts;
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const cutoff = new Date(Date.now() - days * 86_400_000);
  return posts.filter(p => p.posted_at && new Date(p.posted_at) >= cutoff);
}

export const AnalyticsView: React.FC<{ page: ThemePage }> = ({ page }) => {
  const [data, setData]       = useState<AnalyticsData | null>(null);
  const [learning, setLearning] = useState<LearningData | null>(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod]   = useState<Period>('30d');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getAnalytics(page.id)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    api.getLearning(page.id)
      .then(l => { if (!cancelled) setLearning(l); })
      .catch(() => { if (!cancelled) setLearning(null); });
    return () => { cancelled = true; };
  }, [page.id]);

  const filtered = data ? filterByPeriod(data.posts, period) : [];

  // KPI aggregates
  const totalViews  = filtered.reduce((s, p) => s + p.views, 0);
  const totalSaves  = filtered.reduce((s, p) => s + p.saves, 0);
  const avgEng      = filtered.length
    ? filtered.reduce((s, p) => s + p.engagement_rate, 0) / filtered.length
    : 0;
  const totalPosts  = filtered.length;

  // Bar chart — last 20 posts, views normalised
  const chartPosts = filtered.slice(0, 20).reverse();
  const maxViews   = Math.max(...chartPosts.map(p => p.views), 1);
  const maxSaves   = Math.max(...chartPosts.map(p => p.saves), 1);

  // Top posts by views
  const topPosts = [...filtered]
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);

  // Type breakdown from API (all-time, not filtered by period)
  const byType = data?.byType ?? [];
  const maxEngagement = Math.max(...byType.map(t => Number(t.avg_engagement)), 0.001);

  const KPIs = [
    { label: 'Total Views',   value: fmt(totalViews), color: 'var(--blue)'   },
    { label: 'Total Saves',   value: fmt(totalSaves), color: 'var(--green)'  },
    { label: 'Posts Analyzed',value: String(totalPosts), color: 'var(--accent)'},
    { label: 'Avg Eng. Rate', value: (avgEng * 100).toFixed(1)+'%', color: 'var(--purple)' },
  ];

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div className="topbar">
        <span className="topbar-title">Analytics</span>
        <div style={{ display:'flex', alignItems:'center', gap:6, marginLeft:8 }}>
          <div style={{ width:7, height:7, borderRadius:'50%', background:page.accent }}/>
          <span style={{ fontSize:12, color:'var(--text-muted)' }}>{page.name}</span>
        </div>
        <div className="topbar-right">
          {PERIODS.map(p => (
            <button key={p} className={`btn btn-sm ${p===period?'btn-surface':'btn-ghost'}`}
              style={{ padding:'4px 10px' }} onClick={() => setPeriod(p)}>{p}</button>
          ))}
        </div>
      </div>

      <div className="view-area">
        {loading && (
          <div style={{ textAlign:'center', padding:32, color:'var(--text-muted)', fontSize:13 }}>
            Loading analytics…
          </div>
        )}

        {!loading && !data && (
          <div className="empty-state">
            <div style={{ fontSize:28, opacity:0.3 }}>📊</div>
            <div style={{ fontWeight:600 }}>No analytics data yet</div>
            <div style={{ fontSize:12, color:'var(--text-muted)' }}>
              Posts will appear here after they are published and analyzed
            </div>
          </div>
        )}

        {!loading && data && (
          <>
            {/* KPI row */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}
              className="stagger">
              {KPIs.map(k => (
                <div key={k.label} className="metric-card" style={{ borderTop:`2px solid ${k.color}44` }}>
                  <div className="metric-label">{k.label}</div>
                  <div className="metric-value" style={{ fontSize:22, color:k.color }}>{k.value}</div>
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>
                    {period} window
                  </div>
                </div>
              ))}
            </div>

            {data.simulated && (
              <div style={{ marginBottom: 16, padding: '8px 12px', borderRadius: 8,
                background: 'var(--bg-elevated)', border: '1px dashed var(--text-muted)',
                fontSize: 12, color: 'var(--text-secondary)' }}>
                ⚗️ Simulated metrics — Instagram is in dry-run mode. Real insights replace
                these automatically once publishing goes live.
              </div>
            )}

            <div className="analytics-grid">
              {/* Bar chart — views per post */}
              <div className="analytics-card" style={{ gridColumn:'span 2' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                  <div style={{ fontWeight:700, fontSize:14 }}>Views Per Post</div>
                  <div style={{ display:'flex', gap:12, alignItems:'center' }}>
                    <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                      <div style={{ width:10,height:3,borderRadius:2,background:'var(--accent)' }}/>
                      <span style={{ fontSize:11,color:'var(--text-secondary)' }}>Views</span>
                    </div>
                    <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                      <div style={{ width:10,height:3,borderRadius:2,background:'var(--green)' }}/>
                      <span style={{ fontSize:11,color:'var(--text-secondary)' }}>Saves</span>
                    </div>
                  </div>
                </div>
                {chartPosts.length === 0 ? (
                  <div style={{ height:120, display:'flex', alignItems:'center', justifyContent:'center',
                    color:'var(--text-muted)', fontSize:12 }}>
                    No posts in this period
                  </div>
                ) : (
                  <>
                    <div style={{ display:'flex', alignItems:'flex-end', gap:4, height:120, marginBottom:8 }}>
                      {chartPosts.map((p, i) => (
                        <div key={p.id} style={{ flex:1, display:'flex', flexDirection:'column',
                          alignItems:'center', height:'100%', justifyContent:'flex-end', gap:1 }}>
                          <div style={{ width:'100%', borderRadius:'3px 3px 0 0',
                            background:'var(--accent)', opacity:0.85,
                            height:`${(p.views/maxViews)*100}%`, minHeight:2,
                            transition:'height 0.5s ease', cursor:'pointer' }}
                            title={`${p.topic_title.substring(0,40)}: ${fmt(p.views)} views`}/>
                          <div style={{ width:'100%', borderRadius:'3px 3px 0 0',
                            background:'var(--green)',
                            height:`${(p.saves/maxSaves)*30}%`, minHeight:1 }}/>
                        </div>
                      ))}
                    </div>
                    <div style={{ display:'flex', gap:4 }}>
                      {chartPosts.map((p, i) => (
                        <div key={i} style={{ flex:1, textAlign:'center', fontSize:9,
                          color:'var(--text-muted)', fontFamily:'var(--mono)',
                          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {p.posted_at ? new Date(p.posted_at).getDate() : '—'}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Content type performance */}
              <div className="analytics-card">
                <div style={{ fontWeight:700, fontSize:14, marginBottom:16 }}>Content Type Performance</div>
                {byType.length === 0 ? (
                  <div style={{ color:'var(--text-muted)', fontSize:12 }}>No data yet</div>
                ) : (
                  byType.map(item => {
                    const pct = Math.round((Number(item.avg_engagement) / maxEngagement) * 100);
                    const color = TYPE_COLOR[item.type] ?? 'var(--accent)';
                    return (
                      <div key={item.type} className="perf-row">
                        <div style={{ width:76, fontSize:12, color:'var(--text-secondary)',
                          flexShrink:0, textTransform:'capitalize' }}>{item.type}</div>
                        <div className="perf-bar">
                          <div className="perf-fill" style={{ width:`${pct}%`, background:color }}/>
                        </div>
                        <div style={{ width:48, textAlign:'right', fontSize:11,
                          fontFamily:'var(--mono)', color:'var(--text-primary)' }}>
                          {(Number(item.avg_engagement)*100).toFixed(1)}%
                        </div>
                        <div style={{ width:24, textAlign:'right', fontSize:10,
                          color:'var(--text-muted)' }}>×{item.total}</div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Learning signals */}
              <div className="analytics-card">
                <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>Learning Signals</div>
                <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:12 }}>
                  {learning?.mode === 'real' ? 'From real Instagram data' : 'From simulated data'}
                </div>
                {!learning || learning.keywords.length === 0 ? (
                  <div style={{ color:'var(--text-muted)', fontSize:12 }}>
                    No signals yet — appears after posts collect 24h metrics
                  </div>
                ) : (
                  (() => {
                    const maxScore = Math.max(...learning.keywords.map(x => x.score), 0.001);
                    return learning.keywords.map(k => (
                      <div key={k.label} className="perf-row">
                        <div style={{ width:90, fontSize:12, color:'var(--text-secondary)',
                          flexShrink:0, overflow:'hidden', textOverflow:'ellipsis',
                          whiteSpace:'nowrap' }}>{k.label}</div>
                        <div className="perf-bar">
                          <div className="perf-fill"
                            style={{ width:`${Math.round((k.score/maxScore)*100)}%`, background:'var(--purple)' }}/>
                        </div>
                        <div style={{ width:48, textAlign:'right', fontSize:11,
                          fontFamily:'var(--mono)' }}>{(k.score*100).toFixed(1)}%</div>
                        <div style={{ width:24, textAlign:'right', fontSize:10,
                          color:'var(--text-muted)' }}>×{k.sample_size}</div>
                      </div>
                    ));
                  })()
                )}
              </div>

              {/* Top posts */}
              <div className="analytics-card" style={{ gridColumn:'span 2' }}>
                <div style={{ fontWeight:700, fontSize:14, marginBottom:16 }}>Top Posts by Views</div>
                {topPosts.length === 0 ? (
                  <div style={{ color:'var(--text-muted)', fontSize:12 }}>No posts in this period</div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                    {topPosts.map((post, i) => (
                      <div key={post.id} style={{ display:'flex', gap:10, alignItems:'center' }}>
                        <div style={{ width:20,height:20,borderRadius:4,
                          background:'var(--bg-elevated)',display:'flex',alignItems:'center',
                          justifyContent:'center',fontSize:10,fontFamily:'var(--mono)',
                          color:'var(--text-muted)',flexShrink:0 }}>{i+1}</div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:12, fontWeight:500, overflow:'hidden',
                            textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {post.topic_title}
                          </div>
                          <div style={{ fontSize:10, color:'var(--text-muted)',
                            display:'flex', gap:8, marginTop:2, fontFamily:'var(--mono)' }}>
                            <span>{fmt(post.views)} views</span>
                            <span>{fmt(post.saves)} saves</span>
                            <span>{(post.engagement_rate*100).toFixed(1)}% eng</span>
                          </div>
                        </div>
                        <span className="badge badge-muted"
                          style={{ flexShrink:0, fontFamily:'var(--mono)', textTransform:'capitalize' }}>
                          {post.type}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
