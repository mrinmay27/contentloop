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
  // Starts empty and fills in from what is actually connected. It used to
  // default to 'instagram' unconditionally, so a page with only YouTube
  // connected still opened reading "Publish Now (1 platform)" — that one being
  // a platform the user could not tick, untick, or publish to.
  const [selected,  setSelected]  = useState<Set<string>>(new Set());
  const [open,      setOpen]      = useState(false);
  const [jobs,      setJobs]      = useState<PublishJob[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [scheduledAt, setScheduledAt]   = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Jobs from the most recent click, so the dialog can confirm what it did
   *  instead of leaving the user staring at an unchanged form. */
  const [justPublished, setJustPublished] = useState<PublishJob[] | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load connected platforms
  useEffect(() => {
    api.getPublishPlatforms(pageId)
      .then(({ platforms: p }) => {
        setPlatforms(p);
        setSelected(prev => prev.size ? prev
          : new Set(Object.entries(p).filter(([, i]) => i.connected).map(([k]) => k)));
      })
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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
      setJustPublished(newJobs);
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

  const latest = jobs[0];
  const connectedCount = platformList.filter(([, i]) => i.connected).length;

  return (
    <div style={{ marginTop: 16 }}>
      {/* Trigger. The panel used to sit open in the right rail, where it grew
          with every platform added and pushed its own Publish button off the
          bottom of the scroll. Everything now lives in a dialog, so the rail
          holds one control at a fixed height and nothing can hide below it. */}
      <button
        className="btn btn-primary"
        style={{ width: '100%', fontSize: 13, padding: '10px 12px' }}
        disabled={!approved}
        onClick={() => { setJustPublished(null); setError(null); setOpen(true); }}
        title={approved ? 'Choose platforms and publish' : 'Approve the content first'}
      >
        🚀 Publish{connectedCount > 0 ? '' : ' — nothing connected'}
      </button>

      <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center' }}>
        {!approved
          ? 'Approve the content to enable publishing'
          : latest
            ? `Last: ${(platforms[latest.platform]?.label ?? latest.platform)} — ${latest.dry_run ? 'dry run' : (STATUS_BADGE[latest.status] ?? STATUS_BADGE.failed).label}`
            : connectedCount > 0
              ? `${connectedCount} platform${connectedCount > 1 ? 's' : ''} connected`
              : 'Connect a platform in Settings first'}
      </div>

      {!open ? null : (
      <div
        role="dialog" aria-modal="true" aria-label="Publish"
        onClick={() => setOpen(false)}
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}
      >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(440px, 100%)', maxHeight: '85vh',
          display: 'flex', flexDirection: 'column',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          background: 'var(--bg-elevated)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
      >
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
          🚀 Publish
        </span>
        <button onClick={() => setOpen(false)} aria-label="Close"
          style={{ background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
      </div>

      {/* Body scrolls; the action below never does. */}
      <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {justPublished && justPublished.length > 0 && (
          <div style={{
            marginBottom: 12, padding: '10px 12px', fontSize: 12, lineHeight: 1.6,
            border: '1px solid var(--green, #22c55e)',
            background: 'color-mix(in srgb, var(--green, #22c55e) 10%, transparent)',
            borderRadius: 'var(--radius-sm)',
          }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              {scheduleMode ? '🗓 Scheduled' : '✓ Sent'}
            </div>
            {justPublished.map(j => (
              <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{platforms[j.platform]?.label ?? j.platform}</span>
                {j.dry_run
                  ? <span style={{ color: 'var(--text-muted)' }}>— dry run, nothing was sent</span>
                  : j.external_url
                    ? <a href={j.external_url} target="_blank" rel="noopener noreferrer"
                        style={{ color: 'var(--accent)' }}>View on the platform ↗</a>
                    : <span style={{ color: 'var(--text-muted)' }}>— uploading…</span>}
              </div>
            ))}
            <div style={{ color: 'var(--text-muted)', marginTop: 6, fontSize: 11 }}>
              {scheduleMode
                ? 'It goes out at the time you picked, even if the app is closed — it catches up on next launch.'
                : 'Status updates here as it finishes. Uploads land as private unless you changed that in Settings.'}
            </div>
          </div>
        )}
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
                    <span style={{ fontWeight: 700, color: job.dry_run ? 'var(--text-muted)' : badge.color }}>
                      {job.dry_run ? 'Dry run' : badge.label}
                    </span>
                    {/* The dry-run URL is a placeholder that 404s, so it must
                        not be offered as a link. */}
                    {job.external_url && !job.dry_run && (
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

      {/* Action, outside the scroll area so it is always on screen. */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <button
          className="btn btn-primary"
          style={{ width: '100%', fontSize: 12.5 }}
          disabled={!justPublished && (!approved || !anySelected || publishing || (scheduleMode && !scheduledAt))}
          onClick={justPublished ? () => setOpen(false) : handlePublish}
        >
          {justPublished
            ? 'Done'
            : publishing
            ? '⏳ Publishing…'
            : !anySelected
              ? 'Pick a platform'
              : scheduleMode && scheduledAt
                ? `🗓 Schedule (${[...selected].length} platform${selected.size > 1 ? 's' : ''})`
                : `🚀 Publish Now (${[...selected].length} platform${selected.size > 1 ? 's' : ''})`
          }
        </button>
      </div>

      </div>
      </div>
      )}
    </div>
  );
};
