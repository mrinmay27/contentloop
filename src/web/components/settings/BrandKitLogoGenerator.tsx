import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';
import { IMAGE_PROVIDER_DEFS } from '../../lib/generationProviders';
import { ManualGenerateBridge } from './ManualGenerateBridge';

interface Props {
  brandAccent:   string;
  brandFont:     string;
  brandName:     string;
  pageId?:       string;
  brandLogoUrl?: string;
}

function buildPrompt(name: string, accent: string, font: string): string {
  const safeName = name.trim() || 'my brand';
  return `Clean minimal logo for "${safeName}". Primary accent color ${accent}. Typography inspired by ${font}. Geometric lettermark or wordmark, professional and modern, suitable for a social media theme page. White or transparent background. No gradients, no drop shadows, no complex illustrations. High contrast, scalable.`;
}

export const BrandKitLogoGenerator: React.FC<Props> = ({
  brandAccent, brandFont, brandName, pageId, brandLogoUrl,
}) => {
  const [config,        setConfig]        = useState<Record<string, { value: string }>>({});
  const [selected,      setSelected]      = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [prompt,        setPrompt]        = useState('');
  const [promptEdited,  setPromptEdited]  = useState(false);
  const [generating,    setGenerating]    = useState(false);
  const [logoUrl,       setLogoUrl]       = useState(brandLogoUrl ?? '');
  const [logoDirty,     setLogoDirty]     = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [saveMsg,       setSaveMsg]       = useState<string | null>(null);
  const [error,         setError]         = useState<string | null>(null);
  const [lightboxOpen,  setLightboxOpen]  = useState(false);

  // Close lightbox on Escape
  useEffect(() => {
    if (!lightboxOpen) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxOpen(false); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxOpen]);

  const handleDownload = () => {
    if (!logoUrl) return;
    const ext = (
      logoUrl.match(/^data:image\/(\w+)/)?.[1]
      ?? logoUrl.match(/\.(\w+)(?:\?|$)/)?.[1]
      ?? 'png'
    ).replace('jpeg', 'jpg');
    const slug = brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'logo';
    const a = document.createElement('a');
    a.href = logoUrl;
    a.download = `${slug}-logo.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Sync from parent only when brandLogoUrl prop actually changes (page switch / brand reload).
  // Must NOT depend on logoDirty — that would re-fire on save and clobber local state with
  // the parent's stale value (parent doesn't refetch branding automatically after PATCH).
  useEffect(() => {
    setLogoUrl(brandLogoUrl ?? '');
    setLogoDirty(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandLogoUrl]);

  const handleSaveLogo = async () => {
    if (!logoUrl || !pageId) return;
    setSaving(true); setSaveMsg(null);
    try {
      if (logoUrl.startsWith('data:')) {
        // Upload data URL → server saves to disk and updates pages.brand.logoUrl atomically
        const { url } = await api.uploadBrandLogo(pageId, logoUrl);
        setLogoUrl(url);
      } else {
        // Already a file URL — just persist via the regular branding patch
        await api.patchBranding(pageId, { logoUrl });
      }
      setLogoDirty(false);
      setSaveMsg('✓ Saved to brand');
    } catch {
      setSaveMsg('✗ Save failed');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 2500);
    }
  };

  const [capabilities, setCapabilities] = useState<Record<string, any>>({});

  useEffect(() => {
    Promise.all([api.getConfig(), api.getProviderCapabilities()])
      .then(([cfg, { capabilities: caps }]) => {
        const vals = cfg.values ?? {};
        setConfig(vals);
        setCapabilities(caps ?? {});
        const first = [...IMAGE_PROVIDER_DEFS]
          .sort((a, b) => a.logoRank - b.logoRank)
          .find(def => def.freeProvider || (vals[def.keyName]?.value ?? '').length > 0);
        if (first) {
          setSelected(first.id);
          // Prefer first recommended model from capabilities, fallback to static list
          const imageModels = (caps ?? {})[first.id]?.image ?? [];
          const bestModel = (imageModels.find((m: any) => m.recommended) ?? imageModels[0])?.id
            ?? first.models[0]?.id ?? '';
          setSelectedModel(bestModel);
        }
      })
      .catch(() => {});
  }, []);

  // Auto-fill prompt whenever brand values change, unless user has manually edited it
  useEffect(() => {
    if (!promptEdited) {
      setPrompt(buildPrompt(brandName, brandAccent, brandFont));
    }
  }, [brandName, brandAccent, brandFont, promptEdited]);

  const handlePromptChange = (val: string) => {
    setPrompt(val);
    setPromptEdited(true);
  };

  const handleResetPrompt = useCallback(() => {
    setPrompt(buildPrompt(brandName, brandAccent, brandFont));
    setPromptEdited(false);
  }, [brandName, brandAccent, brandFont]);

  const isConnected   = (def: typeof IMAGE_PROVIDER_DEFS[number]) =>
    !!def.freeProvider || (config[def.keyName]?.value ?? '').length > 0;
  const ideogramReady = (config['FAL_API_KEY']?.value ?? '').length > 0;
  const anyConnected  = IMAGE_PROVIDER_DEFS.some(d => isConnected(d));
  const rankedDefs    = [...IMAGE_PROVIDER_DEFS].sort((a, b) => a.logoRank - b.logoRank);

  const handleProviderSelect = (id: string) => {
    const def       = IMAGE_PROVIDER_DEFS.find(d => d.id === id);
    const liveImgs  = capabilities[id]?.image ?? [];
    const bestModel = (liveImgs.find((m: any) => m.recommended) ?? liveImgs[0])?.id
      ?? def?.models[0]?.id ?? '';
    setSelected(id);
    setSelectedModel(bestModel);
  };

  const handleGenerate = async () => {
    if (!selected || !prompt.trim()) return;
    setGenerating(true); setError(null);
    try {
      const result = await api.generateImage({ prompt: prompt.trim(), provider: selected, model: selectedModel });
      setLogoUrl(result.url);
      setLogoDirty(true);
    } catch (err: any) {
      const raw = err?.message ?? '';
      let friendly = raw;
      if (/429|quota|RESOURCE_EXHAUSTED/i.test(raw)) {
        friendly = 'Quota exceeded for this model. Enable billing in Google Cloud Console, or switch to a different model (e.g. gemini-2.0-flash-preview-image-generation).';
      } else if (/paid plan|upgrade your account/i.test(raw)) {
        friendly = 'This model requires a paid Google Cloud plan. Try switching to gemini-2.0-flash-preview-image-generation which works on AI Studio free tier.';
      } else if (/vertex/i.test(raw) || /NOT_FOUND/i.test(raw)) {
        friendly = 'Model not accessible via AI Studio key. Select a Gemini image model instead of an Imagen model.';
      }
      setError(friendly || 'Logo generation failed');
    } finally { setGenerating(false); }
  };

  return (
    <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 16 }}>✨</span>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Logo Generator</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.6 }}>
        Prompt is auto-filled from your page name, color, and font. Generate directly or
        tweak the prompt for more control.
      </div>

      {!ideogramReady && (
        <div style={{ padding: '10px 14px', marginBottom: 14,
          background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-elevated))',
          border: '1px solid color-mix(in srgb, var(--accent) 30%, var(--border))',
          borderRadius: 'var(--radius-sm)', fontSize: 11, lineHeight: 1.7 }}>
          <strong style={{ color: 'var(--accent)' }}>✨ Best for logos: Ideogram v2</strong><br />
          Ideogram produces the sharpest text and cleanest logo graphics. It runs on fal.ai —
          the same key also unlocks Flux images and Kling video.{' '}
          <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--accent)', fontWeight: 600 }}>
            Get fal.ai key →
          </a>
          {' '}then add it under <strong>Image Generation → fal.ai</strong>.
        </div>
      )}

      {!anyConnected ? (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '12px 14px',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)' }}>
          No image providers connected. Add an API key under{' '}
          <strong>Settings → Image Generation</strong> to enable logo generation.
        </div>
      ) : (
        <>
          {/* Ranked provider list */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
              Provider — ranked best → good for logos
            </div>
            {rankedDefs.map((def, i) => {
              const connected = isConnected(def);
              const active    = selected === def.id;
              return (
                <button key={def.id} disabled={!connected}
                  onClick={() => handleProviderSelect(def.id)}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10,
                    padding: '8px 12px', marginBottom: 4, textAlign: 'left',
                    cursor: connected ? 'pointer' : 'default',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-sm)',
                    background: active
                      ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-surface))'
                      : connected ? 'var(--bg-surface)' : 'var(--bg-elevated)',
                    opacity: connected ? 1 : 0.4 }}>
                  <span style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 700,
                    width: 22, textAlign: 'center', flexShrink: 0,
                    color: i === 0 ? 'var(--accent)' : 'var(--text-muted)' }}>
                    #{i + 1}
                  </span>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{def.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{def.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{def.models[0]?.description}</div>
                  </div>
                  <span style={{ fontSize: 10, flexShrink: 0,
                    color: connected ? 'var(--green)' : 'var(--text-muted)' }}>
                    {connected ? '● Connected' : '○ No key'}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Model selector */}
          {selected && (
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                Model
              </label>
              <select value={selectedModel} style={{ width: '100%', fontSize: 11 }}
                onChange={e => setSelectedModel(e.target.value)}>
                {(() => {
                  const liveModels: Array<{ id: string; label: string; description?: string }> =
                    capabilities[selected]?.image ?? [];
                  const opts = liveModels.length > 0
                    ? liveModels
                    : (IMAGE_PROVIDER_DEFS.find(d => d.id === selected)?.models ?? []);
                  return opts.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.label}{m.description ? ` — ${m.description}` : ''}
                    </option>
                  ));
                })()}
              </select>
            </div>
          )}

          {/* Prompt — auto-filled, fully editable */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Prompt
                {promptEdited && (
                  <span style={{ marginLeft: 6, color: 'var(--accent)', fontSize: 10 }}>
                    (edited)
                  </span>
                )}
              </label>
              {promptEdited && (
                <button onClick={handleResetPrompt}
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 10, color: 'var(--text-muted)', padding: 0 }}>
                  ↺ Reset to auto
                </button>
              )}
            </div>
            <textarea
              value={prompt}
              onChange={e => handlePromptChange(e.target.value)}
              rows={3}
              style={{ width: '100%', fontSize: 11, resize: 'vertical', boxSizing: 'border-box' }}
            />
          </div>

          <button className="btn btn-primary btn-sm" style={{ width: '100%', fontSize: 11 }}
            disabled={generating || !selected || !prompt.trim()} onClick={handleGenerate}>
            {generating ? '⏳ Generating logo…' : '✨ Generate Logo'}
          </button>

          <ManualGenerateBridge
            prompt={prompt}
            onImage={(dataUrl) => { setLogoUrl(dataUrl); setLogoDirty(true); setError(null); }}
          />

          {error && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--red)', padding: '6px 10px',
              background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--radius-sm)',
              border: '1px solid rgba(239,68,68,0.2)' }}>
              {error}
            </div>
          )}

          {logoUrl && (
            <div style={{ marginTop: 12 }}>
              <img src={logoUrl} alt="Generated logo"
                style={{ width: '100%', maxHeight: 280, objectFit: 'contain', background: '#fff',
                  borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}
                  onClick={() => setLightboxOpen(true)}>👁 View full size</button>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}
                  onClick={handleDownload}>↓ Download</button>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}
                  onClick={() => { setLogoUrl(''); setLogoDirty(false); setError(null); }}>Clear</button>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}
                  onClick={handleGenerate} disabled={generating}>
                  ↻ Regenerate
                </button>
                {pageId && logoDirty && (
                  <button className="btn btn-primary btn-sm"
                    style={{ fontSize: 10, marginLeft: 'auto' }}
                    onClick={handleSaveLogo} disabled={saving}>
                    {saving ? '⏳ Saving…' : '✓ Save logo to brand'}
                  </button>
                )}
                {pageId && !logoDirty && logoUrl && (
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto', fontStyle: 'italic' }}>
                    ● Saved
                  </span>
                )}
                {saveMsg && (
                  <span style={{ fontSize: 10,
                    color: saveMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>
                    {saveMsg}
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {lightboxOpen && logoUrl && (
        <div onClick={() => setLightboxOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0, 0, 0, 0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'zoom-out',
            padding: 40,
            animation: 'fadeIn 0.15s ease-out',
          }}>
          <img src={logoUrl} alt="Logo full size"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '95vw', maxHeight: '95vh', objectFit: 'contain',
              background: '#fff', borderRadius: 8,
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              cursor: 'default',
            }} />
          <button onClick={() => setLightboxOpen(false)}
            style={{
              position: 'absolute', top: 24, right: 24,
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 6, padding: '8px 14px',
              color: '#fff', fontSize: 12, cursor: 'pointer',
              backdropFilter: 'blur(10px)',
            }}>
            ✕ Close (Esc)
          </button>
        </div>
      )}
    </div>
  );
};
