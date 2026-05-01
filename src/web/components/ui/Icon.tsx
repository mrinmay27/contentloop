import React from 'react';

type IconName =
  | 'dashboard' | 'pipeline' | 'scheduler' | 'analytics' | 'settings'
  | 'plus' | 'check' | 'x' | 'chevronRight' | 'chevronLeft' | 'chevronDown'
  | 'refresh' | 'upload' | 'send' | 'edit' | 'trash' | 'link' | 'dots'
  | 'moon' | 'sun' | 'search' | 'filter' | 'instagram' | 'canva' | 'arrow-left';

const paths: Record<IconName, React.ReactElement> = {
  dashboard:    <><rect x="1" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity=".7"/><rect x="9" y="1" width="6" height="6" rx="1.5" fill="currentColor" opacity=".7"/><rect x="1" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".7"/><rect x="9" y="9" width="6" height="6" rx="1.5" fill="currentColor" opacity=".7"/></>,
  pipeline:     <path d="M2 4h12M2 8h10M2 12h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>,
  scheduler:    <><rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M5 1v4M11 1v4M2 7h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></>,
  analytics:    <path d="M2 13L6 8l3 3 3-4 2-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>,
  settings:     <><circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.53 11.53l1.42 1.42M3.05 12.95l1.42-1.42M11.53 4.47l1.42-1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></>,
  plus:         <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>,
  check:        <path d="M3 8l4 4 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>,
  x:            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>,
  chevronRight: <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>,
  chevronLeft:  <path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>,
  chevronDown:  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>,
  refresh:      <><path d="M2.5 8a5.5 5.5 0 1 0 1.1-3.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><polyline points="2.5,2 2.5,5.5 6,5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></>,
  upload:       <><path d="M8 11V5M5 7l3-3 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 13h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></>,
  send:         <path d="M14 2L7 9M14 2L9 14l-2-5-5-2 12-5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>,
  edit:         <path d="M11 2l3 3-8 8H3v-3l8-8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>,
  trash:        <path d="M3 4h10M6 4V3h4v1M5 4l1 9h4l1-9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>,
  link:         <><path d="M6.5 9.5a3.5 3.5 0 005 0l2-2a3.5 3.5 0 00-5-5L7 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M9.5 6.5a3.5 3.5 0 00-5 0l-2 2a3.5 3.5 0 005 5L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></>,
  dots:         <><circle cx="4" cy="8" r="1.5" fill="currentColor"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><circle cx="12" cy="8" r="1.5" fill="currentColor"/></>,
  moon:         <path d="M13 10a6 6 0 01-7.5-7.5A6 6 0 1013 10z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>,
  sun:          <><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.53 11.53l1.42 1.42M3.05 12.95l1.42-1.42M11.53 4.47l1.42-1.42" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>,
  search:       <><circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.5"/><path d="M13 13l-3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></>,
  filter:       <path d="M2 4h12M5 8h6M7 12h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>,
  instagram:    <><rect x="2" y="2" width="12" height="12" rx="3" stroke="currentColor" strokeWidth="1.4"/><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4"/><circle cx="11.5" cy="4.5" r="0.8" fill="currentColor"/></>,
  canva:        <><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4"/><path d="M5.5 5.5C6 7 8 8 8 8s2-1 2.5-2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M8 8v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></>,
  'arrow-left': <path d="M11 8H5M5 8l3-3M5 8l3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>,
};

export const Icon: React.FC<{ name: IconName; size?: number }> = ({ name, size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
    {paths[name] ?? <circle cx="8" cy="8" r="4" fill="currentColor" opacity=".3"/>}
  </svg>
);
