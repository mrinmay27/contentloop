import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, Check, X, Pencil, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';
import type { InboxData, InboxDraftItem, InboxFailedItem, Topic } from '../lib/types';

const KIND_ICON: Record<string, string> = {
  cross_post: '↗', fast_track: '⚡', recycle: '♻', trend_alert: '🔥', posted: '✓',
};

function timeAgo(iso: string): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

export const InboxView: React.FC<{
  onOpenEditor: (topic: Topic) => void;
  onAddTopic: () => void;
}> = ({ onOpenEditor, onAddTopic }) => {
  const [data, setData] = useState<InboxData | null>(null);
  const [loading, setLoading] = useState(true);
  const [focusIdx, setFocusIdx] = useState(0);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // IDs of needs-you items with an in-flight approve/reject/retry/dismiss
  // call. Guards against a refresh (manual click or the 60s poll) landing
  // between the optimistic removal and the server processing the mutation
  // — without this, the item would be resurrected until the next refresh.
  const pendingRef = useRef<Set<string>>(new Set());
  const idOf = (i: InboxDraftItem | InboxFailedItem) => i.kind === 'draft' ? i.contentItemId : i.publishJobId;

  // approve/reject are memoized (deps: [refresh], which never changes
  // identity), so their closures are fixed at mount — reading `data`
  // directly inside removeItem would see the stale mount-time value
  // (null). Mirror it into a ref, refreshed every render, instead.
  const dataRef = useRef<InboxData | null>(data);
  dataRef.current = data;

  const refresh = useCallback(() => {
    api.getInbox().then((d: InboxData) => {
      const needsYou = d.needsYou.filter((i) => !pendingRef.current.has(idOf(i)));
      setData({ ...d, needsYou });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    api.markAlertsSeen().catch(() => {});   // inbox visit = activity seen
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => () => { if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current); }, []);

  const flash = (msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast(msg);
    toastTimeoutRef.current = setTimeout(() => setToast(null), 2500);
  };

  const removeItem = (predicate: (i: InboxDraftItem | InboxFailedItem) => boolean) => {
    setData((d) => d ? { ...d, needsYou: d.needsYou.filter((i) => !predicate(i)) } : d);
    const newLen = (dataRef.current?.needsYou ?? []).filter((i) => !predicate(i)).length;
    setFocusIdx((idx) => Math.max(0, Math.min(idx, newLen - 1)));
  };

  const approve = useCallback((item: InboxDraftItem) => {
    pendingRef.current.add(item.contentItemId);
    removeItem((i) => i.kind === 'draft' && i.contentItemId === item.contentItemId);
    api.approveContent(item.contentItemId)
      .then(() => { pendingRef.current.delete(item.contentItemId); flash('Approved — will be scheduled shortly'); })
      .catch(() => { pendingRef.current.delete(item.contentItemId); flash('Approve failed'); refresh(); });
  }, [refresh]);

  const reject = useCallback((item: InboxDraftItem) => {
    pendingRef.current.add(item.contentItemId);
    removeItem((i) => i.kind === 'draft' && i.contentItemId === item.contentItemId);
    api.rejectContent(item.contentItemId)
      .then(() => { pendingRef.current.delete(item.contentItemId); flash('Rejected'); })
      .catch(() => { pendingRef.current.delete(item.contentItemId); flash('Reject failed'); refresh(); });
  }, [refresh]);

  const retryFailed = (item: InboxFailedItem) => {
    pendingRef.current.add(item.publishJobId);
    removeItem((i) => i.kind === 'failed_publish' && i.publishJobId === item.publishJobId);
    api.publishJobNow(item.publishJobId)
      .then(() => { pendingRef.current.delete(item.publishJobId); flash('Retrying publish'); })
      .catch(() => { pendingRef.current.delete(item.publishJobId); flash('Retry failed'); refresh(); });
  };

  const dismissFailed = (item: InboxFailedItem) => {
    pendingRef.current.add(item.publishJobId);
    removeItem((i) => i.kind === 'failed_publish' && i.publishJobId === item.publishJobId);
    api.dismissPublishJob(item.publishJobId)
      .then(() => { pendingRef.current.delete(item.publishJobId); flash('Dismissed'); })
      .catch(() => { pendingRef.current.delete(item.publishJobId); flash('Dismiss failed'); refresh(); });
  };

  // Keyboard: j/k or arrows move focus; A approve; R reject (drafts only)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!data || data.needsYou.length === 0) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const max = data.needsYou.length - 1;
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); setFocusIdx((i) => Math.min(max, i + 1)); }
      if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); setFocusIdx((i) => Math.max(0, i - 1)); }
      const item = data.needsYou[Math.min(focusIdx, max)];
      if (!item) return;
      if ((e.key === 'a' || e.key === 'A') && item.kind === 'draft') approve(item);
      if ((e.key === 'r' || e.key === 'R') && item.kind === 'draft') reject(item);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [data, focusIdx, approve, reject]);

  const activity = data?.activity ?? [];
  const visibleActivity = showAllActivity ? activity : activity.slice(0, 10);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="topbar">
        <span className="topbar-title">Inbox</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>All pages</span>
        <div className="topbar-right">
          <button className="btn btn-ghost btn-sm" onClick={refresh} title="Refresh"><RefreshCw size={14} /></button>
          <button className="btn btn-surface btn-sm" onClick={onAddTopic}><Plus size={14} /> Add topic</button>
        </div>
      </div>

      <div className="view-area" style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 760 }}>
          {loading && <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>Loading inbox…</div>}

          {!loading && data && (
            <>
              {/* Digest strip */}
              <div style={{ padding: '10px 14px', borderRadius: 10, background: 'var(--bg-elevated)',
                fontSize: 12, color: 'var(--text-secondary)', marginBottom: 20 }}>
                <div>
                  Since yesterday:&nbsp;
                  <b>{data.digest.postedSinceYesterday}</b> posted ·&nbsp;
                  <b>{data.digest.automationSinceYesterday}</b> automation actions ·&nbsp;
                  <b>{data.digest.topicsScoredSinceYesterday}</b> topics scored
                </div>
                {data.nextScheduled.length > 0 && (
                  <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                    {data.nextScheduled.map((n) => (
                      <div key={n.publishJobId}>Next: “{n.topicTitle.slice(0, 60)}” → {n.pageName} · {fmtTime(n.scheduledAt)}</div>
                    ))}
                  </div>
                )}
              </div>

              {/* Needs-you lane */}
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
                Needs you {data.needsYou.length > 0 ? `(${data.needsYou.length})` : ''}
              </div>
              {data.needsYou.length === 0 ? (
                <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--bg-elevated)',
                  fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>
                  Nothing needs you ✓
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                  {data.needsYou.map((item, idx) => item.kind === 'draft' ? (
                    <div key={item.contentItemId} onClick={() => setFocusIdx(idx)}
                      style={{ borderRadius: 10, background: 'var(--bg-elevated)', padding: 14,
                        outline: idx === focusIdx ? '2px solid var(--accent)' : '1px solid transparent' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: 11 }}>
                        <span className="badge badge-muted">{item.pageName}</span>
                        <span className="badge badge-blue" style={{ textTransform: 'capitalize' }}>{item.type}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{timeAgo(item.createdAt)}</span>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{item.topic.title}</div>
                      <div style={{ display: 'flex', gap: 12 }}>
                        {item.imageUrl && (
                          <img src={item.imageUrl} alt="" style={{ width: 96, height: 96, objectFit: 'cover',
                            borderRadius: 8, flexShrink: 0 }} />
                        )}
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
                          display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical',
                          overflow: 'hidden', flex: 1 }}>
                          {item.formattedCaption}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button className="btn btn-surface btn-sm" onClick={() => approve(item)}>
                          <Check size={13} /> Approve
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => onOpenEditor(item.topic)}>
                          <Pencil size={13} /> Edit
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => reject(item)}>
                          <X size={13} /> Reject
                        </button>
                        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', alignSelf: 'center' }}>
                          A approve · R reject
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div key={item.publishJobId} onClick={() => setFocusIdx(idx)}
                      style={{ borderRadius: 10, background: 'var(--bg-elevated)', padding: 14,
                        borderLeft: '3px solid var(--red)',
                        outline: idx === focusIdx ? '2px solid var(--accent)' : '1px solid transparent' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, fontSize: 11 }}>
                        <span className="badge badge-muted">{item.pageName}</span>
                        <span style={{ color: 'var(--red)', fontWeight: 600 }}>Publish failed</span>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{item.topicTitle}</div>
                      {item.error && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{item.error.slice(0, 160)}</div>}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="btn btn-surface btn-sm" onClick={() => retryFailed(item)}>
                          <RotateCcw size={13} /> Retry
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => dismissFailed(item)}>
                          <X size={13} /> Dismiss
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Activity lane */}
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>Activity</div>
              {visibleActivity.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No automation activity yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {visibleActivity.map((a) => (
                    <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline',
                      padding: '6px 10px', borderRadius: 8, fontSize: 12 }}>
                      <span style={{ flexShrink: 0 }}>{KIND_ICON[a.kind] ?? '•'}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap' }}>{a.title}{a.pageName ? ` · ${a.pageName}` : ''}</span>
                      {a.outcome && (
                        <span className={a.outcome.engagementRate >= a.outcome.nicheAvg ? 'badge badge-green' : 'badge badge-amber'}
                          title={`niche avg ${(a.outcome.nicheAvg * 100).toFixed(1)}%`}>
                          {(a.outcome.engagementRate * 100).toFixed(1)}% eng
                        </span>
                      )}
                      <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--text-muted)' }}>{timeAgo(a.createdAt)}</span>
                    </div>
                  ))}
                  {!showAllActivity && activity.length > 10 && (
                    <button className="btn btn-ghost btn-sm" onClick={() => setShowAllActivity(true)}
                      style={{ alignSelf: 'flex-start' }}>Show all ({activity.length})</button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '8px 14px', fontSize: 12 }}>{toast}</div>
      )}
    </div>
  );
};
