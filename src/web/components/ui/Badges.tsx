import React from 'react';

export const ScoreRing: React.FC<{ score: number; size?: number }> = ({ score, size = 36 }) => {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 85 ? 'var(--green)' : score >= 70 ? 'var(--accent)' : 'var(--red)';
  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--bg-hover)" strokeWidth="3"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="3"
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}/>
      <text x={size/2} y={size/2+4} textAnchor="middle" fontSize="9" fontWeight="700"
        fill={color} fontFamily="var(--mono)">{score}</text>
    </svg>
  );
};

export const PlatformBadge: React.FC<{ platform?: string }> = ({ platform }) => {
  const cfg: Record<string, { label: string; color: string }> = {
    reddit:             { label: 'Reddit',       color: '#FF4500' },
    twitter:            { label: 'X',            color: '#1DA1F2' },
    trends:             { label: 'Trends',       color: '#4285F4' },
    google_trends:      { label: 'Trends',       color: '#4285F4' },
    rss:                { label: 'RSS',          color: '#FFA500' },
    google_news:        { label: 'Google News',  color: '#4285F4' },
    medium:             { label: 'Medium',       color: '#00AB6C' },
    hacker_news:        { label: 'Hacker News',  color: '#FF6600' },
    devto:              { label: 'Dev.to',       color: '#3B49DF' },
    substack:           { label: 'Substack',     color: '#FF6719' },
    arxiv:              { label: 'arXiv',        color: '#B31B1B' },
    pubmed:             { label: 'PubMed',       color: '#0077CC' },
    exploding_topics:   { label: 'Exploding',    color: '#FF3366' },
    product_hunt:       { label: 'PH',           color: '#DA552F' },
    crypto_news:        { label: 'Crypto',       color: '#F7931A' },
    finance_newsletter: { label: 'Finance',      color: '#00B386' },
    youtube_trends:     { label: 'YouTube',      color: '#FF0000' },
  };
  const c = cfg[platform ?? ''] ?? { label: platform ?? '?', color: '#888' };
  return (
    <span className="source-icon" style={{ background: c.color + '22', color: c.color }}>
      {c.label}
    </span>
  );
};
