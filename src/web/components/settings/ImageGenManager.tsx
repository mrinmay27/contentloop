import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { IMAGE_PROVIDER_DEFS, type ImageProviderDef } from '../../lib/generationProviders';

const KEY_TO_PROVIDER: Record<string, string> = {
  LLM_API_KEY:         'openai',
  GOOGLE_AI_API_KEY:   'google',
  FAL_API_KEY:         'fal',
  STABILITY_API_KEY:   'stability',
  REPLICATE_API_TOKEN: 'replicate',
  RUNWAY_API_KEY:      'runway',
  HEYGEN_API_KEY:      'heygen',
};

export const ImageGenManager: React.FC = () => {
  const [config,     setConfig]     = useState<Record<string, { value: string; masked: boolean }>>({});
  const [priority,   setPriority]   = useState<string[]>(['google', 'openai', 'fal', 'stability', 'replicate']);
  const [modelPrefs, setModelPrefs] = useState<Record<string, string>>({});
  const [dirty,      setDirty]      = useState<Record<string, string>>({});
  const [expanded,   setExpanded]   = useState<string | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [saveMsg,    setSaveMsg]    = useState<string | null>(null);

  // Capability discovery state
  const [capabilities, setCapabilities] = useState<Record<string, any>>({});
  const [probing,      setProbing]      = useState<Record<string, boolean>>({});

  // Load config + cached capabilities on mount
  useEffect(() => {
    api.getConfig().then((cfg: any) => {
      const vals = cfg.values ?? {};
      setConfig(vals);
      try {
        const p = JSON.parse(vals.IMAGE_PROVIDER_PRIORITY?.value || '[]');
        if (Array.isArray(p) && p.length > 0) setPriority(p);
      } catch {}
      try { setModelPrefs(JSON.parse(vals.IMAGE_MODEL_PREFS?.value || '{}')); } catch {}
    }).catch(() => {});

    api.getProviderCapabilities().then(({ capabilities: caps }) => {
      setCapabilities(caps ?? {});
    }).catch(() => {});
  }, []);

  const getKeyValue = (keyName: string) =>
    dirty[keyName] ?? config[keyName]?.value ?? '';

  const isConnected = (def: ImageProviderDef) => getKeyValue(def.keyName).length > 0;

  const handleKeyChange = (keyName: string, value: string) => {
    setDirty(d => ({ ...d, [keyName]: value }));
    setConfig(c => ({ ...c, [keyName]: { value, masked: false } }));
  };

  const handleModelPrefChange = (providerId: string, model: string) => {
    const next = { ...modelPrefs, [providerId]: model };
    setModelPrefs(next);
    setDirty(d => ({ ...d, IMAGE_MODEL_PREFS: JSON.stringify(next) }));
  };

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...priority];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setPriority(next);
    setDirty(d => ({ ...d, IMAGE_PROVIDER_PRIORITY: JSON.stringify(next) }));
  };

  const handleSave = async () => {
    if (!Object.keys(dirty).length) return;
    setSaving(true);
    try {
      await api.patchConfig(dirty);

      // Identify which API-key providers changed and probe them
      const affectedProviders = Object.keys(dirty)
        .map(k => KEY_TO_PROVIDER[k])
        .filter((id): id is string => !!id);

      setDirty({});
      setSaveMsg('✓ Saved');

      for (const providerId of affectedProviders) {
        setProbing(p => ({ ...p, [providerId]: true }));
        api.probeImageProvider(providerId)
          .then(({ capabilities: caps }) => {
            setCapabilities(prev => ({ ...prev, [providerId]: caps }));
            // Auto-set preferred model to first recommended image model if not yet set
            if (caps?.status === 'ok' && caps.image?.length > 0 && !modelPrefs[providerId]) {
              const recommended = caps.image.find((m: any) => m.recommended) ?? caps.image[0];
              if (recommended) {
                handleModelPrefChange(providerId, recommended.id);
              }
            }
          })
          .catch(() => {})
          .finally(() => setProbing(p => ({ ...p, [providerId]: false })));
      }
    } catch {
      setSaveMsg('✗ Save failed');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 2500);
    }
  };

  const orderedDefs = priority
    .map(id => IMAGE_PROVIDER_DEFS.find(d => d.id === id))
    .filter((d): d is ImageProviderDef => !!d);

  const connectedCount = orderedDefs.filter(isConnected).length;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 18 }}>🖼️</span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Image Generation</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Connect your image API keys. The engine tries providers top-to-bottom, skipping
          any without a key, and falls back automatically on API failure.
          {connectedCount === 0 && (
            <span style={{ color: 'var(--accent)', marginLeft: 4 }}>
              No providers connected yet — expand a row to add a key.
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        {orderedDefs.map((def, idx) => {
          const connected = isConnected(def);
          const isOpen    = expanded === def.id;
          const prefModel = modelPrefs[def.id] || def.models[0]?.id || '';
          const caps      = capabilities[def.id];

          // Determine model options: discovered > static fallback
          const discoveredImageModels: Array<{ id: string; label: string; description?: string }> =
            caps?.image ?? [];
          const modelOptions = discoveredImageModels.length > 0 ? discoveredImageModels : def.models;

          return (
            <div key={def.id} style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              background: connected ? 'var(--bg-surface)' : 'var(--bg-elevated)',
              opacity: connected ? 1 : 0.65,
              overflow: 'hidden',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
                {/* Rank + reorder arrows */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                  <button onClick={() => move(idx, -1)} disabled={idx === 0}
                    style={{ background: 'none', border: 'none', lineHeight: 1, padding: '1px 4px',
                      cursor: idx === 0 ? 'default' : 'pointer',
                      color: idx === 0 ? 'var(--border)' : 'var(--text-muted)', fontSize: 9 }}>▲</button>
                  <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--mono)',
                    color: connected ? 'var(--accent)' : 'var(--text-muted)' }}>#{idx + 1}</span>
                  <button onClick={() => move(idx, 1)} disabled={idx === orderedDefs.length - 1}
                    style={{ background: 'none', border: 'none', lineHeight: 1, padding: '1px 4px',
                      cursor: idx === orderedDefs.length - 1 ? 'default' : 'pointer',
                      color: idx === orderedDefs.length - 1 ? 'var(--border)' : 'var(--text-muted)', fontSize: 9 }}>▼</button>
                </div>

                <span style={{ fontSize: 18, flexShrink: 0 }}>{def.icon}</span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{def.name}</div>
                  {def.note && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{def.note}</div>}
                </div>

                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  <span style={{
                    fontSize: 10, padding: '2px 7px', borderRadius: 10, fontWeight: 600,
                    background: connected
                      ? 'color-mix(in srgb, var(--green) 15%, transparent)'
                      : 'var(--bg-hover)',
                    color: connected ? 'var(--green)' : 'var(--text-muted)',
                    border: `1px solid ${connected
                      ? 'color-mix(in srgb, var(--green) 30%, transparent)'
                      : 'var(--border)'}`,
                  }}>
                    {connected ? '● Connected' : '○ No key'}
                  </span>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: 10, padding: '3px 8px' }}
                    onClick={() => setExpanded(isOpen ? null : def.id)}>
                    {isOpen ? '▲' : 'Set up'}
                  </button>
                </div>
              </div>

              {isOpen && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '12px 14px',
                  background: 'var(--bg-elevated)' }}>
                  <div style={{ marginBottom: connected ? 12 : 0 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                      API Key <span style={{ opacity: 0.6 }}>({def.keyName})</span>
                    </label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input type="password" value={getKeyValue(def.keyName)}
                        placeholder={`Paste your ${def.name} key…`}
                        style={{ flex: 1, fontSize: 12 }}
                        onChange={e => handleKeyChange(def.keyName, e.target.value)} />
                      <a href={def.docsUrl} target="_blank" rel="noopener noreferrer"
                        className="btn btn-ghost btn-sm" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                        {def.docsLabel}
                      </a>
                    </div>
                  </div>

                  {connected && (
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                        Preferred model (used when this provider is selected by the chain)
                        {probing[def.id] && (
                          <span style={{ marginLeft: 6, opacity: 0.6 }}>— 🔍 Detecting models…</span>
                        )}
                      </label>

                      <select value={prefModel} style={{ fontSize: 11, width: '100%' }}
                        onChange={e => handleModelPrefChange(def.id, e.target.value)}>
                        {modelOptions.map((m: { id: string; label: string; description?: string }) => (
                          <option key={m.id} value={m.id}>
                            {m.label}{m.description ? ` — ${m.description}` : ''}
                          </option>
                        ))}
                      </select>

                      {/* Capability chips */}
                      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {probing[def.id] && (
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            🔍 Detecting models…
                          </span>
                        )}
                        {!probing[def.id] && caps?.status === 'error' && (
                          <span style={{ fontSize: 10, color: 'var(--red)' }}>
                            ⚠ Probe failed: {caps.error}
                          </span>
                        )}
                        {!probing[def.id] && caps?.status === 'ok' && (
                          <>
                            {caps.text?.length > 0 && (
                              <span style={{
                                fontSize: 10, padding: '2px 7px', borderRadius: 10,
                                background: 'color-mix(in srgb, var(--blue) 12%, transparent)',
                                color: 'var(--blue)',
                                border: '1px solid color-mix(in srgb, var(--blue) 25%, transparent)',
                              }}>
                                {caps.text.length} text model{caps.text.length !== 1 ? 's' : ''}
                              </span>
                            )}
                            {caps.image?.length > 0 && (
                              <span style={{
                                fontSize: 10, padding: '2px 7px', borderRadius: 10,
                                background: 'color-mix(in srgb, var(--green) 12%, transparent)',
                                color: 'var(--green)',
                                border: '1px solid color-mix(in srgb, var(--green) 25%, transparent)',
                              }}>
                                {caps.image.length} image model{caps.image.length !== 1 ? 's' : ''}
                              </span>
                            )}
                            {caps.video?.length > 0 && (
                              <span style={{
                                fontSize: 10, padding: '2px 7px', borderRadius: 10,
                                background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
                                color: 'var(--accent)',
                                border: '1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
                              }}>
                                {caps.video.length} video model{caps.video.length !== 1 ? 's' : ''}
                              </span>
                            )}
                            {caps.image?.[0]?.id?.startsWith('imagen') && (
                              <span style={{
                                fontSize: 10, padding: '2px 7px', borderRadius: 10,
                                background: 'color-mix(in srgb, var(--green) 18%, transparent)',
                                color: 'var(--green)', fontWeight: 600,
                                border: '1px solid color-mix(in srgb, var(--green) 35%, transparent)',
                              }}>
                                ✓ Imagen 3 detected — Pro tier
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {Object.keys(dirty).length > 0 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn btn-primary btn-sm" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving…' : '✓ Save Changes'}
          </button>
          {saveMsg && (
            <span style={{ fontSize: 11, color: saveMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>
              {saveMsg}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
