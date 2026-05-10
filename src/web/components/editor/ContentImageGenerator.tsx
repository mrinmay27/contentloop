import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { ManualGenerateBridge } from '../settings/ManualGenerateBridge';

interface Props {
  contentId:    string | null;
  slideIndex:   number;
  defaultPrompt: string;
  initialUrl?:  string | null;
  label?:       string;
  onSaved?:     (url: string) => void;
}

export const ContentImageGenerator: React.FC<Props> = ({
  contentId, slideIndex, defaultPrompt, initialUrl, label, onSaved,
}) => {
  const [prompt,       setPrompt]       = useState(defaultPrompt);
  const [promptEdited, setPromptEdited] = useState(false);
  const [imageUrl,     setImageUrl]     = useState<string>(initialUrl ?? '');
  const [uploading,    setUploading]    = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const lightboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!promptEdited) setPrompt(defaultPrompt);
  }, [defaultPrompt, promptEdited]);

  useEffect(() => {
    setImageUrl(initialUrl ?? '');
  }, [initialUrl]);

  // Escape key closes lightbox
  useEffect(() => {
    if (!lightboxOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxOpen]);

  const handleImage = async (dataUrl: string) => {
    if (!contentId) {
      // Draft hasn't initialised yet — show a brief inline hint, don't block the UI
      setError('Draft still loading — wait a second and paste again');
      setTimeout(() => setError(null), 4000);
      return;
    }
    setUploading(true); setError(null);
    try {
      const { url } = await api.uploadContentImage(contentId, {
        dataUrl, slideIndex, source: 'manual-paste', prompt: prompt.trim(),
      });
      setImageUrl(url);
      onSaved?.(url);
    } catch (err: any) {
      setError(err?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleClear = () => {
    setImageUrl('');
    onSaved?.('');
  };

  const handleResetPrompt = () => { setPrompt(defaultPrompt); setPromptEdited(false); };

  return (
    <>
      {/* Lightbox */}
      {lightboxOpen && (
        <div
          ref={lightboxRef}
          onClick={(e) => { if (e.target === lightboxRef.current) setLightboxOpen(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 99999,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <img src={imageUrl} alt={label ?? 'Generated'}
              style={{ maxWidth: '90vw', maxHeight: '86vh', objectFit: 'contain',
                borderRadius: 'var(--radius)', display: 'block' }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 10 }}>
              <a href={imageUrl} download={`${(label ?? 'image').replace(/\s+/g, '-').toLowerCase()}.jpg`}
                style={{ fontSize: 12, color: '#fff', textDecoration: 'none',
                  padding: '4px 14px', borderRadius: 6,
                  background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)' }}>
                ↓ Download
              </a>
              <button onClick={() => setLightboxOpen(false)}
                style={{ fontSize: 12, color: '#fff', cursor: 'pointer',
                  padding: '4px 14px', borderRadius: 6,
                  background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)' }}>
                ✕ Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, padding: 14,
        border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-elevated)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>
            🖼️ {label ?? 'Image'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {imageUrl && (
              <>
                <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>● Saved</span>
                <button onClick={() => setLightboxOpen(true)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 10, color: 'var(--accent)', padding: 0, fontWeight: 600 }}>
                  👁 Full size
                </button>
                <button onClick={handleClear}
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 10, color: 'var(--red, #ef4444)', padding: 0, fontWeight: 600 }}>
                  ✕ Clear
                </button>
              </>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Prompt {promptEdited && <span style={{ color: 'var(--accent)' }}>(edited)</span>}
          </label>
          {promptEdited && (
            <button onClick={handleResetPrompt}
              style={{ background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 9, color: 'var(--text-muted)', padding: 0 }}>
              ↺ Reset to auto
            </button>
          )}
        </div>
        <textarea
          value={prompt}
          onChange={(e) => { setPrompt(e.target.value); setPromptEdited(true); }}
          rows={2}
          style={{ width: '100%', fontSize: 11, resize: 'vertical', boxSizing: 'border-box' }}
        />

        <ManualGenerateBridge prompt={prompt} onImage={handleImage} draftReady={!!contentId} />

        {uploading && (
          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)' }}>⏳ Uploading…</div>
        )}
        {error && (
          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--red)' }}>{error}</div>
        )}

        {imageUrl && (
          // Padding-top 100% forces a square container — prevents any clipping of square images
          <div
            onClick={() => setLightboxOpen(true)}
            style={{
              marginTop: 10, cursor: 'zoom-in',
              position: 'relative', paddingTop: '100%',
              borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
              overflow: 'hidden', background: '#000',
            }}
          >
            <img src={imageUrl} alt={label ?? 'Generated'}
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'contain',
                display: 'block',
              }} />
          </div>
        )}
      </div>
    </>
  );
};
