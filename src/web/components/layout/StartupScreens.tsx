import React from 'react';

/**
 * Full-screen states shown before the main UI is usable. See
 * lib/startupView.ts for which one renders when.
 */

const shell: React.CSSProperties = {
  display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center',
  height: '100vh', background: 'var(--bg-base)', flexDirection: 'column',
  gap: 14, padding: 24, textAlign: 'center',
};

export const LoadingScreen: React.FC = () => (
  <div style={shell}>
    <div style={{ width: 32, height: 32, border: '3px solid var(--border)',
      borderTopColor: 'var(--accent)', borderRadius: '50%',
      animation: 'spin 0.8s linear infinite' }}/>
    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>
    <style>{`@keyframes spin { to { transform:rotate(360deg) } }`}</style>
  </div>
);

/**
 * Shown when /api/pages could not be reached. The overwhelmingly common cause
 * is that the ContentLoop window was closed (or never finished starting), so
 * the copy says that in plain language instead of showing a fetch error.
 */
export const ErrorScreen: React.FC<{ message: string | null; onRetry: () => void }> = ({
  message, onRetry,
}) => (
  <div style={shell}>
    <img src="/mark.png" alt="" width={44} height={44} style={{ opacity: 0.5 }}/>
    <div style={{ fontSize: 17, fontWeight: 700 }}>Can’t reach ContentLoop</div>
    <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 420, lineHeight: 1.6 }}>
      The app isn’t responding. This usually means the ContentLoop window was
      closed. Start it again, then click Retry.
    </div>
    <button className="btn btn-primary btn-sm" onClick={onRetry} style={{ marginTop: 4 }}>
      Retry
    </button>
    {message && (
      <div style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.7, marginTop: 6 }}>
        {message}
      </div>
    )}
  </div>
);

/**
 * First-run state: the API answered, there are simply no theme pages yet.
 * This is every new user's first screen, so it has exactly one action.
 */
export const WelcomeScreen: React.FC<{ onCreate: () => void }> = ({ onCreate }) => (
  <div style={shell}>
    <img src="/mark.png" alt="" width={56} height={56}/>
    <div style={{ fontSize: 21, fontWeight: 700, marginTop: 2 }}>Welcome to ContentLoop</div>
    <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 440, lineHeight: 1.65 }}>
      A theme page is one account you create content for — its niche decides
      what ContentLoop goes looking for, scores and drafts. Create your first
      one to get started.
    </div>
    <button className="btn btn-primary" onClick={onCreate} style={{ marginTop: 6 }}>
      Create your first theme page
    </button>
    <div style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.75, marginTop: 10, maxWidth: 420, lineHeight: 1.6 }}>
      Everything runs on your computer. You can add AI keys later in Settings —
      ContentLoop works without them.
    </div>
  </div>
);
