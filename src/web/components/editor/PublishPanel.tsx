import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { PublishJob, PublishPlatformInfo } from '../../lib/types';

interface Props {
  contentId: string | null;
  pageId:    string;
  approved:  boolean;      // only allow publish if content is approved
}

const STATUS_BADGE: Record<PublishJob['status'], { label: string; color: string }> = {
  pending:    { label: 'Queued',      color: 'var(--text-muted)' },
  scheduled:  { label: 'Scheduled',  color: '#F5A623' },
  publishing: { label: 'Publishing…', color: '#F5A623' },
  published:  { label: 'Published ✓', color: 'var(--green, #22c55e)' },
  failed:     { label: 'Failed',      color: 'var(--red, #ef4444)' },
};

function formatScheduledAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export const PublishPanel: React.FC<Props> = ({ contentId, pageId, approved }) => {
  const [platforms, setPlatforms] = useState<Record<string, PublishPlatformInfo>>({});
  const [selected,  setSelected]  = useState<Set<string>>(new Set(['instagram']));
  const [jobs,      setJobs]      = useState<PublishJob[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduledAt, setScheduledAt]   = useState('');
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load connected platforms
  useEffect(() => {
    api.getPublishPlatforms(pageId)
      .then(({ platforms: p }) => setPlatforms(p))
      .catch(() => {});
  }, [pageId]);

  // Load existing jobs + start polling when any are in-flight
  const loadJobs = useCallback(() => {
    if (!contentId) return;
    api.getPublishJobs(contentId).then(({ jobs: j }) => {
      setJobs(j);
      const inFlight = j.some(job => job.status === 'pending' || job.status === 'publishing');
      if (inFlight && !pollRef.current) {
        pollRef.current = setInterval(() => loadJobs(), 2500);
      } else if (!inFlight && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }).catch(() => {});
  }, [contentId]);

  useEffect(() => {
    loadJobs();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadJobs]);

  const toggle = (platform: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(platform) ? next.delete(platform) : next.add(platform);
      return next;
    });
  };

  const handlePublish = async () => {
    if (!contentId || selected.size === 0 || publishing) return;
    setPublishing(true); setError(null);
    try {
      const body: { platforms: string[]; scheduledAt?: string } = {
        platforms: [...selected],
      };
      if (scheduleMode && scheduledAt) body.scheduledAt = new Date(scheduledAt).toISOString();
      const { jobs: newJobs } = await api.publishContent(contentId, body);
      setJobs(prev => {
        const existingIds = new Set(prev.map(j => j.id));
        return [...newJobs.filter(j => !existingIds.has(j.id)), ...prev];
      });
      // Start polling for status updates
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => loadJobs(), 2500);
    } catch (err: any) {
      setError(err?.message ?? 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  const platformList = Object.entries(platforms);
  const anySelected = selected.size > 0;
  const hasJobs = jobs.length > 0;

  return (
    <div style={{
      marginTop: 16,
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--bg-elevated)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>
          🚀 Publish
        </span>
        {!approved && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Approve content first
          </span>
        )}
      </div>

      <div style={{ padding: '12px 14px' }}>
        {/* Platform selector */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Publish to
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {platformList.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading platforms…</div>
            )}
            {platformList.map(([key, info]) => {
              const isSelected = selected.has(key);
              const isConnected = info.connected;
              return (
                <label key={key} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  cursor: approved && isConnected ? 'pointer' : 'default',
                  opacity: isConnected ? 1 : 0.45,
                  padding: '6px 8px', borderRadius: 'var(--radius-sm)',
                  background: isSelected && isConnected ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
                  border: `1px solid ${isSelected && isConnected ? 'var(--accent)' : 'transparent'}`,
                  transition: 'all 0.15s',
                }}>
                  <input
                    type="checkbox"
                    checked={isSelected && isConnected}
                    disabled={!approved || !isConnected}
                    onChange={() => isConnected && toggle(key)}
                    style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
                  />
                  <span style={{ fontSize: 16, lineHeight: 1 }}>{info.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
                    {info.label}
                  </span>
                  {!isConnected && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Not connected</span>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        {/* Schedule toggle */}
        {approved && (
          <div style={{ marginBottom: 10 }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer',
            }}>
              <input type="checkbox" checked={scheduleMode}
                onChange={e => setScheduleMode(e.target.checked)}
                style={{ accentColor: 'var(--accent)' }} />
              Schedule for later
            </label>
            {scheduleMode && (
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={e => setScheduledAt(e.target.value)}
                min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                style={{ marginTop: 8, width: '100%', fontSize: 11, boxSizing: 'border-box' }}
              />
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ fontSize: 11, color: 'var(--red, #ef4444)', marginBottom: 8 }}>
            ⚠ {error}
          </div>
        )}

        {/* Publish button */}
        <button
          className="btn btn-primary btn-sm"
          style={{ width: '100%', fontSize: 12 }}
          disabled={!approved || !anySelected || publishing || (scheduleMode && !scheduledAt)}
          onClick={handlePublish}
        >
          {publishing
            ? '⏳ Publishing…'
            : scheduleMode && scheduledAt
              ? `🗓 Schedule (${[...selected].length} platform${selected.size > 1 ? 's' : ''})`
              : `🚀 Publish Now (${[...selected].length} platform${selected.size > 1 ? 's' : ''})`
          }
        </button>

        {/* Jobs history */}
        {hasJobs && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Publish history
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {jobs.map(job => {
                const badge = STATUS_BADGE[job.status] ?? STATUS_BADGE.failed;
                const info = platforms[job.platform];
                return (
                  <div key={job.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 8px', borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-base)', border: '1px solid var(--border)',
                    fontSize: 11,
                  }}>
                    <span style={{ fontSize: 14 }}>{info?.icon ?? '📡'}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>
                      {info?.label ?? job.platform}
                    </span>
                    <span style={{ fontWeight: 700, color: badge.color }}>{badge.label}</span>
                    {job.external_url && (
                      <a href={job.external_url} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 10, color: 'var(--accent)', textDecoration: 'none' }}>
                        View ↗
                      </a>
                    )}
                    {job.scheduled_at && job.status === 'scheduled' && (
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                        {formatScheduledAt(job.scheduled_at)}
                      </span>
                    )}
                    {job.error && (
                      <span style={{ fontSize: 10, color: 'var(--red, #ef4444)',
                        maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={job.error}>
                        {job.error}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
