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
/** Remembered as the default for the next page created. A UI preference, not
 *  server state — the authoritative value lives on each page's brand record. */
export const DISCOVERY_DEFAULT_KEY = 'contentloop_discovery_default';

export const WelcomeScreen: React.FC<{ onCreate: () => void }> = ({ onCreate }) => {
  const [mode, setMode] = React.useState<'auto' | 'manual'>(
    () => (localStorage.getItem(DISCOVERY_DEFAULT_KEY) === 'manual' ? 'manual' : 'auto')
  );
  const choose = (next: 'auto' | 'manual') => {
    setMode(next);
    localStorage.setItem(DISCOVERY_DEFAULT_KEY, next);
  };

  return (
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
    <div style={{ marginTop: 22, maxWidth: 520, width: '100%' }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
        Where do your topics come from?
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {([
          ['auto', 'Find them for me', 'ContentLoop watches your sources, scores what’s worth writing about, and drafts it. You approve.'],
          ['manual', 'I’ll add them myself', 'Just the editor, scheduler and publisher. Add topics with + whenever you have an idea.'],
        ] as const).map(([id, label, blurb]) => (
          <button key={id} onClick={() => choose(id)}
            style={{
              flex: 1, textAlign: 'left', cursor: 'pointer', padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${mode === id ? 'var(--accent)' : 'var(--border)'}`,
              background: mode === id ? 'var(--accent-dim)' : 'var(--bg-elevated)',
              color: 'var(--text-primary)',
            }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>
              {label}{id === 'auto' && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}> · recommended</span>}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.45 }}>{blurb}</div>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
        You can change this per page at any time in Settings → Sources.
      </div>
    </div>

    <div style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.75, marginTop: 16, maxWidth: 420, lineHeight: 1.6 }}>
      Everything runs on your computer. You can add AI keys later in Settings —
      ContentLoop works without them.
    </div>
  </div>
  );
};
