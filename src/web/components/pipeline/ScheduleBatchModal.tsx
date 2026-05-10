import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import type { Topic, ThemePage, PublishPlatformInfo } from '../../lib/types';

type Props = {
  topics: Topic[];
  page: ThemePage;
  onScheduled: () => void;
  onClose: () => void;
};

const SPACING_OPTIONS = [
  { label: '30 min',  minutes: 30 },
  { label: '1 hour',  minutes: 60 },
  { label: '2 hours', minutes: 120 },
  { label: '4 hours', minutes: 240 },
  { label: '8 hours', minutes: 480 },
  { label: '1 day',   minutes: 1440 },
];

function roundUpToNextHour(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.toISOString().slice(0, 16);
}

export const ScheduleBatchModal: React.FC<Props> = ({ topics, page, onScheduled, onClose }) => {
  const [platforms,    setPlatforms]    = useState<Record<string, PublishPlatformInfo>>({});
  const [selected,     setSelected]     = useState<Set<string>>(new Set(['instagram']));
  const [startTime,    setStartTime]    = useState(roundUpToNextHour());
  const [spacingMins,  setSpacingMins]  = useState(60);
  const [previews,     setPreviews]     = useState<Record<string, { id: string; type: string } | null>>({});
  const [loading,      setLoading]      = useState(false);
  const [scheduling,   setScheduling]   = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  // Load connected platforms + content IDs for each topic
  useEffect(() => {
    api.getPublishPlatforms(page.id)
      .then(({ platforms: p }) => setPlatforms(p))
      .catch(() => {});

    setLoading(true);
    Promise.all(
      topics.map(t =>
        api.getTopicPreview(t.id, page.id)
          .then(({ preview }) => [t.id, preview ? { id: preview.id, type: preview.type } : null] as const)
          .catch(() => [t.id, null] as const)
      )
    ).then(entries => {
      setPreviews(Object.fromEntries(entries));
      setLoading(false);
    });
  }, [page.id, topics]);

  const togglePlatform = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // Build scheduled times: startTime + (index * spacingMins) per topic × per platform
  const scheduleSlots = topics.map((t, i) => {
    const d = new Date(startTime);
    d.setMinutes(d.getMinutes() + i * spacingMins);
    return { topic: t, scheduledAt: d.toISOString() };
  });

  const connectedPlatforms = Object.entries(platforms).filter(([, info]) => info.connected);

  const startInPast = startTime && new Date(startTime) <= new Date();
  const canSchedule = selected.size > 0 && startTime && !startInPast && topics.length > 0 && !loading;

  const handleSchedule = async () => {
    setScheduling(true);
    setError(null);
    try {
      if (!startTime || new Date(startTime) <= new Date()) {
        throw new Error('Start time must be in the future');
      }
      const jobs: Array<{ contentItemId: string; pageId: string; platform: string; scheduledAt: string }> = [];
      for (const { topic, scheduledAt } of scheduleSlots) {
        const preview = previews[topic.id];
        if (!preview) continue;
        for (const platform of [...selected]) {
          jobs.push({ contentItemId: preview.id, pageId: page.id, platform, scheduledAt });
        }
      }
      if (jobs.length === 0) throw new Error('No content ready to schedule — make sure topics have generated content');
      await api.scheduleBatch(jobs);
      onScheduled();
    } catch (err: any) {
      setError(err?.message ?? 'Scheduling failed');
    } finally {
      setScheduling(false);
    }
  };

  const totalJobs = scheduleSlots.filter(s => previews[s.topic.id]).length * selected.size;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border-strong)',
        borderRadius: 16, width: 520, maxWidth: '95vw', maxHeight: '85vh',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: 'var(--shadow-lg)',
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
              📅 Schedule {topics.length} Post{topics.length !== 1 ? 's' : ''}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Slots are spaced automatically from your chosen start time
            </div>
          </div>
          <button className="btn-icon" onClick={onClose} style={{ fontSize: 16 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Platform selector */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Publish to
            </div>
            {connectedPlatforms.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                No platforms connected — go to Settings to connect Instagram or others.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {connectedPlatforms.map(([key, info]) => {
                  const on = selected.has(key);
                  return (
                    <button key={key} onClick={() => togglePlatform(key)} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 12px', borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                      background: on ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                      color: on ? 'var(--accent)' : 'var(--text-secondary)',
                      fontSize: 12, fontWeight: on ? 700 : 400, cursor: 'pointer',
                    }}>
                      <span>{info.icon}</span> {info.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Timing */}
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                First post at
              </div>
              <input type="datetime-local" value={startTime}
                onChange={e => setStartTime(e.target.value)}
                min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                style={{
                  width: '100%', fontSize: 12, boxSizing: 'border-box',
                  borderColor: startInPast ? 'var(--red, #ef4444)' : undefined,
                }}
              />
              {startInPast && (
                <div style={{ fontSize: 10, color: 'var(--red, #ef4444)', marginTop: 4 }}>
                  ⚠ Must be a future time
                </div>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Spacing between posts
              </div>
              <select value={spacingMins} onChange={e => setSpacingMins(Number(e.target.value))}
                style={{ width: '100%', fontSize: 12, padding: '5px 8px', boxSizing: 'border-box' }}>
                {SPACING_OPTIONS.map(o => (
                  <option key={o.minutes} value={o.minutes}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Topic list with computed slots */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Schedule preview
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {scheduleSlots.map(({ topic, scheduledAt }, i) => {
                const preview = previews[topic.id];
                const hasContent = !!preview;
                const dt = new Date(scheduledAt);
                return (
                  <div key={topic.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                    background: hasContent ? 'var(--bg-elevated)' : 'var(--bg-hover)',
                    border: `1px solid ${hasContent ? 'var(--border)' : 'var(--red, #ef4444)'}`,
                    opacity: loading ? 0.5 : 1,
                  }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)',
                      minWidth: 18, textAlign: 'right' }}>
                      {i + 1}.
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                        {topic.title}
                      </div>
                      {!hasContent && !loading && (
                        <div style={{ fontSize: 10, color: 'var(--red, #ef4444)' }}>
                          No content — will be skipped
                        </div>
                      )}
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)', flexShrink: 0 }}>
                      {dt.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      {' '}
                      {dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {hasContent && (
                      <span style={{ fontSize: 10, color: 'var(--green, #22c55e)' }}>✓</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {error && (
            <div style={{ fontSize: 12, color: 'var(--red, #ef4444)', padding: '8px 12px',
              background: 'color-mix(in srgb, var(--red, #ef4444) 10%, transparent)',
              borderRadius: 'var(--radius-sm)', border: '1px solid var(--red, #ef4444)' }}>
              ⚠ {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-surface btn-sm" onClick={onClose} disabled={scheduling}>
            Cancel
          </button>
          <button className="btn btn-primary btn-sm"
            disabled={!canSchedule || scheduling || selected.size === 0}
            onClick={handleSchedule}>
            {scheduling
              ? '⏳ Scheduling…'
              : `📅 Schedule ${totalJobs} job${totalJobs !== 1 ? 's' : ''}`
            }
          </button>
        </div>
      </div>
    </div>
  );
};
