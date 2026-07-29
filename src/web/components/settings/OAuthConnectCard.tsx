/**
 * OAuthConnectCard — "Connect Account" card for OAuth-based integrations.
 *
 * Responsibilities:
 *   1. Show live connection status (fetched from API)
 *   2. Connect / Disconnect button
 *   3. Collapsible "Developer credentials" panel (just the fields, no step guide —
 *      the full step guide lives in the bottom SetupGuide, same as Reddit/Twitter)
 *
 * What this does NOT do:
 *   - Repeat the setup guide (already shown below by SetupGuide)
 */
import React, { useState, useEffect } from 'react';
import { Icon } from '../ui/Icon';

export type OAuthProvider = 'instagram' | 'youtube' | 'canva';

const PROVIDER_META: Record<OAuthProvider, {
  name:        string;
  emoji:       string;
  color:       string;
  tagline:     string;
  cost:        string;
  authPath:    string;
  statusPath:  string;
  disconnectPath: string;
}> = {
  instagram: {
    name:          'Instagram',
    emoji:         '📸',
    color:         '#E1306C',
    tagline:       'Post Reels, carousels, and feed posts directly to Instagram',
    cost:          'Free — uses your existing Instagram Business/Creator account',
    authPath:      '/auth/instagram',
    statusPath:    '/api/pages/:id/instagram/status',
    disconnectPath:'/api/pages/:id/instagram',
  },
  youtube: {
    name:          'YouTube',
    emoji:         '▶️',
    color:         '#FF0000',
    tagline:       'Upload Shorts and long-form videos to your YouTube channel',
    cost:          'Free — but the daily quota allows about 6 uploads per day',
    authPath:      '/auth/youtube',
    statusPath:    '/api/pages/:id/youtube/status',
    disconnectPath:'/api/pages/:id/youtube',
  },
  canva: {
    name:          'Canva',
    emoji:         '🖼️',
    color:         '#7D2AE8',
    tagline:       'Auto-fill brand templates and export finished designs for posts',
    cost:          'Free account works for browsing — template autofill needs Canva for Teams',
    authPath:      '/auth/canva',
    statusPath:    '/api/pages/:id/canva/status',
    disconnectPath:'/api/pages/:id/canva',
  },
};

type Status = {
  connected: boolean;
  username?: string | null;
  /** Authorised, but the account owns no channel — every upload would fail. */
  noChannel?: boolean;
};

// Every URL below is same-origin and relative on purpose. The port is not
// fixed — desktop mode defaults to 4173, the launcher picks a free port, and
// PORT overrides both — so an absolute http://localhost:4000 sent "Connect"
// to a server that isn't there.

type Props = {
  provider:        OAuthProvider;
  pageId:          string | null;
  onStatusChange?: (connected: boolean) => void;
};

export const OAuthConnectCard: React.FC<Props> = ({ provider, pageId, onStatusChange }) => {
  const meta = PROVIDER_META[provider];
  const [status,        setStatus]        = useState<Status | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const statusUrl     = pageId ? meta.statusPath.replace(':id', pageId) : null;
  const disconnectUrl = pageId ? meta.disconnectPath.replace(':id', pageId) : null;
  const connectUrl    = pageId ? `${meta.authPath}?pageId=${pageId}` : null;

  useEffect(() => {
    if (!statusUrl) return;
    fetch(statusUrl)
      .then(r => r.json())
      .then((data: Status) => setStatus(data))
      .catch(() => setStatus({ connected: false }));
  }, [statusUrl]);

  const handleConnect = () => {
    if (!connectUrl) return;
    window.location.href = connectUrl;
  };

  const handleDisconnect = async () => {
    if (!disconnectUrl || disconnecting) return;
    setDisconnecting(true);
    try {
      await fetch(disconnectUrl, { method: 'DELETE' });
      setStatus({ connected: false });
      onStatusChange?.(false);
    } finally {
      setDisconnecting(false);
    }
  };

  const connected = status?.connected ?? false;
  const noChannel = connected && status?.noChannel === true;

  return (
    <div style={{
      border: `1px solid ${noChannel ? 'var(--amber, #f59e0b)' : connected ? 'var(--green)' : 'var(--border)'}`,
      borderRadius: 'var(--radius)',
      padding: '18px 20px',
      background: noChannel ? '#f59e0b0d' : connected ? '#10b98108' : 'var(--bg-elevated)',
      marginBottom: 20,
      transition: 'border-color 0.2s, background 0.2s',
    }}>

      {/* Header row */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
        <span style={{ fontSize:28, flexShrink:0 }}>{meta.emoji}</span>
        <div style={{ flex:1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <span style={{ fontSize:15, fontWeight:700, color:'var(--text-primary)' }}>
              {meta.name}
            </span>
            {status === null
              ? <span style={{ fontSize:11, color:'var(--text-muted)' }}>Checking…</span>
              : noChannel
                ? <span className="badge badge-amber">Connected — no channel</span>
                : connected
                  ? <span className="badge badge-green badge-dot">Connected</span>
                  : <span className="badge badge-muted">Not connected</span>
            }
          </div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:3, lineHeight:1.5 }}>
            {meta.tagline}
          </div>
        </div>
      </div>

      {/* Signed in, but there is nothing to publish to. Worth stopping on:
          the upload would otherwise fail much later, on a scheduled post. */}
      {noChannel && (
        <div style={{
          padding:'10px 12px', marginBottom:12, fontSize:12.5, lineHeight:1.55,
          background:'#f59e0b14', border:'1px solid #f59e0b55',
          borderRadius:'var(--radius-sm)', color:'var(--text-primary)',
        }}>
          <strong>This Google account has no YouTube channel</strong>, so uploads
          would fail. Either create one at youtube.com (Settings → Create a channel),
          or Disconnect and reconnect signing in with the account that owns your
          channel. If your channel is a Brand Account, pick the channel itself on
          Google's account-chooser rather than your personal login.
        </div>
      )}

      {/* Connected: show @username */}
      {connected && status?.username && (
        <div style={{
          display:'flex', alignItems:'center', gap:8, padding:'8px 12px',
          background:'var(--bg-surface)', borderRadius:'var(--radius-sm)',
          fontSize:13, marginBottom:12,
        }}>
          <span style={{ color:'var(--green)', fontWeight:700 }}>✓</span>
          <strong style={{ color:'var(--text-primary)' }}>@{status.username}</strong>
          <span style={{ color:'var(--text-muted)' }}>— account linked</span>
        </div>
      )}

      {/* Cost badge */}
      <div style={{
        display:'inline-flex', alignItems:'center', gap:5,
        fontSize:11, color:'var(--text-muted)',
        background:'var(--bg-surface)', border:'1px solid var(--border)',
        borderRadius:20, padding:'3px 10px', marginBottom:14,
      }}>
        <span style={{ color:'var(--green)', fontWeight:700 }}>$0</span>
        {meta.cost}
      </div>

      {/* Primary action */}
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        {connected ? (
          <button
            className="btn btn-sm btn-ghost"
            onClick={handleDisconnect}
            disabled={disconnecting}
            style={{ color:'var(--red)', borderColor:'var(--red)' }}
          >
            <Icon name="x" size={11}/> {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : (
          <button
            className="btn btn-sm btn-primary"
            onClick={handleConnect}
            disabled={!pageId}
            style={{ background: meta.color, borderColor: meta.color }}
          >
            <Icon name="link" size={11}/> Connect {meta.name}
          </button>
        )}
        {!connected && !pageId && (
          <span style={{ fontSize:11, color:'var(--text-muted)' }}>
            Select a theme page first
          </span>
        )}
      </div>
    </div>
  );
};
