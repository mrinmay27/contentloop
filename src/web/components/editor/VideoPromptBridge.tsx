import React, { useState } from 'react';
import { buildVideoPrompt, VIDEO_TOOLS, toolUrl } from '../../../domain/videoPrompt';

/**
 * Route 4a — generate a clip on a subscription the creator already pays for,
 * then bring it back. Mirrors ManualGenerateBridge (images) deliberately, with
 * one critical difference: there is no clipboard return path, because a
 * browser cannot put a video on the clipboard. The clip is downloaded and
 * dropped into the uploader directly below this panel.
 */

type Props = {
  topic: string;
  niche?: string;
  /** Disabled until the draft exists, matching the uploader below. */
  disabled?: boolean;
};

export const VideoPromptBridge: React.FC<Props> = ({ topic, niche, disabled = false }) => {
  const [open, setOpen]         = useState(false);
  const [seconds, setSeconds]   = useState(8);
  const [scene, setScene]       = useState('');
  const [copied, setCopied]     = useState<string | null>(null);

  const prompt = buildVideoPrompt({ topic, niche, durationSec: seconds, sceneHint: scene });

  const openTool = (id: string) => {
    const tool = VIDEO_TOOLS.find(t => t.id === id);
    if (!tool || disabled) return;
    // Copy first, always — it is the only step that works everywhere, and the
    // fallback when a tool ignores the query parameter.
    navigator.clipboard?.writeText(prompt).catch(() => {});
    setCopied(tool.label);
    setTimeout(() => setCopied(null), 6000);
    window.open(toolUrl(tool, prompt), '_blank', 'noopener');
  };

  if (!open) {
    return (
      <button className="btn btn-ghost btn-sm" disabled={disabled}
        style={{ fontSize: 11, marginBottom: 10 }}
        onClick={() => setOpen(true)}>
        ✨ Generate a clip with AI instead
      </button>
    );
  }

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
      padding: 12, marginBottom: 12, background: 'var(--bg-elevated)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>Generate with AI</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          uses your own subscription — no API cost
        </span>
        <button className="btn-icon" style={{ marginLeft: 'auto', fontSize: 11 }}
          onClick={() => setOpen(false)}>✕</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex',
          alignItems: 'center', gap: 6 }}>
          Length
          <input type="number" min={2} max={60} value={seconds}
            onChange={e => setSeconds(Math.max(2, Number(e.target.value) || 8))}
            style={{ width: 60 }}/>
          s
        </label>
        <input type="text" placeholder="Optional: describe the shot" value={scene}
          onChange={e => setScene(e.target.value)}
          style={{ flex: 1, fontSize: 11 }}/>
      </div>

      <textarea readOnly value={prompt} rows={4}
        style={{ width: '100%', fontSize: 10, fontFamily: 'var(--mono)', marginBottom: 8 }}/>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {VIDEO_TOOLS.map(tool => (
          <button key={tool.id} className="btn btn-ghost btn-sm" disabled={disabled}
            title={tool.note} style={{ fontSize: 10 }}
            onClick={() => openTool(tool.id)}>
            {tool.emoji} {tool.label}
          </button>
        ))}
        <button className="btn btn-ghost btn-sm" disabled={disabled} style={{ fontSize: 10 }}
          onClick={() => {
            navigator.clipboard?.writeText(prompt).catch(() => {});
            setCopied('clipboard');
            setTimeout(() => setCopied(null), 2500);
          }}>
          📋 Copy prompt
        </button>
      </div>

      {copied && copied !== 'clipboard' && (
        <div style={{
          fontSize: 11, lineHeight: 1.6, padding: '8px 10px',
          background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
          borderRadius: 'var(--radius-sm)',
        }}>
          <strong style={{ color: 'var(--accent)' }}>Prompt copied — {copied} opened</strong><br/>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Generate the clip there, <strong>download it</strong>, then drop it into the
            box below. Video can’t be pasted from the clipboard, so it has to come
            back as a file.
          </span>
        </div>
      )}
      {copied === 'clipboard' && (
        <div style={{ fontSize: 10, color: 'var(--green)' }}>✓ Copied to clipboard</div>
      )}
    </div>
  );
};
