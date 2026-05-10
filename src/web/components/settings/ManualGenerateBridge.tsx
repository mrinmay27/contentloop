import React, { useEffect, useRef, useState } from 'react';

// ── Module-level paste router ─────────────────────────────────────────────────
// Only ONE slide is the "active paste target" at a time — whichever the user
// most recently clicked "Generate" for (or clicked the drop zone to focus).
// This prevents multiple carousel slides from all receiving the same Cmd+V.
let _activeOnImage: ((dataUrl: string) => void) | null = null;
let _activeTimeout: ReturnType<typeof setTimeout> | null = null;

function setActivePasteTarget(onImage: (dataUrl: string) => void, durationMs = 45_000) {
  if (_activeTimeout) clearTimeout(_activeTimeout);
  _activeOnImage = onImage;
  _activeTimeout = setTimeout(() => { _activeOnImage = null; }, durationMs);
}
function clearActivePasteTarget() {
  if (_activeTimeout) clearTimeout(_activeTimeout);
  _activeOnImage = null;
}

// Register the single global paste listener once per page load
let _listenerRegistered = false;
function ensureGlobalPasteListener() {
  if (_listenerRegistered || typeof window === 'undefined') return;
  _listenerRegistered = true;
  window.addEventListener('paste', (e: ClipboardEvent) => {
    if (!_activeOnImage) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          const reader = new FileReader();
          const handler = _activeOnImage;   // capture before clearing
          clearActivePasteTarget();
          reader.onload = () => { handler(reader.result as string); };
          reader.readAsDataURL(blob);
          e.preventDefault();
        }
        break;
      }
    }
  });
}
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  prompt:     string;
  onImage:    (dataUrl: string) => void;
  draftReady?: boolean;   // false = draft still initialising, disable paste zone
}

interface CopiedState { label: string; needsManualPaste: boolean; }

export const ManualGenerateBridge: React.FC<Props> = ({ prompt, onImage, draftReady = true }) => {
  const [dragOver, setDragOver] = useState(false);
  const [copied,   setCopied]   = useState<CopiedState | null>(null);
  const [zoneActive, setZoneActive] = useState(false);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const enriched = `Generate a high-quality image: ${prompt.trim()}`;
  const disabled = !prompt.trim();
  const zoneDisabled = !draftReady;

  // Register the global listener once on first render
  useEffect(() => { ensureGlobalPasteListener(); }, []);

  const activate = (durationMs?: number) => {
    setActivePasteTarget(onImage, durationMs);
    setZoneActive(true);
  };

  const openIn = (url: string, label: string, needsManualPaste: boolean) => {
    if (disabled) return;
    navigator.clipboard?.writeText(enriched).catch(() => {});
    setCopied({ label, needsManualPaste });
    activate(45_000);
    setTimeout(() => { setCopied(null); setZoneActive(false); },
      needsManualPaste ? 45_000 : 30_000);
    window.open(url, '_blank', 'noopener');
  };

  const handleCopyPrompt = () => {
    if (disabled) return;
    navigator.clipboard?.writeText(enriched).catch(() => {});
    setCopied({ label: 'clipboard', needsManualPaste: false });
    setTimeout(() => setCopied(null), 2500);
  };

  const captureFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      onImage(reader.result as string);
      setCopied(null);
      setZoneActive(false);
      clearActivePasteTarget();
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) captureFile(file);
  };

  // When drop zone is clicked/focused → become the active paste target
  const handleZoneFocus = () => { activate(60_000); setZoneActive(true); };
  const handleZoneBlur  = () => { setZoneActive(false); };

  // Allow paste directly on the focused drop zone div
  const handleZonePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) { captureFile(blob); e.preventDefault(); }
        break;
      }
    }
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 10px' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        <span style={{ fontSize: 10, color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
          Or use your subscriptions — no API cost
        </span>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button className="btn btn-ghost btn-sm" disabled={disabled}
          title="Opens ChatGPT with prompt pre-filled and auto-submitted"
          style={{ flex: 1, fontSize: 11 }}
          onClick={() => openIn(
            `https://chatgpt.com/?q=${encodeURIComponent(enriched)}`,
            'ChatGPT', false
          )}>
          🟢 Generate in ChatGPT
        </button>
        <button className="btn btn-ghost btn-sm" disabled={disabled}
          title="Opens Gemini and copies prompt — paste with Cmd+V into its input"
          style={{ flex: 1, fontSize: 11 }}
          onClick={() => openIn(
            `https://gemini.google.com/app?q=${encodeURIComponent(enriched)}`,
            'Gemini', true
          )}>
          🔵 Open Gemini + Copy Prompt
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button className="btn btn-ghost btn-sm" disabled={disabled}
          style={{ fontSize: 10, padding: '4px 10px' }} onClick={handleCopyPrompt}>
          📋 Copy prompt only
        </button>
      </div>

      {copied && copied.needsManualPaste && (
        <div style={{
          fontSize: 11, padding: '10px 12px', marginBottom: 8, lineHeight: 1.6,
          background:   'color-mix(in srgb, var(--accent) 10%, transparent)',
          border:       '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
          borderRadius: 'var(--radius-sm)',
          color:        'var(--text-primary)',
        }}>
          <strong style={{ color: 'var(--accent)' }}>📋 Prompt copied to clipboard</strong><br />
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Gemini doesn't auto-fill prompts. In the new tab, click its input box and press
            {' '}<kbd style={{ padding: '1px 5px', background: 'var(--bg-elevated)', borderRadius: 3,
              border: '1px solid var(--border)', fontSize: 9 }}>⌘V</kbd>
            {' '}to paste, then Enter. After it generates, right-click the image → Copy image → come back here.
          </span>
        </div>
      )}

      {copied && !copied.needsManualPaste && copied.label !== 'clipboard' && (
        <div style={{ fontSize: 10, color: 'var(--green)', marginBottom: 6, lineHeight: 1.5 }}>
          ✓ Sent to {copied.label} — wait for the image, right-click → Copy image → come back here and ⌘V
        </div>
      )}

      {copied?.label === 'clipboard' && (
        <div style={{ fontSize: 10, color: 'var(--green)', marginBottom: 6 }}>
          ✓ Prompt copied
        </div>
      )}

      <div
        ref={dropZoneRef}
        tabIndex={zoneDisabled ? -1 : 0}
        onFocus={zoneDisabled ? undefined : handleZoneFocus}
        onBlur={handleZoneBlur}
        onPaste={zoneDisabled ? undefined : handleZonePaste}
        onDragOver={zoneDisabled ? undefined : (e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={zoneDisabled ? undefined : () => setDragOver(false)}
        onDrop={zoneDisabled ? undefined : handleDrop}
        onClick={zoneDisabled ? undefined : () => dropZoneRef.current?.focus()}
        style={{
          padding: '14px 14px',
          textAlign: 'center',
          border: `1.5px dashed ${zoneDisabled ? 'var(--border)' : dragOver || zoneActive ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-sm)',
          background: zoneDisabled
            ? 'var(--bg-base)'
            : dragOver || zoneActive
              ? 'color-mix(in srgb, var(--accent) 8%, transparent)'
              : 'color-mix(in srgb, var(--bg-elevated) 50%, transparent)',
          fontSize: 11,
          color: zoneDisabled ? 'var(--text-muted)' : 'var(--text-muted)',
          lineHeight: 1.7,
          transition: 'all 0.15s ease',
          outline: zoneActive ? '2px solid color-mix(in srgb, var(--accent) 40%, transparent)' : 'none',
          cursor: zoneDisabled ? 'not-allowed' : 'pointer',
          opacity: zoneDisabled ? 0.5 : 1,
        }}
      >
        {zoneDisabled ? (
          <>
            ⏳ <strong style={{ color: 'var(--text-secondary)' }}>Initialising draft…</strong>
            <br />
            <span style={{ fontSize: 10, opacity: 0.7 }}>Paste will be ready in a moment</span>
          </>
        ) : (
          <>
            📋 <strong style={{ color: 'var(--text-primary)' }}>Paste image</strong>
            {zoneActive
              ? <span style={{ color: 'var(--accent)', fontWeight: 700 }}> — ⌘V now!</span>
              : <span> (⌘V) or <strong style={{ color: 'var(--text-primary)' }}>drag & drop</strong></span>
            }
            <br />
            <span style={{ fontSize: 10, opacity: 0.75 }}>
              {zoneActive
                ? 'Listening for paste — come back from ChatGPT/Gemini and ⌘V'
                : 'In ChatGPT/Gemini: right-click the generated image → Copy image → return here'
              }
            </span>
          </>
        )}
      </div>
    </div>
  );
};
