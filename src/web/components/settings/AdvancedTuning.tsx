import React, { useEffect, useState } from 'react';
import { api } from '../../lib/api';

/**
 * Sprint U1 Task 6 — Advanced settings: growth-automation thresholds +
 * per-source quality multipliers. Both are stored as JSON strings in
 * configStore (AUTOMATION_THRESHOLDS / SOURCE_QUALITY_OVERRIDES) via the
 * existing PATCH /api/config endpoint (same path SettingsView's generic
 * config form uses) and applied at process boot by
 * applyAutomationOverrides()/applySourceQualityOverrides() in
 * worker/index.ts + api/server.ts. Self-contained, like SourcesPanel — it
 * fetches its own config rather than relying on a prop SettingsView doesn't
 * have to give.
 */

type ThresholdKey =
  | 'reactEngagementMultiplier' | 'reactMinSamples'
  | 'recycleCooldownDays' | 'recycleMinMultiplier'
  | 'trendSpikeSources' | 'trendWindowHours' | 'trendVelocityFloor';

// Mirrors src/domain/automation.ts DEFAULTS — duplicated here rather than
// imported, matching how SourcesPanel.tsx keeps its own local type copies
// instead of importing server-side modules into the web bundle.
const THRESHOLD_FIELDS: { key: ThresholdKey; label: string; def: number; step: number }[] = [
  { key: 'reactEngagementMultiplier', label: 'React: engagement multiplier', def: 1.5, step: 0.1 },
  { key: 'reactMinSamples',           label: 'React: min samples',           def: 3,   step: 1 },
  { key: 'recycleCooldownDays',       label: 'Recycle: cooldown (days)',     def: 30,  step: 1 },
  { key: 'recycleMinMultiplier',      label: 'Recycle: min multiplier',      def: 1.5, step: 0.1 },
  { key: 'trendSpikeSources',         label: 'Trend: spike source count',    def: 2,   step: 1 },
  { key: 'trendWindowHours',          label: 'Trend: window (hours)',        def: 6,   step: 1 },
  { key: 'trendVelocityFloor',        label: 'Trend: velocity floor',        def: 0.8, step: 0.05 },
];

// Registry ids (see sourceRegistry.ts) + google_trends/twitter, which are
// dispatched by ingestForNiche but aren't registry-driven config sources.
// Mirrors src/domain/scoring.ts SOURCE_QUALITY_MULTIPLIER defaults.
const SOURCE_ROWS: { id: string; label: string; def: number }[] = [
  { id: 'hacker_news',         label: 'Hacker News',         def: 1.30 },
  { id: 'arxiv',               label: 'arXiv',               def: 1.25 },
  { id: 'pubmed',              label: 'PubMed',              def: 1.25 },
  { id: 'substack',            label: 'Substack',            def: 1.25 },
  { id: 'exploding_topics',    label: 'Exploding Topics',    def: 1.20 },
  { id: 'product_hunt',        label: 'Product Hunt',        def: 1.18 },
  { id: 'finance_newsletter',  label: 'Finance Newsletters', def: 1.15 },
  { id: 'youtube_trends',      label: 'YouTube Trends',      def: 1.15 },
  { id: 'medium',              label: 'Medium',              def: 1.10 },
  { id: 'devto',               label: 'Dev.to',              def: 1.05 },
  { id: 'crypto_news',         label: 'Crypto News',         def: 1.00 },
  { id: 'reddit',              label: 'Reddit',              def: 1.00 },
  { id: 'rss',                 label: 'Custom RSS',          def: 0.95 },
  { id: 'google_news',         label: 'Google News',         def: 0.85 },
  { id: 'twitter',             label: 'Twitter / X',         def: 0.90 },
  { id: 'google_trends',       label: 'Google Trends',       def: 0.80 },
];

function safeParse(raw: string): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch { return {}; }
}

export const AdvancedTuning: React.FC = () => {
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [multipliers, setMultipliers] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    return api.getConfig().then((cfg: any) => {
      const at = safeParse(cfg.values?.AUTOMATION_THRESHOLDS?.value ?? '');
      const sq = safeParse(cfg.values?.SOURCE_QUALITY_OVERRIDES?.value ?? '');
      const t: Record<string, number> = {};
      for (const f of THRESHOLD_FIELDS) t[f.key] = at[f.key] ?? f.def;
      const m: Record<string, number> = {};
      for (const r of SOURCE_ROWS) m[r.id] = sq[r.id] ?? r.def;
      setThresholds(t); setMultipliers(m); setDirty(false);
    }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const setThreshold = (key: string, value: number) => {
    setThresholds(t => ({ ...t, [key]: value }));
    setDirty(true);
  };
  const setMultiplier = (id: string, value: number) => {
    setMultipliers(m => ({ ...m, [id]: value }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.patchConfig({
        AUTOMATION_THRESHOLDS: JSON.stringify(thresholds),
        SOURCE_QUALITY_OVERRIDES: JSON.stringify(multipliers),
      });
      setDirty(false);
      setMsg('✓ Saved — workers pick up changes on next restart.');
    } catch {
      setMsg('✗ Save failed');
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      await api.patchConfig({ AUTOMATION_THRESHOLDS: '', SOURCE_QUALITY_OVERRIDES: '' });
      await load();
      setMsg('✓ Reset to defaults');
    } catch {
      setMsg('✗ Reset failed');
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 18 }}>🎛️</span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Advanced</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Growth-automation thresholds and per-source quality multipliers. Labels show the
          built-in default in parentheses. Workers pick up changes on next restart.
        </div>
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Automation thresholds</div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: '4px 16px', marginBottom: 24 }}>
        {THRESHOLD_FIELDS.map(f => (
          <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 16,
            padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ flex: 1, fontSize: 13 }}>{f.label} <span style={{ color: 'var(--text-muted)' }}>(default: {f.def})</span></div>
            <input type="number" step={f.step} style={{ width: 110 }}
              value={thresholds[f.key] ?? f.def}
              onChange={e => setThreshold(f.key, Number(e.target.value))} />
          </div>
        ))}
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Source quality multipliers</div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: '4px 16px', marginBottom: 20 }}>
        {SOURCE_ROWS.map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 16,
            padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ flex: 1, fontSize: 13 }}>{r.label} <span style={{ color: 'var(--text-muted)' }}>(default: {r.def})</span></div>
            <input type="number" step={0.05} min={0.1} max={3} style={{ width: 110 }}
              value={multipliers[r.id] ?? r.def}
              onChange={e => setMultiplier(r.id, Number(e.target.value))} />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="btn btn-primary btn-sm" disabled={!dirty || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button className="btn btn-ghost btn-sm" disabled={saving} onClick={reset}>
          Reset to defaults
        </button>
        {msg && (
          <span style={{ fontSize: 11, color: msg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>{msg}</span>
        )}
      </div>
    </div>
  );
};
