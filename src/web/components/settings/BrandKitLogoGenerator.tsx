import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { IMAGE_PROVIDER_DEFS } from '../../lib/generationProviders';

interface Props {
  brandAccent: string;
  brandFont:   string;
}

export const BrandKitLogoGenerator: React.FC<Props> = ({ brandAccent, brandFont }) => {
  const [config,        setConfig]        = useState<Record<string, { value: string }>>({});
  const [selected,      setSelected]      = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [prompt,        setPrompt]        = useState('');
  const [generating,    setGenerating]    = useState(false);
  const [logoUrl,       setLogoUrl]       = useState('');
  const [error,         setError]         = useState<string | null>(null);

  useEffect(() => {
    api.getConfig().then((cfg: any) => {
      const vals = cfg.values ?? {};
      setConfig(vals);
      const first = [...IMAGE_PROVIDER_DEFS]
        .sort((a, b) => a.logoRank - b.logoRank)
        .find(def => (vals[def.keyName]?.value ?? '').length > 0);
      if (first) {
        setSelected(first.id);
        setSelectedModel(first.models[0]?.id ?? '');
      }
    }).catch(() => {});
  }, []);

  const isConnected  = (keyName: string) => (config[keyName]?.value ?? '').length > 0;
  const ideogramReady = isConnected('FAL_API_KEY');
  const anyConnected  = IMAGE_PROVIDER_DEFS.some(d => isConnected(d.keyName));
  const rankedDefs    = [...IMAGE_PROVIDER_DEFS].sort((a, b) => a.logoRank - b.logoRank);

  const handleProviderSelect = (id: string) => {
    const def = IMAGE_PROVIDER_DEFS.find(d => d.id === id);
    setSelected(id);
    setSelectedModel(def?.models[0]?.id ?? '');
  };

  const handleGenerate = async () => {
    if (!selected || !prompt.trim()) return;
    setGenerating(true); setError(null);
    try {
      const result = await api.generateImage({ prompt: prompt.trim(), provider: selected, model: selectedModel });
      setLogoUrl(result.url);
    } catch (err: any) {
      setError(err?.message ?? 'Logo generation failed');
    } finally { setGenerating(false); }
  };

  return (
    <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 16 }}>✨</span>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Logo Generator</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.6 }}>
        Generate logo concepts using your connected image APIs. Providers ranked best → good for logo quality.
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
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
              Provider — ranked best → good for logos
            </div>
            {rankedDefs.map((def, i) => {
              const connected = isConnected(def.keyName);
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

          {selected && (
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                Model
              </label>
              <select value={selectedModel} style={{ width: '100%', fontSize: 11 }}
                onChange={e => setSelectedModel(e.target.value)}>
                {(IMAGE_PROVIDER_DEFS.find(d => d.id === selected)?.models ?? []).map(m => (
                  <option key={m.id} value={m.id}>{m.label} — {m.description}</option>
                ))}
              </select>
            </div>
          )}

          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={2}
            placeholder={`e.g. Minimal logo, accent color ${brandAccent}, ${brandFont} font, geometric lettermark, dark background, no gradients`}
            style={{ width: '100%', fontSize: 11, resize: 'vertical', marginBottom: 8, boxSizing: 'border-box' }} />

          <button className="btn btn-primary btn-sm" style={{ width: '100%', fontSize: 11 }}
            disabled={generating || !selected || !prompt.trim()} onClick={handleGenerate}>
            {generating ? '⏳ Generating logo…' : '✨ Generate Logo'}
          </button>

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
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <a href={logoUrl} target="_blank" rel="noopener noreferrer"
                  className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}>Open full size ↗</a>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}
                  onClick={() => { setLogoUrl(''); setError(null); }}>Clear</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
