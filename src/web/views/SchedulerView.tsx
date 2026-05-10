import React, { useState, useEffect, useCallback } from 'react';
import { Icon } from '../components/ui/Icon';
import { api } from '../lib/api';
import type { ThemePage } from '../lib/types';

type ScheduledJob = {
  id: string;
  status: 'pending' | 'scheduled' | 'publishing' | 'published' | 'failed';
  platform: string;
  scheduled_at: string | null;
  published_at: string | null;
  external_url: string | null;
  error: string | null;
  type: string;
  topic_title: string;
  display_at: string;
};

type Props = { page: ThemePage };

const TYPE_COLOR: Record<string, string> = {
  carousel: 'var(--accent)',
  reel:     'var(--blue, #3b82f6)',
  post:     'var(--green, #22c55e)',
};

const PLATFORM_ICON: Record<string, string> = {
  instagram: '📸', linkedin: '💼', twitter: '🐦', reddit: '🤖', facebook: '📘',
};

const STATUS_STYLE: Record<string, { color: string; label: string }> = {
  pending:    { color: 'var(--text-muted)',        label: 'Queued'      },
  scheduled:  { color: '#f59e0b',                  label: 'Scheduled'   },
  publishing: { color: 'var(--accent)',            label: 'Publishing…' },
  published:  { color: 'var(--green, #22c55e)',    label: 'Published ✓' },
  failed:     { color: 'var(--red, #ef4444)',      label: 'Failed'      },
};

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export const SchedulerView: React.FC<Props> = ({ page }) => {
  const today = new Date();
  const [year,    setYear]    = useState(today.getFullYear());
  const [month,   setMonth]   = useState(today.getMonth());   // 0-based internally
  const [jobs,    setJobs]    = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleVal, setRescheduleVal] = useState('');
  // Popover shown when clicking a calendar event chip
  const [popover, setPopover] = useState<{ job: ScheduledJob; rect: DOMRect } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.getSchedule(page.id, year, month + 1)
      .then((rows: any) => setJobs(Array.isArray(rows) ? rows : []))
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }, [page.id, year, month]);

  useEffect(() => { load(); }, [load]);

  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  // Build calendar grid
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev  = new Date(year, month, 0).getDate();
  const cells: { day: number; cur: boolean }[] = [];
  for (let i = firstDay - 1; i >= 0; i--) cells.push({ day: daysInPrev - i, cur: false });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, cur: true });
  while (cells.length % 7) cells.push({ day: cells.length - daysInMonth - firstDay + 1, cur: false });

  const getEventsForDay = (cell: { day: number; cur: boolean }) => {
    if (!cell.cur) return [];
    return jobs.filter(j => {
      const d = new Date(j.display_at);
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === cell.day;
    });
  };

  // Show ALL scheduled jobs — past-due ones are overdue and need manual action (▶ Now)
  const upcoming = jobs
    .filter(j => j.status === 'scheduled' && j.scheduled_at)
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime());

  const handleCancel = async (jobId: string) => {
    setActionId(jobId);
    try { await api.cancelPublishJob(jobId); load(); } catch {}
    setActionId(null);
  };

  const handlePublishNow = async (jobId: string) => {
    setActionId(jobId);
    try { await api.publishJobNow(jobId); load(); } catch {}
    setActionId(null);
  };

  const handleReschedule = async (jobId: string) => {
    if (!rescheduleVal) return;
    if (new Date(rescheduleVal) <= new Date()) {
      alert('Scheduled time must be in the future');
      return;
    }
    setActionId(jobId);
    try { await api.reschedulePublishJob(jobId, new Date(rescheduleVal).toISOString()); load(); } catch {}
    setRescheduleId(null);
    setRescheduleVal('');
    setActionId(null);
  };

  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
      <div className="topbar">
        <span className="topbar-title">Scheduler</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 16 }}>
          <button className="btn-icon" onClick={prevMonth}>
            <Icon name="chevronLeft" size={14}/>
          </button>
          <span style={{ fontWeight: 700, minWidth: 90, textAlign: 'center', fontSize: 13 }}>
            {MONTH_NAMES[month]} {year}
          </span>
          <button className="btn-icon" onClick={nextMonth}>
            <Icon name="chevronRight" size={14}/>
          </button>
        </div>
        <div className="topbar-right">
          {Object.entries(TYPE_COLOR).map(([type, color]) => (
            <div key={type} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: color }}/>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{type}</span>
            </div>
          ))}
          <button className="btn btn-surface btn-sm" onClick={load} disabled={loading}>
            <Icon name="refresh" size={11}/> Refresh
          </button>
        </div>
      </div>

      <div className="view-area">
        {loading && (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>
            Loading…
          </div>
        )}

        {/* Calendar header */}
        <div className="cal-header">
          {DAY_NAMES.map(d => <div key={d} className="cal-header-cell">{d}</div>)}
        </div>

        {/* Calendar grid */}
        <div className="calendar-grid">
          {cells.map((cell, i) => {
            const events = getEventsForDay(cell);
            const isToday = cell.cur
              && cell.day === today.getDate()
              && month    === today.getMonth()
              && year     === today.getFullYear();
            return (
              <div key={i} className={`cal-cell ${isToday ? 'today' : ''} ${!cell.cur ? 'other-month' : ''}`}>
                <div className="cal-date">{cell.day}</div>
                {events.slice(0, 3).map(ev => {
                  const color = TYPE_COLOR[ev.type] ?? 'var(--accent)';
                  const icon  = PLATFORM_ICON[ev.platform] ?? '📡';
                  return (
                    <div key={ev.id} className="cal-event"
                      style={{ background: color + '22', color, border: `1px solid ${color}44`, cursor: 'pointer' }}
                      onClick={e => {
                        e.stopPropagation();
                        setPopover({ job: ev, rect: e.currentTarget.getBoundingClientRect() });
                      }}>
                      <span style={{ marginRight: 3 }}>{icon}</span>
                      {ev.status === 'published' ? '✓ ' : ''}
                      {ev.scheduled_at ? fmtTime(ev.scheduled_at) : ''}
                      {' · '}
                      {ev.topic_title.substring(0, 14)}…
                      {ev.status === 'failed' && (
                        <span style={{ color: 'var(--red, #ef4444)', marginLeft: 2 }}>✕</span>
                      )}
                    </div>
                  );
                })}
                {events.length > 3 && (
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', paddingLeft: 4 }}>
                    +{events.length - 3} more
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Upcoming Queue */}
        <div style={{ marginTop: 24 }}>
          <div className="section-label">
            Upcoming Queue
            <span style={{ marginLeft: 8, fontWeight: 400, color: 'var(--text-muted)' }}>
              ({upcoming.length})
            </span>
          </div>
          {upcoming.length === 0 ? (
            <div className="empty-state" style={{ marginTop: 12 }}>
              <div style={{ fontSize: 24, opacity: 0.3 }}>📅</div>
              <div style={{ fontWeight: 600 }}>No upcoming posts</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Approve content and schedule from the editor to fill this view
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {upcoming.map(job => {
                const color = TYPE_COLOR[job.type] ?? 'var(--accent)';
                const icon  = PLATFORM_ICON[job.platform] ?? '📡';
                const isActing = actionId === job.id;
                const isRescheduling = rescheduleId === job.id;
                const isOverdue = job.scheduled_at && new Date(job.scheduled_at) < today;
                return (
                  <div key={job.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', background: 'var(--bg-surface)',
                    border: `1px solid ${isOverdue ? 'var(--red, #ef4444)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-sm)',
                    flexWrap: 'wrap',
                  }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: isOverdue ? 'var(--red, #ef4444)' : color, flexShrink: 0 }}/>
                    <span style={{ fontSize: 16 }}>{icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {job.topic_title}
                      </div>
                      <div style={{ fontSize: 11, fontFamily: 'var(--mono)', marginTop: 2,
                        color: isOverdue ? 'var(--red, #ef4444)' : 'var(--text-muted)' }}>
                        {isOverdue ? '⚠ Overdue · ' : ''}
                        {job.scheduled_at ? `${fmtDate(job.scheduled_at)} · ${fmtTime(job.scheduled_at)}` : '—'}
                        {' · '}{job.platform}
                      </div>
                    </div>
                    <span className="badge badge-muted"
                      style={{ fontFamily: 'var(--mono)', textTransform: 'capitalize' }}>
                      {job.type}
                    </span>

                    {isRescheduling ? (
                      <>
                        <input type="datetime-local" value={rescheduleVal}
                          onChange={e => setRescheduleVal(e.target.value)}
                          min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                          style={{ fontSize: 11 }}/>
                        <button className="btn btn-primary btn-sm" disabled={!rescheduleVal || isActing}
                          onClick={() => handleReschedule(job.id)}>
                          {isActing ? '…' : 'Save'}
                        </button>
                        <button className="btn btn-surface btn-sm"
                          onClick={() => { setRescheduleId(null); setRescheduleVal(''); }}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-surface btn-sm" disabled={isActing}
                          title="Publish immediately"
                          onClick={() => handlePublishNow(job.id)}>
                          {isActing ? '…' : '▶ Now'}
                        </button>
                        <button className="btn btn-surface btn-sm" disabled={isActing}
                          title="Reschedule"
                          onClick={() => {
                            setRescheduleId(job.id);
                            setRescheduleVal(job.scheduled_at
                              ? new Date(job.scheduled_at).toISOString().slice(0, 16) : '');
                          }}>
                          <Icon name="edit" size={11}/>
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={isActing}
                          title="Cancel scheduled post"
                          style={{ color: 'var(--red, #ef4444)' }}
                          onClick={() => handleCancel(job.id)}>
                          <Icon name="trash" size={11}/>
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {/* Calendar event popover */}
      {popover && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 199 }}
            onClick={() => setPopover(null)}/>
          <div style={{
            position: 'fixed',
            top: popover.rect.bottom + 6,
            left: Math.max(8, Math.min(popover.rect.left, window.innerWidth - 272)),
            zIndex: 200,
            width: 260,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-lg)',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ fontSize: 20 }}>{PLATFORM_ICON[popover.job.platform] ?? '📡'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>
                  {popover.job.topic_title}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>
                  {popover.job.scheduled_at
                    ? `${fmtDate(popover.job.scheduled_at)} · ${fmtTime(popover.job.scheduled_at)}`
                    : '—'}
                </div>
              </div>
              <button className="btn-icon" style={{ fontSize: 12, flexShrink: 0 }}
                onClick={() => setPopover(null)}>✕</button>
            </div>

            {/* Badges */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="badge badge-muted" style={{ textTransform: 'capitalize' }}>
                {popover.job.type}
              </span>
              <span style={{
                fontSize: 10, padding: '2px 6px', borderRadius: 4, fontWeight: 600,
                color: STATUS_STYLE[popover.job.status]?.color ?? 'var(--text-muted)',
                background: `color-mix(in srgb, ${STATUS_STYLE[popover.job.status]?.color ?? 'var(--text-muted)'} 15%, transparent)`,
              }}>
                {STATUS_STYLE[popover.job.status]?.label ?? popover.job.status}
              </span>
              {popover.job.status === 'scheduled'
                && popover.job.scheduled_at
                && new Date(popover.job.scheduled_at) < new Date() && (
                <span style={{ fontSize: 10, color: 'var(--red, #ef4444)', fontWeight: 600 }}>
                  ⚠ Overdue
                </span>
              )}
            </div>

            {/* Error detail */}
            {popover.job.error && (
              <div style={{
                fontSize: 10, color: 'var(--red, #ef4444)', fontFamily: 'var(--mono)',
                background: 'color-mix(in srgb, var(--red, #ef4444) 10%, transparent)',
                borderRadius: 4, padding: '4px 8px',
              }}>
                {popover.job.error}
              </div>
            )}

            {/* External link if published */}
            {popover.job.external_url && (
              <a href={popover.job.external_url} target="_blank" rel="noreferrer"
                style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>
                View post ↗
              </a>
            )}

            {/* Reschedule inline form */}
            {rescheduleId === popover.job.id && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input type="datetime-local" value={rescheduleVal}
                  onChange={e => setRescheduleVal(e.target.value)}
                  min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
                  style={{ fontSize: 11 }}/>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-primary btn-sm" style={{ flex: 1 }}
                    disabled={!rescheduleVal || actionId === popover.job.id}
                    onClick={async () => {
                      await handleReschedule(popover.job.id);
                      setPopover(null);
                    }}>
                    {actionId === popover.job.id ? '…' : 'Save'}
                  </button>
                  <button className="btn btn-surface btn-sm"
                    onClick={() => { setRescheduleId(null); setRescheduleVal(''); }}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Action buttons */}
            {rescheduleId !== popover.job.id && popover.job.status !== 'published' && (
              <div style={{ display: 'flex', gap: 6 }}>
                {(popover.job.status === 'scheduled' || popover.job.status === 'pending') && (
                  <button className="btn btn-primary btn-sm" style={{ flex: 1 }}
                    disabled={actionId === popover.job.id}
                    onClick={() => { handlePublishNow(popover.job.id); setPopover(null); }}>
                    {actionId === popover.job.id ? '…' : '▶ Now'}
                  </button>
                )}
                {popover.job.status === 'scheduled' && (
                  <button className="btn btn-surface btn-sm" title="Reschedule"
                    onClick={() => {
                      setRescheduleId(popover.job.id);
                      setRescheduleVal(popover.job.scheduled_at
                        ? new Date(popover.job.scheduled_at).toISOString().slice(0, 16) : '');
                    }}>
                    ✏
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" title="Cancel post"
                  style={{ color: 'var(--red, #ef4444)' }}
                  disabled={actionId === popover.job.id}
                  onClick={() => { handleCancel(popover.job.id); setPopover(null); }}>
                  🗑
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
