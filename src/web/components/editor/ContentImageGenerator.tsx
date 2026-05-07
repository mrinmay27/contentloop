import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ManualGenerateBridge } from '../settings/ManualGenerateBridge';

interface Props {
  contentId:    string | null;     // null = draft not yet created (component will be disabled)
  slideIndex:   number;            // 0 for posts, 0..N-1 for carousel slides
  defaultPrompt: string;           // auto-built from brand + topic + (slide text)
  initialUrl?:  string | null;     // pre-existing image URL from content_items.payload.images[i].url
  label?:       string;            // optional section label (e.g. "Slide 1 image")
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

  // Auto-refresh prompt when defaults change (brand/topic update) unless user edited it
  useEffect(() => {
    if (!promptEdited) setPrompt(defaultPrompt);
  }, [defaultPrompt, promptEdited]);

  // Sync incoming saved URL when contentId/slide changes upstream
  useEffect(() => {
    setImageUrl(initialUrl ?? '');
  }, [initialUrl]);

  const handleImage = async (dataUrl: string) => {
    if (!contentId) {
      setError('Content draft not ready yet — try again in a moment');
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

  const handleResetPrompt = () => { setPrompt(defaultPrompt); setPromptEdited(false); };

  return (
    <div style={{ marginTop: 16, padding: 14,
      border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
      background: 'var(--bg-elevated)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>
          🖼️ {label ?? 'Image'}
        </span>
        {imageUrl && (
          <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 600 }}>
            ● Saved
          </span>
        )}
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

      <ManualGenerateBridge prompt={prompt} onImage={handleImage} />

      {uploading && (
        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)' }}>⏳ Uploading…</div>
      )}
      {error && (
        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--red)' }}>{error}</div>
      )}

      {imageUrl && (
        <div style={{ marginTop: 10 }}>
          <img src={imageUrl} alt={label ?? 'Generated'}
            style={{ width: '100%', maxHeight: 240, objectFit: 'contain',
              background: '#fff', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)' }} />
        </div>
      )}
    </div>
  );
};
