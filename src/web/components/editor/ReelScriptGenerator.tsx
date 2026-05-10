import React, { useRef, useState } from 'react';
import { api } from '../../lib/api';

interface Props {
  topic:      string;
  niche?:     string;
  handle?:    string;
  onScript:   (script: string) => void;   // called when a script is ready to fill
}

// Build the browser-tab prompt (same text sent to API — consistent output format)
function buildScriptPrompt(topic: string, niche?: string, handle?: string): string {
  const bare = handle?.replace(/^@+/, '');   // strip any leading @ — we add exactly one
  const cta = bare
    ? `Follow @${bare} for daily ${niche ?? 'content'} breakdowns.`
    : `Follow for more daily ${niche ?? 'content'} insights.`;
  return [
    `Write a 5-slide short-form video script (Instagram Reel / YouTube Shorts) about:`,
    `"${topic}"`,
    ``,
    `Rules:`,
    `• Slide 1: Hook — bold claim, surprising stat, or provocative question`,
    `• Slides 2–4: Key insights or tips — 1–2 punchy sentences each, no filler`,
    `• Slide 5: CTA — "${cta}"`,
    `• Tone: educational, conversational, high-retention`,
    ``,
    `Output ONLY the slide text. Separate each slide with a blank line. No labels, no numbering.`,
  ].join('\n');
}

export const ReelScriptGenerator: React.FC<Props> = ({ topic, niche, handle, onScript }) => {
  const [generating, setGenerating] = useState(false);
  const [apiError,   setApiError]   = useState<string | null>(null);
  const [apiModel,   setApiModel]   = useState<string | null>(null);
  const [copied,     setCopied]     = useState<string | null>(null);   // which platform
  const [pasting,    setPasting]    = useState(false);
  const pasteZoneRef = useRef<HTMLTextAreaElement>(null);

  const prompt = buildScriptPrompt(topic, niche, handle);

  // ── API generate ──────────────────────────────────────────────────────────
  const handleGenerateViaAPI = async () => {
    setGenerating(true); setApiError(null); setApiModel(null);
    try {
      const { script, provider, model } = await api.generateReelScript({ topic, niche, handle });
      setApiModel(`${provider} / ${model}`);
      onScript(script);
    } catch (err: any) {
      const isNoLLM = err?.message?.includes('no_llm') || err?.message?.includes('No LLM');
      setApiError(isNoLLM
        ? 'No LLM connected — configure one in Settings → LLM Manager, or use a browser option below.'
        : (err?.message ?? 'Generation failed'));
    } finally {
      setGenerating(false);
    }
  };

  // ── Browser open ──────────────────────────────────────────────────────────
  const openInBrowser = (url: string, label: string) => {
    navigator.clipboard?.writeText(prompt).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied(null), 30_000);
    window.open(url, '_blank', 'noopener');
  };

  // ── Paste zone ────────────────────────────────────────────────────────────
  const handlePasteZone = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text/plain');
    if (text.trim()) {
      e.preventDefault();
      onScript(text.trim());
      setPasting(false);
      setCopied(null);
    }
  };

  const BROWSERS = [
    {
      label: 'ChatGPT',
      emoji: '🟢',
      url: () => `https://chatgpt.com/?q=${encodeURIComponent(`Generate a high-quality script: ${prompt}`)}`,
      autoSend: true,
    },
    {
      label: 'Gemini',
      emoji: '🔵',
      url: () => `https://gemini.google.com/app`,
      autoSend: false,
    },
    {
      label: 'Claude',
      emoji: '🟠',
      url: () => `https://claude.ai/new`,
      autoSend: false,
    },
  ];

  return (
    <div style={{
      marginBottom: 14, padding: 14,
      border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
      background: 'var(--bg-elevated)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
        ✨ Generate Script
      </div>

      {/* ── One-click API generate ── */}
      <div style={{ marginBottom: 10 }}>
        <button
          className="btn btn-primary btn-sm"
          style={{ width: '100%', fontSize: 11, justifyContent: 'center' }}
          disabled={generating}
          onClick={handleGenerateViaAPI}
        >
          {generating ? '⏳ Generating…' : '⚡ Generate via connected LLM'}
        </button>
        {apiModel && (
          <div style={{ marginTop: 5, fontSize: 10, color: 'var(--green)' }}>
            ✓ Generated with {apiModel}
          </div>
        )}
        {apiError && (
          <div style={{ marginTop: 5, fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {apiError}
          </div>
        )}
      </div>

      {/* ── Divider ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0' }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase',
          letterSpacing: '0.06em', fontWeight: 600 }}>or use your subscriptions</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>

      {/* ── Browser buttons ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {BROWSERS.map(({ label, emoji, url, autoSend }) => (
          <button key={label}
            className="btn btn-ghost btn-sm"
            style={{ flex: 1, fontSize: 10 }}
            onClick={() => openInBrowser(url(), label)}
            title={autoSend ? 'Opens with prompt auto-sent' : 'Opens + copies prompt to clipboard'}
          >
            {emoji} {label}
          </button>
        ))}
      </div>

      {copied && (
        <div style={{ fontSize: 10, color: 'var(--accent)', marginBottom: 8, lineHeight: 1.5,
          padding: '6px 10px', background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
          border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
          borderRadius: 'var(--radius-sm)' }}>
          📋 Prompt copied — generate the script in {copied}, then paste it below
        </div>
      )}

      {/* ── Paste zone ── */}
      <div
        style={{ position: 'relative' }}
        onClick={() => { setPasting(true); setTimeout(() => pasteZoneRef.current?.focus(), 50); }}
      >
        <textarea
          ref={pasteZoneRef}
          rows={pasting ? 5 : 2}
          placeholder={pasting
            ? 'Paste the generated script here (⌘V)…'
            : '📋 Click here then ⌘V to paste script from ChatGPT / Gemini / Claude'}
          onFocus={() => setPasting(true)}
          onBlur={() => setPasting(false)}
          onPaste={handlePasteZone}
          readOnly
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'none',
            fontSize: 10, cursor: 'pointer',
            border: `1px dashed ${pasting ? 'var(--accent)' : 'var(--border)'}`,
            background: pasting
              ? 'color-mix(in srgb, var(--accent) 5%, var(--bg-base))'
              : 'var(--bg-base)',
            color: 'var(--text-muted)',
            outline: pasting ? '2px solid color-mix(in srgb, var(--accent) 30%, transparent)' : 'none',
            transition: 'all 0.15s',
          }}
        />
      </div>
    </div>
  );
};
