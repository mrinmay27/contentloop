import React, { useState, useEffect } from 'react';
import { Icon } from '../components/ui/Icon';
import { api } from '../lib/api';
import type { ThemePage } from '../lib/types';

type ScheduledPost = {
  id: string;
  state: string;
  scheduled_at: string;
  platform: string;
  type: string;
  topic_title: string;
};

type Props = { page: ThemePage };

const TYPE_COLOR: Record<string, string> = {
  carousel: 'var(--accent)',
  reel:     'var(--blue)',
  post:     'var(--green)',
};

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month:'short', day:'numeric' });
}

export const SchedulerView: React.FC<Props> = ({ page }) => {
  const today  = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-based for display
  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.getSchedule(page.id, year, month + 1)   // API is 1-based
      .then(setPosts)
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, [page.id, year, month]);

  // Build calendar cells
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev  = new Date(year, month, 0).getDate();

  const cells: { day:number; cur:boolean }[] = [];
  for (let i=firstDay-1; i>=0; i--) cells.push({ day: daysInPrev-i, cur:false });
  for (let d=1; d<=daysInMonth; d++) cells.push({ day:d, cur:true });
  while (cells.length % 7) cells.push({ day: cells.length-daysInMonth-firstDay+1, cur:false });

  const getEvents = (cell: { day:number; cur:boolean }) => {
    if (!cell.cur) return [];
    return posts.filter(p => {
      const d = new Date(p.scheduled_at);
      return d.getFullYear()===year && d.getMonth()===month && d.getDate()===cell.day;
    });
  };

  const upcoming = posts
    .filter(p => p.state === 'SCHEDULED' && new Date(p.scheduled_at) >= today)
    .sort((a,b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
    .slice(0, 10);

  const prevMonth = () => {
    if (month === 0) { setYear(y => y-1); setMonth(11); }
    else setMonth(m => m-1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y+1); setMonth(0); }
    else setMonth(m => m+1);
  };

  return (
    <div style={{ display:'flex', flex:1, flexDirection:'column', overflow:'hidden' }}>
      <div className="topbar">
        <span className="topbar-title">Scheduler</span>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginLeft:16 }}>
          <button className="btn-icon" onClick={prevMonth}>
            <Icon name="chevronLeft" size={14}/>
          </button>
          <span style={{ fontWeight:700, minWidth:90, textAlign:'center' }}>
            {MONTH_NAMES[month]} {year}
          </span>
          <button className="btn-icon" onClick={nextMonth}>
            <Icon name="chevronRight" size={14}/>
          </button>
        </div>
        <div className="topbar-right">
          {Object.entries(TYPE_COLOR).map(([type, color]) => (
            <div key={type} style={{ display:'flex', gap:4, alignItems:'center' }}>
              <div style={{ width:8, height:8, borderRadius:2, background:color }}/>
              <span style={{ fontSize:11, color:'var(--text-secondary)', textTransform:'capitalize' }}>{type}</span>
            </div>
          ))}
          <button className="btn btn-primary btn-sm">
            <Icon name="plus" size={11}/> Schedule Post
          </button>
        </div>
      </div>

      <div className="view-area">
        {loading && (
          <div style={{ textAlign:'center', padding:20, color:'var(--text-muted)', fontSize:12 }}>
            Loading schedule…
          </div>
        )}

        {/* Calendar */}
        <div className="cal-header">
          {DAY_NAMES.map(d => <div key={d} className="cal-header-cell">{d}</div>)}
        </div>
        <div className="calendar-grid">
          {cells.map((cell, i) => {
            const events  = getEvents(cell);
            const isToday = cell.cur
              && cell.day   === today.getDate()
              && month      === today.getMonth()
              && year       === today.getFullYear();
            return (
              <div key={i} className={`cal-cell ${isToday?'today':''} ${!cell.cur?'other-month':''}`}>
                <div className="cal-date">{cell.day}</div>
                {events.map(ev => {
                  const color = TYPE_COLOR[ev.type] ?? 'var(--accent)';
                  return (
                    <div key={ev.id} className="cal-event"
                      style={{ background:color+'22', color, border:`1px solid ${color}44` }}>
                      {fmtTime(ev.scheduled_at)} · {ev.topic_title.substring(0,18)}…
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Upcoming Queue */}
        <div style={{ marginTop:20 }}>
          <div className="section-label">
            Upcoming Queue
            <span style={{ marginLeft:8, fontWeight:400, color:'var(--text-muted)' }}>
              ({upcoming.length} posts)
            </span>
          </div>
          {upcoming.length === 0 ? (
            <div className="empty-state" style={{ marginTop:12 }}>
              <div style={{ fontSize:24, opacity:0.3 }}>📅</div>
              <div style={{ fontWeight:600 }}>No upcoming posts</div>
              <div style={{ fontSize:12, color:'var(--text-muted)' }}>
                Approve content and run the scheduler to fill this view
              </div>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:8 }}>
              {upcoming.map(ev => {
                const color = TYPE_COLOR[ev.type] ?? 'var(--accent)';
                return (
                  <div key={ev.id} style={{ display:'flex', alignItems:'center', gap:12,
                    padding:'10px 14px', background:'var(--bg-surface)',
                    border:'1px solid var(--border)', borderRadius:'var(--radius-sm)' }}>
                    <div style={{ width:8, height:8, borderRadius:2, background:color, flexShrink:0 }}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:500, overflow:'hidden',
                        textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {ev.topic_title}
                      </div>
                      <div style={{ fontSize:11, color:'var(--text-muted)', fontFamily:'var(--mono)', marginTop:2 }}>
                        {fmtDate(ev.scheduled_at)} · {fmtTime(ev.scheduled_at)} · {ev.platform}
                      </div>
                    </div>
                    <span className="badge badge-muted" style={{ fontFamily:'var(--mono)', textTransform:'capitalize' }}>
                      {ev.type}
                    </span>
                    <button className="btn btn-sm btn-ghost"><Icon name="edit" size={11}/></button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
