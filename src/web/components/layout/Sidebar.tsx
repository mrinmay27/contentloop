import React from 'react';
import { Icon } from '../ui/Icon';
import type { ThemePage, NavKey } from '../../lib/types';

type SidebarProps = {
  activeNav: NavKey;
  setActiveNav: (k: NavKey) => void;
  activePage: string;
  setActivePage: (id: string) => void;
  pages: ThemePage[];
  onNewPage: () => void;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
};

const NAV_ITEMS: { key: NavKey; icon: any; label: string; kbd: string }[] = [
  { key: 'dashboard', icon: 'dashboard', label: 'Dashboard', kbd: '⌘1' },
  { key: 'pipeline',  icon: 'pipeline',  label: 'Pipeline',  kbd: '⌘2' },
  { key: 'scheduler', icon: 'scheduler', label: 'Scheduler', kbd: '⌘3' },
  { key: 'analytics', icon: 'analytics', label: 'Analytics', kbd: '⌘4' },
  { key: 'settings',  icon: 'settings',  label: 'Settings',  kbd: '⌘,' },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeNav, setActiveNav, activePage, setActivePage, pages, onNewPage, theme, setTheme
}) => (
  <div className="sidebar">
    <div className="sidebar-logo">
      <div className="logo-mark">TC</div>
      <div>
        <div className="logo-text">TPCE</div>
        <div className="logo-sub">Content Engine</div>
      </div>
    </div>

    <nav className="sidebar-nav">
      {NAV_ITEMS.map(item => (
        <div
          key={item.key}
          className={`nav-item ${activeNav === item.key ? 'active' : ''}`}
          onClick={() => setActiveNav(item.key)}
        >
          <span className="nav-item-icon"><Icon name={item.icon} size={14}/></span>
          <span>{item.label}</span>
          <span className="nav-kbd"><kbd className="kbd">{item.kbd}</kbd></span>
        </div>
      ))}
    </nav>

    <div className="sidebar-pages">
      <div className="section-label" style={{ padding: '0 10px 6px' }}>Theme Pages</div>
      {pages.map(page => (
        <div
          key={page.id}
          className={`page-item ${activePage === page.id ? 'active' : ''}`}
          onClick={() => setActivePage(page.id)}
        >
          <div className="page-dot" style={{ background: page.accent }}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="page-name">{page.name}</div>
            <div className="page-niche">{page.niche}</div>
          </div>
          <span className={`badge ${page.status === 'active' ? 'badge-green' : 'badge-muted'}`}
            style={{ padding: '1px 5px', fontSize: 9 }}>
            {page.status === 'active' ? '●' : '○'} {page.status}
          </span>
        </div>
      ))}
      <button className="new-page-btn" onClick={onNewPage}>
        <Icon name="plus" size={12}/> New Theme Page
      </button>
    </div>

    <div style={{ padding: '8px', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>v1.0.0</span>
        <button
          className="btn-icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title="Toggle dark mode"
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14}/>
        </button>
      </div>
    </div>
  </div>
);
