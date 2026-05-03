import React, { useEffect, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/globals.css';
import { Sidebar } from './components/layout/Sidebar';
import { DashboardView } from './views/DashboardView';
import { PipelineView }  from './views/PipelineView';
import { SchedulerView } from './views/SchedulerView';
import { AnalyticsView } from './views/AnalyticsView';
import { SettingsView }  from './views/SettingsView';
import { ContentEditor }   from './components/editor/ContentEditor';
import { CreatePageModal } from './components/modals/CreatePageModal';
import { api } from './lib/api';
import type { NavKey, ThemePage, Topic, Stats } from './lib/types';

const EMPTY_STATS: Stats = {
  topics:0, selected_topics:0, qa_ready:0, approved:0, scheduled:0, posted:0,
  topics_today:0, selected_today:0, qa_ready_today:0, approved_today:0, posted_today:0,
  next_post_at: null,
};

/** Map API Page (already camelCased by mapPage) → ThemePage for UI */
function mapApiPage(p: any): ThemePage {
  const brand = p.brand ?? {};
  return {
    id:       p.id,
    name:     p.name,
    niche:    p.handle ?? p.platform ?? 'Unknown',  // sidebar sub-label
    nicheId:  p.nicheId,                             // camelCase from mapPage
    status:   (p.status ?? 'active') as 'active' | 'paused',
    accent:   brand.accent ?? '#F59E0B',
    posts:    0,
    followers: '—',
  };
}

function App() {
  const [theme, setTheme]             = useState<'light'|'dark'>('dark');
  const [activeNav, setActiveNav]     = useState<NavKey>('dashboard');
  const [pages, setPages]             = useState<ThemePage[]>([]);
  const [activePage, setActivePage]   = useState('');
  const [topics, setTopics]           = useState<Topic[]>([]);
  const [stats, setStats]             = useState<Stats>(EMPTY_STATS);
  const [busy, setBusy]               = useState<string|null>(null);
  const [error, setError]             = useState<string|null>(null);
  const [showCreate, setShowCreate]   = useState(false);

  // Load real pages from API once
  useEffect(() => {
    api.getPages().then((raw: any[]) => {
      const mapped = raw.map(mapApiPage);
      setPages(mapped);
      if (mapped.length > 0 && !activePage) setActivePage(mapped[0].id);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Editor state — tracks BOTH the topic and where we came from
  const [editingTopic, setEditingTopic] = useState<Topic|null>(null);
  const [editorSource, setEditorSource] = useState<NavKey>('dashboard');

  const openEditor = (topic: Topic) => {
    setEditorSource(activeNav);   // remember which view launched the editor
    setEditingTopic(topic);
  };
  const closeEditor = () => setEditingTopic(null);

  // Apply theme to DOM
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Keyboard shortcuts — Escape closes editor
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && editingTopic) { closeEditor(); return; }
      if (!(e.metaKey || e.ctrlKey)) return;
      const map: Record<string, NavKey> = { '1':'dashboard','2':'pipeline','3':'scheduler','4':'analytics' };
      if (map[e.key]) { e.preventDefault(); closeEditor(); setActiveNav(map[e.key]); }
      if (e.key===',') { e.preventDefault(); closeEditor(); setActiveNav('settings'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editingTopic]);

  const refresh = useCallback(async () => {
    // currentPage may not be set yet on first render — guard with activePage
    const page = pages.find(p => p.id === activePage) ?? pages[0];
    if (!page) return;
    try {
      const [s, t] = await Promise.all([
        api.getStats(page.nicheId, page.id),
        api.getTopics(page.nicheId),
      ]);
      setStats(s);
      setTopics(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    }
  }, [pages, activePage]);

  // Refresh whenever the selected page changes
  useEffect(() => { if (pages.length > 0) refresh(); }, [refresh, activePage, pages]);

  const runJob = async (job: string) => {
    setBusy(job);
    try {
      await api.runJob(job);

      // Poll stats every 2s until they change (job output visible) or timeout
      const timeouts: Record<string, number> = {
        ingest: 90000, score: 45000, generate: 60000, schedule: 20000, post: 20000, analyze: 20000,
      };
      const deadline = Date.now() + (timeouts[job] ?? 45000);
      const snap = await api.getStats();   // baseline before job runs
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2500));
        const fresh = await api.getStats();
        if (JSON.stringify(fresh) !== JSON.stringify(snap)) break;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Job failed');
    } finally {
      setBusy(null);
    }
  };

  const handleToggleTheme = (t: 'light'|'dark') => {
    setTheme(t);
    document.documentElement.dataset.theme = t;
  };

  const currentPage = pages.find(p => p.id===activePage) ?? pages[0];

  // Show loading screen while pages haven't loaded yet
  if (!currentPage) {
    return (
      <div style={{ display:'flex', flex:1, alignItems:'center', justifyContent:'center',
        height:'100vh', background:'var(--bg-base)', flexDirection:'column', gap:12 }}>
        <div style={{ width:32, height:32, border:'3px solid var(--border)',
          borderTopColor:'var(--accent)', borderRadius:'50%',
          animation:'spin 0.8s linear infinite' }}/>
        <div style={{ fontSize:13, color:'var(--text-muted)' }}>Loading pages…</div>
        <style>{`@keyframes spin { to { transform:rotate(360deg) } }`}</style>
      </div>
    );
  }

  return (
    <>
      {/* Error toast */}
      {error && (
        <div style={{ position:'fixed', top:16, right:16, zIndex:9999,
          background:'var(--red)', color:'#fff', padding:'10px 16px',
          borderRadius:'var(--radius-sm)', fontSize:13, boxShadow:'var(--shadow-lg)',
          display:'flex', gap:8, alignItems:'center' }}>
          {error}
          <button onClick={() => setError(null)}
            style={{ background:'none', border:'none', color:'#fff', cursor:'pointer', padding:0, fontSize:14 }}>✕</button>
        </div>
      )}

      <div id="app-shell" style={{ display:'flex', flex:1, overflow:'hidden' }}>
        <Sidebar
          activeNav={activeNav} setActiveNav={nav => { closeEditor(); setActiveNav(nav); }}
          activePage={activePage} setActivePage={setActivePage}
          pages={pages} onNewPage={() => setShowCreate(true)}
          theme={theme} setTheme={handleToggleTheme}
        />

        <div className="main">
          {/* Editor takes over the main area when a topic is open */}
          {editingTopic ? (
            <ContentEditor
              topic={editingTopic}
              page={currentPage}
              sourceNav={editorSource}
              onBack={closeEditor}
            />
          ) : (
            <>
              {activeNav==='dashboard' && (
                <DashboardView page={currentPage} topics={topics} stats={stats}
                  busy={busy} onOpenEditor={openEditor} onRunJob={runJob}/>
              )}
              {activeNav==='pipeline' && (
                <PipelineView topics={topics} stats={stats} busy={busy}
                  onOpenEditor={openEditor} onRunJob={runJob}/>
              )}
              {activeNav==='scheduler' && <SchedulerView page={currentPage}/>}
              {activeNav==='analytics' && <AnalyticsView page={currentPage}/>}
              {activeNav==='settings'  && <SettingsView/>}
            </>
          )}
        </div>
      </div>

      {showCreate && (
        <CreatePageModal
          onClose={() => setShowCreate(false)}
          onCreate={newPage => {
            const id = 'tp' + (pages.length + 1);
            const full: ThemePage = { ...newPage, id };
            setPages(p => [...p, full]);
            setActivePage(id);
          }}
        />
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App/>);
