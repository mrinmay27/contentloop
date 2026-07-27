import React, { useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import { api } from '../../lib/api';

/**
 * Route 2/3 — bring your own footage.
 *
 * Deliberately NOT modelled on ManualGenerateBridge's clipboard paste flow: a
 * browser can put an image on the clipboard but not a video, so the only
 * return paths are the file picker and drag-drop. The copy says "choose a
 * file" rather than implying Cmd+V works — a control that looks functional and
 * isn't is worse than no control.
 */

type Props = {
  contentId: string | null;
  accent?: string;
};

type Asset = {
  url: string; width: number; height: number;
  durationSec: number | null; bytes: number;
};

const fmtMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const VideoUploadPanel: React.FC<Props> = ({ contentId }) => {
  const [asset, setAsset]       = useState<Asset | null>(null);
  const [busy, setBusy]         = useState<'upload' | 'captions' | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [srt, setSrt]           = useState('');
  const [note, setNote]         = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const disabled = !contentId;

  const upload = async (file: File) => {
    if (!contentId) return;
    setError(null); setNote(null); setBusy('upload');
    try {
      const { asset: a } = await api.uploadContentVideo(contentId, file);
      setAsset(a);
    } catch (err) {
      // The server's messages are written to be read — show them verbatim
      // rather than replacing them with a generic failure.
      const raw = err instanceof Error ? err.message : 'Upload failed';
      try { setError(JSON.parse(raw).error ?? raw); } catch { setError(raw); }
    } finally {
      setBusy(null);
    }
  };

  const generateCaptions = async () => {
    if (!contentId) return;
    setError(null); setNote(null); setBusy('captions');
    try {
      const res = await api.transcribeContentVideo(contentId);
      if (res.srt === null) setNote(res.note ?? 'No transcription key configured — type captions below.');
      else setSrt(res.srt);
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Could not generate captions';
      try { setError(JSON.parse(raw).error ?? raw); } catch { setError(raw); }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ marginBottom: 18 }}>
      <div className="editor-section-title">Use your own video</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 10px', lineHeight: 1.6 }}>
        Upload footage you filmed and ContentLoop adds captions. Vertical (9:16),
        up to 3 minutes. Generated somewhere else? Download the file first, then
        choose it here.
      </div>

      {!asset ? (
        <div
          className="upload-zone"
          style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
            borderColor: dragOver ? 'var(--accent)' : undefined }}
          onClick={() => !disabled && inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); if (!disabled) setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault(); setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file && !disabled) upload(file);
          }}
        >
          <input ref={inputRef} type="file" accept="video/*" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }}/>
          <Icon name="upload" size={20}/>
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {busy === 'upload' ? 'Uploading…' : 'Choose a video or drop it here'}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>MP4, MOV or WebM</span>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <video src={asset.url} controls
            style={{ width: 150, borderRadius: 8, border: '1px solid var(--border)', background: '#000' }}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontFamily: 'var(--mono)' }}>
              {asset.width}×{asset.height}
              {asset.durationSec !== null && ` · ${asset.durationSec.toFixed(1)}s`}
              {` · ${fmtMb(asset.bytes)}`}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="btn btn-primary btn-sm" disabled={busy !== null}
                onClick={generateCaptions}>
                {busy === 'captions' ? 'Transcribing…' : 'Generate captions'}
              </button>
              <button className="btn btn-ghost btn-sm" disabled={busy !== null}
                onClick={() => { setAsset(null); setSrt(''); setNote(null); setError(null); }}>
                Replace
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 8, lineHeight: 1.5 }}>{error}</div>
      )}
      {note && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>{note}</div>
      )}

      {asset && (
        <div style={{ marginTop: 12 }}>
          <div className="editor-section-title" style={{ fontSize: 11 }}>Captions (SRT)</div>
          <textarea
            value={srt}
            onChange={e => setSrt(e.target.value)}
            rows={6}
            placeholder={'1\n00:00:00,000 --> 00:00:02,000\nYour caption here'}
            style={{ width: '100%', marginTop: 6, fontFamily: 'var(--mono)', fontSize: 11 }}
          />
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            Edit freely — this is what gets burned into the video.
          </div>
        </div>
      )}
    </div>
  );
};
