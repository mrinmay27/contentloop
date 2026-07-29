import React, { useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import { api } from '../../lib/api';
import { VideoPromptBridge } from './VideoPromptBridge';

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
  /** Used to build the AI-generation prompt (Route 4a). */
  topic?: string;
  niche?: string;
  /** When set, the clip becomes THIS slide's background rather than the whole
   *  reel, and the panel renders compactly. */
  slideIndex?: number;
  label?: string;
  /** Passed through to the AI bridge. */
  bridgeDefaultOpen?: boolean;
};

type Asset = {
  url: string; width: number; height: number;
  durationSec: number | null; bytes: number;
};

const fmtMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const VideoUploadPanel: React.FC<Props> = ({ contentId, topic, niche, slideIndex, label, bridgeDefaultOpen = true }) => {
  const [asset, setAsset]       = useState<Asset | null>(null);
  const [busy, setBusy]         = useState<'upload' | 'captions' | 'edit' | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [srt, setSrt]           = useState('');
  const [note, setNote]         = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // Trim / crop, shown once a clip is in place.
  const [editOpen, setEditOpen]   = useState(false);
  const [trimStart, setTrimStart] = useState('0');
  const [trimEnd, setTrimEnd]     = useState('');
  const [toVertical, setToVertical] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const disabled = !contentId;

  const upload = async (file: File) => {
    if (!contentId) return;
    setError(null); setNote(null); setBusy('upload');
    try {
      const { asset: a, warning } = await api.uploadContentVideo(contentId, file, slideIndex);
      setAsset(a);
      if (warning) {
        // Not an error — the clip is in, it just needs fixing before publish,
        // and the fix is one panel away.
        setNote(`${warning} Use Trim / crop below to fix it.`);
        setEditOpen(true);
        if (/vertical|9:16/i.test(warning)) setToVertical(true);
      }
    } catch (err) {
      // The server's messages are written to be read — show them verbatim
      // rather than replacing them with a generic failure.
      const raw = err instanceof Error ? err.message : 'Upload failed';
      try { setError(JSON.parse(raw).error ?? raw); } catch { setError(raw); }
    } finally {
      setBusy(null);
    }
  };

  const applyEdit = async () => {
    if (!contentId) return;
    setError(null); setNote(null); setBusy('edit');
    try {
      const r = await api.editContentVideo(contentId, {
        start: Number(trimStart) || 0,
        end: trimEnd.trim() === '' ? null : Number(trimEnd),
        toVertical,
        slideIndex: slideIndex ?? null,
      });
      setAsset(a => a ? {
        ...a, url: r.url,
        width: r.width ?? a.width, height: r.height ?? a.height,
        durationSec: r.durationSec ?? a.durationSec,
      } : a);
      setEditOpen(false);
      setNote('Edit applied.');
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Could not edit the video';
      try { setError(JSON.parse(raw).error ?? raw); } catch { setError(raw); }
    } finally { setBusy(null); }
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
      <div className="editor-section-title">{label ?? 'Use your own video'}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 10px', lineHeight: 1.6 }}>
        {slideIndex === undefined
          ? <>Upload footage you filmed and ContentLoop adds captions. Vertical (9:16),
              up to 3 minutes. Generated somewhere else? Download the file first, then
              choose it here.</>
          : <>A video clip to play behind this slide instead of a still image.</>}
      </div>

      {/* Route 4a — generate elsewhere, come back through the same drop zone. */}
      {!asset && topic && (
        <VideoPromptBridge topic={topic} niche={niche} disabled={disabled} defaultOpen={bridgeDefaultOpen}/>
      )}

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
              {slideIndex === undefined && (
                <button className="btn btn-primary btn-sm" disabled={busy !== null}
                  onClick={generateCaptions}>
                  {busy === 'captions' ? 'Transcribing…' : 'Generate captions'}
                </button>
              )}
              <button className="btn btn-ghost btn-sm" disabled={busy !== null}
                onClick={() => setEditOpen(o => !o)}>
                ✂️ Trim / crop
              </button>
              <button className="btn btn-ghost btn-sm" disabled={busy !== null}
                onClick={() => { setAsset(null); setSrt(''); setNote(null); setError(null); setEditOpen(false); }}>
                Replace
              </button>
            </div>
          </div>
        </div>
      )}

      {editOpen && asset && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
          padding: 12, marginTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Trim / crop</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex',
              alignItems: 'center', gap: 5 }}>
              From
              <input type="number" min={0} step={0.5} value={trimStart}
                onChange={e => setTrimStart(e.target.value)} style={{ width: 66 }}/>s
            </label>
            <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex',
              alignItems: 'center', gap: 5 }}>
              to
              <input type="number" min={0} step={0.5} value={trimEnd}
                placeholder={asset.durationSec ? asset.durationSec.toFixed(1) : 'end'}
                onChange={e => setTrimEnd(e.target.value)} style={{ width: 66 }}/>s
            </label>
            <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex',
              alignItems: 'center', gap: 5 }}>
              <input type="checkbox" checked={toVertical}
                onChange={e => setToVertical(e.target.checked)}/>
              Crop to vertical 9:16
            </label>
            <button className="btn btn-primary btn-sm" disabled={busy !== null}
              onClick={applyEdit} style={{ marginLeft: 'auto' }}>
              {busy === 'edit' ? 'Editing…' : 'Apply'}
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
            This replaces the clip you uploaded. Leave the end blank to keep it to the end.
          </div>
        </div>
      )}

      {error && (
        <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 8, lineHeight: 1.5 }}>
          {error}
        </div>
      )}
      {note && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>{note}</div>
      )}

      {asset && slideIndex === undefined && (
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
