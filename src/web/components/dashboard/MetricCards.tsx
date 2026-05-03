import React from 'react';
import type { Stats } from '../../lib/types';

function fmtDelta(n: number): string {
  return n > 0 ? `+${n} today` : n < 0 ? `${n} today` : '—';
}

function fmtNextPost(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  if (diffMs < 0) return 'overdue';
  const diffH = Math.floor(diffMs / 36e5);
  const diffM = Math.floor((diffMs % 36e5) / 60000);
  if (diffH === 0) return `in ${diffM}m`;
  if (diffH < 24) {
    const hStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `Next: ${hStr}`;
  }
  return `Next: ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

export const MetricCards: React.FC<{ stats: Stats }> = ({ stats }) => {
  const cards = [
    { key: 'topics',          label: 'Topics',    delta: fmtDelta(stats.topics_today),    color: 'var(--blue)'   },
    { key: 'selected_topics', label: 'Selected',  delta: fmtDelta(stats.selected_today),  color: 'var(--purple)' },
    { key: 'qa_ready',        label: 'QA Ready',  delta: fmtDelta(stats.qa_ready_today),  color: 'var(--accent)' },
    { key: 'approved',        label: 'Approved',  delta: fmtDelta(stats.approved_today),  color: 'var(--green)'  },
    { key: 'scheduled',       label: 'Scheduled', delta: fmtNextPost(stats.next_post_at), color: 'var(--accent)' },
    { key: 'posted',          label: 'Posted',    delta: fmtDelta(stats.posted_today),    color: 'var(--green)'  },
  ] as const;

  return (
    <div className="metrics-grid stagger">
      {cards.map(({ key, label, delta, color }) => (
        <div key={key} className="metric-card" style={{ borderTop: `2px solid ${color}22` }}>
          <div className="metric-label">{label}</div>
          <div className="metric-value" style={{ color }}>
            {(stats[key as keyof Stats] as number ?? 0).toLocaleString()}
          </div>
          <div className="metric-delta">{delta}</div>
        </div>
      ))}
    </div>
  );
};
