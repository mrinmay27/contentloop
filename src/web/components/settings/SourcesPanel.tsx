import React, { useEffect, useState } from 'react';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import { api } from '../../lib/api';

type ConfigField = { mapField: string; label: string; kind: 'strings' | 'feeds'; placeholder?: string };
type SourceMeta = { id: string; label: string; description: string; configFields: ConfigField[]; needsKey?: { env: string; label: string } };

/**
 * Registry-driven Sources settings panel — supersedes the old hardcoded
 * "Content Sources" section. SettingsView takes no props today, so this
 * panel is self-contained: it fetches the page list itself and renders its
 * own page-selector dropdown (defaulting to the first page), rather than
 * relying on a `page` prop from a parent that doesn't have one to give.
 */
export const SourcesPanel: React.FC = () => {
  const [pages, setPages] = useState<any[]>([]);
  const [pageId, setPageId] = useState('');
  const [registry, setRegistry] = useState<SourceMeta[]>([]);
  const [map, setMap] = useState<any | null>(null);
  const [keyPresent, setKeyPresent] = useState<Record<string, boolean>>({});
  const [effective, setEffective] = useState<Record<string, { values: string[]; isDefault: boolean }>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getPages().then((ps: any[]) => {
      setPages(ps);
      if (ps.length > 0 && !pageId) setPageId(ps[0].id);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }).catch(() => {});
  }, []);

  const page = pages.find((p) => p.id === pageId);

  // `kind: 'feeds'` is shared by rssFeeds (objects: {name,url,verified?})
  // AND financeFeeds/cryptoFeeds (plain URL strings — see
  // sourceMapValidation.ts's URL_ARRAY_KEYS). So `kind` alone can't tell us
  // the shape; rssFeeds is the only object-shaped field.
  const isObjectFeed = (f: ConfigField) => f.mapField === 'rssFeeds';
  const placeholderFor = (f: ConfigField) => f.placeholder ?? (f.kind === 'feeds' ? 'https://example.com/feed.xml' : 'add…');

  const load = () => {
    if (!pageId) return;
    setLoading(true);
    return api.getSources(pageId).then((d) => {
      setRegistry(d.registry); setMap(d.map); setKeyPresent(d.keyPresent ?? {});
      setEffective(d.effective ?? {}); setDirty(false);
    }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [pageId]);

  const enabled = (id: string) => map?.sourceEnabled?.[id] !== false;
  const toggle = (id: string) => {
    setMap((m: any) => ({ ...m, sourceEnabled: { ...(m?.sourceEnabled ?? {}), [id]: !enabled(id) } }));
    setDirty(true);
  };

  const fieldValues = (f: ConfigField): string[] => {
    const v = map?.[f.mapField];
    if (!v) return [];
    return isObjectFeed(f) ? v.map((x: any) => x.url ?? x) : v;
  };

  const addValue = (f: ConfigField) => {
    const raw = (inputs[f.mapField] ?? '').trim();
    if (!raw) return;
    setMap((m: any) => {
      const current = m?.[f.mapField] ?? [];
      const next = isObjectFeed(f)
        ? [...current, { name: raw, url: raw }]
        : [...new Set([...current, raw])];
      return { ...m, [f.mapField]: next };
    });
    setInputs((s) => ({ ...s, [f.mapField]: '' }));
    setDirty(true);
  };

  const removeValue = (f: ConfigField, value: string) => {
    setMap((m: any) => ({
      ...m,
      [f.mapField]: (m?.[f.mapField] ?? []).filter((x: any) => (isObjectFeed(f) ? x.url !== value : x !== value)),
    }));
    setDirty(true);
  };

  const save = () => {
    if (!map || !pageId) return;
    setBusy('save');
    const patch: any = { sourceEnabled: map.sourceEnabled ?? {} };
    for (const s of registry) for (const f of s.configFields) if (map[f.mapField] !== undefined) patch[f.mapField] = map[f.mapField];
    api.updateSources(pageId, patch).then((d) => { setMap(d.map); setDirty(false); }).finally(() => setBusy(null));
  };

  const regenerate = () => {
    if (!pageId) return;
    setBusy('regen');
    api.regenerateSources(pageId).then((d) => { setMap(d.map); setDirty(false); }).finally(() => setBusy(null));
  };

  const handlePageChange = (nextId: string) => {
    // Controlled <select> — not calling setPageId leaves its displayed
    // value at the current pageId, so declining the confirm auto-reverts
    // the dropdown with no extra state needed.
    if (dirty && !window.confirm('Discard unsaved source changes?')) return;
    setPageId(nextId);
  };

  const PageSelector = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
      padding: '10px 14px', background: 'var(--bg-elevated)',
      border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>Theme Page:</span>
      <select value={pageId} onChange={(e) => handlePageChange(e.target.value)} style={{ flex: 1, minWidth: 0 }}>
        {pages.map((p) => (
          <option key={p.id} value={p.id}>{p.name}{p.handle ? ` — ${p.handle}` : ''}</option>
        ))}
      </select>
    </div>
  );

  if (!pages.length) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)' }}>
        No Theme Pages yet — create one first.
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        {PageSelector}
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      </div>
    );
  }

  if (!map) {
    return (
      <div>
        {PageSelector}
        <div style={{ padding: 16, fontSize: 13, color: 'var(--text-muted)' }}>
          No source map yet for {page?.name ?? 'this page'}.
          <button className="btn btn-surface btn-sm" style={{ marginLeft: 10 }} disabled={busy === 'regen'} onClick={regenerate}>
            <Sparkles size={13} /> Generate with AI
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {PageSelector}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Sources for <b>{page?.name}</b> — toggle, tune, or add your own.
        </span>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={load} title="Reload"><RefreshCw size={13} /></button>
        <button className="btn btn-ghost btn-sm" disabled={busy === 'regen'} onClick={regenerate}
          title="Regenerates subreddits/tags/feeds via LLM — your toggles and custom feeds are preserved">
          <Sparkles size={13} /> Regenerate with AI
        </button>
        <button className="btn btn-primary btn-sm" disabled={!dirty || busy === 'save'} onClick={save}>Save changes</button>
      </div>

      {registry.map((s) => (
        <div key={s.id} style={{ borderRadius: 10, background: 'var(--bg-elevated)', padding: 14,
          opacity: enabled(s.id) ? 1 : 0.55 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
              <input type="checkbox" checked={enabled(s.id)} onChange={() => toggle(s.id)} />
              {s.label}
            </label>
            {s.needsKey && (
              <span className={`badge ${keyPresent[s.id] ? 'badge-green' : 'badge-amber'}`} title={s.needsKey.label}>
                {keyPresent[s.id] ? 'key set' : 'key missing'}
              </span>
            )}
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.description}</span>
          </div>
          {enabled(s.id) && s.configFields.map((f) => (
            <div key={f.mapField} style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>{f.label}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {fieldValues(f).map((v) => (
                  <span key={v} className="badge badge-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {v}
                    <X size={10} style={{ cursor: 'pointer' }} onClick={() => removeValue(f, v)} />
                  </span>
                ))}
                <input className="search-input" style={{ width: 220, fontSize: 11 }}
                  placeholder={placeholderFor(f)}
                  value={inputs[f.mapField] ?? ''}
                  onChange={(e) => setInputs((st) => ({ ...st, [f.mapField]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') addValue(f); }} />
              </div>
              {fieldValues(f).length === 0 && effective[f.mapField]?.isDefault && effective[f.mapField].values.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>using defaults:</span>
                  {effective[f.mapField].values.slice(0, 6).map((v) => (
                    <span key={v} className="badge badge-muted" style={{ opacity: 0.55 }} title={v}>
                      {v.length > 38 ? `${v.slice(0, 38)}…` : v}
                    </span>
                  ))}
                  {effective[f.mapField].values.length > 6 && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      +{effective[f.mapField].values.length - 6} more
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
