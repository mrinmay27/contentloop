import React, { useEffect, useState } from 'react';

interface Props {
  prompt:  string;
  onImage: (dataUrl: string) => void;
}

export const ManualGenerateBridge: React.FC<Props> = ({ prompt, onImage }) => {
  const [dragOver, setDragOver] = useState(false);
  const [copied,   setCopied]   = useState<string | null>(null);

  const enriched = `Generate a high-quality image: ${prompt.trim()}`;
  const disabled = !prompt.trim();

  const openIn = (url: string, label: string) => {
    if (disabled) return;
    navigator.clipboard?.writeText(enriched).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied(null), 3500);
    window.open(url, '_blank', 'noopener');
  };

  const captureFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => onImage(reader.result as string);
    reader.readAsDataURL(file);
  };

  // Global paste listener while mounted — user can Cmd+V anywhere on the page
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
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
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onImage]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) captureFile(file);
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
          style={{ flex: 1, fontSize: 11 }}
          onClick={() => openIn(
            `https://chatgpt.com/?q=${encodeURIComponent(enriched)}`,
            'ChatGPT'
          )}>
          🟢 Generate in ChatGPT
        </button>
        <button className="btn btn-ghost btn-sm" disabled={disabled}
          style={{ flex: 1, fontSize: 11 }}
          onClick={() => openIn(
            `https://gemini.google.com/app?q=${encodeURIComponent(enriched)}`,
            'Gemini'
          )}>
          🔵 Generate in Gemini
        </button>
      </div>

      {copied && (
        <div style={{ fontSize: 10, color: 'var(--green)', marginBottom: 6, lineHeight: 1.5 }}>
          ✓ Prompt copied to clipboard — paste it in {copied} if it didn't auto-fill,
          then bring the generated image back here
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{
          padding: '14px 14px',
          textAlign: 'center',
          border: `1.5px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-sm)',
          background: dragOver
            ? 'color-mix(in srgb, var(--accent) 8%, transparent)'
            : 'color-mix(in srgb, var(--bg-elevated) 50%, transparent)',
          fontSize: 11,
          color: 'var(--text-muted)',
          lineHeight: 1.7,
          transition: 'all 0.15s ease',
        }}
      >
        📋 <strong style={{ color: 'var(--text-primary)' }}>Paste image</strong> (Cmd+V anywhere)
        {' '}or <strong style={{ color: 'var(--text-primary)' }}>drag & drop</strong>
        <br />
        <span style={{ fontSize: 10, opacity: 0.75 }}>
          In ChatGPT/Gemini: right-click the image → Copy image → return here
        </span>
      </div>
    </div>
  );
};
