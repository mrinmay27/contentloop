import React, { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { api } from '../../lib/api';

type FeedEvent = {
  id: string;
  kind: 'cross_post' | 'fast_track' | 'recycle' | 'trend_alert';
  title: string;
  createdAt: string;
  seenAt: string | null;
};

function timeAgo(iso: string): string {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export const AlertsBell: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [unseen, setUnseen] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = () => {
    api.getAlerts().then((d) => { setEvents(d.events); setUnseen(d.unseen); }).catch(() => {});
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unseen > 0) {
      api.markAlertsSeen().then(() => setUnseen(0)).catch(() => {});
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn-icon" onClick={toggle} title="Automation activity"
        style={{ position: 'relative' }}>
        <Bell size={14} />
        {unseen > 0 && (
          <span style={{
            position: 'absolute', top: 2, right: 2, minWidth: 14, height: 14,
            borderRadius: 7, background: 'var(--accent)', color: '#fff',
            fontSize: 9, fontWeight: 700, display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: '0 3px',
          }}>{unseen > 9 ? '9+' : unseen}</span>
        )}
      </button>
      {open && (
        <div style={{
          position: 'absolute', bottom: '110%', right: 0, width: 300, maxHeight: 360,
          overflowY: 'auto', background: 'var(--bg-elevated)', borderRadius: 10,
          border: '1px solid var(--border)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)', zIndex: 50, padding: 8,
        }}>
          <div style={{ fontWeight: 700, fontSize: 12, padding: '4px 8px' }}>Automation activity</div>
          {events.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>
              Nothing yet — cross-posts, recycles, and trend alerts appear here.
            </div>
          ) : events.map((e) => (
            <div key={e.id} style={{ padding: '6px 8px', fontSize: 12, borderRadius: 6,
              background: e.seenAt ? 'transparent' : 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>
              <div>{e.title}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{timeAgo(e.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
