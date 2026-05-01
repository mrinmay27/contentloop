import React from 'react';
import type { Stats } from '../../lib/types';

const METRIC_CONFIG = [
  { key: 'topics',          label: 'Topics',    deltaKey: '+124 today', color: 'var(--blue)'   },
  { key: 'selected_topics', label: 'Selected',  deltaKey: '+18 today',  color: 'var(--purple)' },
  { key: 'qa_ready',        label: 'QA Ready',  deltaKey: '+8 today',   color: 'var(--accent)' },
  { key: 'approved',        label: 'Approved',  deltaKey: '+5 today',   color: 'var(--green)'  },
  { key: 'scheduled',       label: 'Scheduled', deltaKey: 'Next: 5pm',  color: 'var(--accent)' },
  { key: 'posted',          label: 'Posted',    deltaKey: '+3 today',   color: 'var(--green)'  },
] as const;

export const MetricCards: React.FC<{ stats: Stats }> = ({ stats }) => (
  <div className="metrics-grid stagger">
    {METRIC_CONFIG.map(({ key, label, deltaKey, color }) => (
      <div key={key} className="metric-card" style={{ borderTop: `2px solid ${color}22` }}>
        <div className="metric-label">{label}</div>
        <div className="metric-value" style={{ color }}>
          {(stats[key as keyof Stats] ?? 0).toLocaleString()}
        </div>
        <div className="metric-delta">{deltaKey}</div>
      </div>
    ))}
  </div>
);
