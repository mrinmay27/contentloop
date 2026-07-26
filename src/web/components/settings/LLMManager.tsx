/**
 * LLMManager — Multi-provider LLM configuration UI
 *
 * Features:
 * - Card list with inline edit mode per entry
 * - Confirmation modal before delete
 * - Add new provider with guided form
 * - Enable/disable toggle
 * - Coverage warning if a task has no provider
 */
import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { ConfirmModal } from '../modals/ConfirmModal';

// ─── Provider catalog ─────────────────────────────────────────────────────────

export const PROVIDERS: Record<string, {
  name: string; emoji: string; models: string[];
}> = {
  groq:        { name:'Groq',                emoji:'⚡', models:['llama-3.3-70b-versatile','llama-3.1-8b-instant','llama-3.1-70b-versatile','mixtral-8x7b-32768','gemma2-9b-it','llama3-70b-8192'] },
  openai:      { name:'OpenAI',              emoji:'🟢', models:['gpt-4o','gpt-4o-mini','gpt-4-turbo','gpt-4','gpt-3.5-turbo'] },
  anthropic:   { name:'Anthropic Claude',    emoji:'🟠', models:['claude-opus-5','claude-sonnet-5','claude-haiku-4-5-20251001','claude-3-5-sonnet-20241022','claude-3-5-haiku-20241022'] },
  gemini:      { name:'Google Gemini',       emoji:'🔵', models:['gemini-2.0-flash','gemini-2.0-flash-lite','gemini-1.5-pro','gemini-1.5-flash','gemini-1.5-flash-8b'] },
  deepseek:    { name:'DeepSeek',            emoji:'🐋', models:['deepseek-chat','deepseek-reasoner'] },
  mistral:     { name:'Mistral AI',          emoji:'🌬️', models:['mistral-large-latest','mistral-small-latest','open-mixtral-8x22b','open-mixtral-8x7b','open-mistral-7b'] },
  openrouter:  { name:'OpenRouter',          emoji:'🔀', models:['meta-llama/llama-3.3-70b-instruct:free','google/gemini-flash-1.5:free','mistralai/mixtral-8x7b-instruct:free','anthropic/claude-3.5-sonnet','openai/gpt-4o','deepseek/deepseek-chat'] },
  together:    { name:'Together AI',         emoji:'🤝', models:['meta-llama/Llama-3.3-70B-Instruct-Turbo','Qwen/Qwen2.5-72B-Instruct-Turbo','deepseek-ai/DeepSeek-V3','mistralai/Mixtral-8x7B-Instruct-v0.1'] },
  qwen:        { name:'Qwen (Alibaba)',       emoji:'🟣', models:['qwen-max','qwen-plus','qwen-turbo','qwen2.5-72b-instruct','qwen2.5-coder-32b-instruct'] },
  minimax:     { name:'MiniMax',             emoji:'🟡', models:['abab6.5s-chat','abab5.5-chat','abab6.5g-chat'] },
  huggingface: { name:'Hugging Face',        emoji:'🤗', models:['microsoft/Phi-3-mini-4k-instruct','HuggingFaceH4/zephyr-7b-beta','mistralai/Mistral-7B-Instruct-v0.3'] },
  custom:      { name:'Custom (OpenAI-compat)',emoji:'🔧',models:[] },
};

const TASKS = [
  { key:'all',        label:'All Tasks',          desc:'Used for every task',            color:'var(--accent)' },
  { key:'scoring',    label:'Topic Scoring',       desc:'Score & filter topics',          color:'var(--blue)'   },
  { key:'generation', label:'Content Generation',  desc:'Write hooks, captions, slides',  color:'var(--green)'  },
  { key:'fallback',   label:'Fallback',            desc:'Used if primary fails',          color:'var(--text-muted)' },
] as const;
type TaskKey = typeof TASKS[number]['key'];

// ─── Shared field styles ──────────────────────────────────────────────────────

const fieldStyle: React.CSSProperties = {
  width:'100%', padding:'7px 10px', borderRadius:'var(--radius-sm)',
  border:'1px solid var(--border)', background:'var(--bg-surface)',
  color:'var(--text-primary)', fontSize:12,
};
const selectStyle: React.CSSProperties = { ...fieldStyle };
const labelStyle: React.CSSProperties = {
  fontSize:11, color:'var(--text-muted)', display:'block', marginBottom:4,
};

// ─── LLM edit/add form (shared for both Add and Edit) ─────────────────────────

type FormState = {
  provider: string;
  model:    string;
  apiKey:   string;
  task:     TaskKey;
  label:    string;
  baseUrl:  string;
  enabled:  boolean;
};

function defaultForm(cfg?: any): FormState {
  if (!cfg) return { provider:'groq', model:'llama-3.3-70b-versatile', apiKey:'', task:'all', label:'', baseUrl:'', enabled:true };
  return {
    provider: cfg.provider ?? 'groq',
    model:    cfg.model    ?? '',
    apiKey:   '',              // never pre-fill key (security)
    task:     cfg.task     ?? 'all',
    label:    cfg.label    ?? '',
    baseUrl:  cfg.baseUrl  ?? '',
    enabled:  cfg.enabled  ?? true,
  };
}

type LLMFormProps = {
  initial?:  any;
  isEdit?:   boolean;
  onSave:    (form: FormState) => Promise<void>;
  onCancel:  () => void;
};

function LLMForm({ initial, isEdit = false, onSave, onCancel }: LLMFormProps) {
  const [form,    setForm]    = useState<FormState>(defaultForm(initial));
  const [saving,  setSaving]  = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [error,   setError]   = useState('');

  const prov   = PROVIDERS[form.provider];
  const models = prov?.models ?? [];

  const set = (key: keyof FormState, val: unknown) =>
    setForm(f => ({ ...f, [key]: val }));

  const handleProviderChange = (p: string) => {
    set('provider', p);
    set('model', PROVIDERS[p]?.models[0] ?? '');
  };

  const handleSave = async () => {
    if (!isEdit && !form.apiKey.trim()) { setError('API Key is required.'); return; }
    setSaving(true); setError('');
    try { await onSave(form); }
    catch { setError('Save failed — check the console.'); }
    finally { setSaving(false); }
  };

  const accentBorder = isEdit ? 'var(--blue)' : 'var(--accent)';
  const accentBg     = isEdit
    ? 'color-mix(in srgb, var(--blue) 4%, var(--bg-surface))'
    : 'color-mix(in srgb, var(--accent) 4%, var(--bg-surface))';

  return (
    <div style={{
      border: `1.5px solid ${accentBorder}`, borderRadius:'var(--radius)',
      padding:18, marginBottom:16, background: accentBg,
      animation:'fadeIn 0.18s ease both',
    }}>
      <div style={{ fontSize:13, fontWeight:700, marginBottom:14, display:'flex', alignItems:'center', gap:8 }}>
        <span>{isEdit ? '✏️' : '➕'}</span>
        {isEdit ? `Edit — ${initial?.label || PROVIDERS[initial?.provider]?.name || 'LLM Config'}` : 'Add LLM Provider'}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
        {/* Provider */}
        <div>
          <label style={labelStyle}>Provider</label>
          <select value={form.provider} onChange={e => handleProviderChange(e.target.value)} style={selectStyle}>
            {Object.entries(PROVIDERS).map(([k, p]) => (
              <option key={k} value={k}>{p.emoji} {p.name}</option>
            ))}
          </select>
        </div>

        {/* Task */}
        <div>
          <label style={labelStyle}>Task Assignment</label>
          <select value={form.task} onChange={e => set('task', e.target.value as TaskKey)} style={selectStyle}>
            {TASKS.map(t => <option key={t.key} value={t.key}>{t.label} — {t.desc}</option>)}
          </select>
        </div>

        {/* Model */}
        <div>
          <label style={labelStyle}>Model</label>
          {models.length > 0 ? (
            <select value={form.model} onChange={e => set('model', e.target.value)} style={selectStyle}>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
              {/* Allow custom model not in list */}
              {form.model && !models.includes(form.model) && (
                <option value={form.model}>{form.model} (custom)</option>
              )}
            </select>
          ) : (
            <input type="text" value={form.model} onChange={e => set('model', e.target.value)}
              placeholder="Enter model ID…" style={fieldStyle}/>
          )}
          {/* Custom model input toggle for known providers */}
          {models.length > 0 && (
            <div style={{ marginTop:4 }}>
              <input type="text"
                placeholder="Or type a custom model ID…"
                defaultValue={models.includes(form.model) ? '' : form.model}
                onChange={e => { if (e.target.value) set('model', e.target.value); }}
                style={{ ...fieldStyle, fontSize:10, padding:'4px 8px', color:'var(--text-muted)' }}/>
            </div>
          )}
        </div>

        {/* API Key */}
        <div>
          <label style={labelStyle}>
            API Key
            {isEdit && <span style={{ opacity:0.55, marginLeft:6 }}>(leave blank to keep existing)</span>}
          </label>
          <div style={{ display:'flex', gap:6 }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={form.apiKey}
              onChange={e => set('apiKey', e.target.value)}
              placeholder={isEdit ? '••••••••  (unchanged)' : 'Paste your API key…'}
              style={{ ...fieldStyle, flex:1 }}
            />
            <button onClick={() => setShowKey(s => !s)}
              style={{ padding:'0 8px', borderRadius:'var(--radius-sm)', flexShrink:0,
                border:'1px solid var(--border)', background:'var(--bg-elevated)',
                cursor:'pointer', fontSize:11, color:'var(--text-muted)' }}>
              {showKey ? '🙈' : '👁'}
            </button>
          </div>
        </div>

        {/* Nickname */}
        <div>
          <label style={labelStyle}>Nickname <span style={{ opacity:0.5 }}>(optional)</span></label>
          <input type="text" value={form.label} onChange={e => set('label', e.target.value)}
            placeholder="e.g. Fast scorer, Premium writer…" style={fieldStyle}/>
        </div>

        {/* Custom base URL */}
        {(form.provider === 'custom' || isEdit) && (
          <div>
            <label style={labelStyle}>
              Base URL
              <span style={{ opacity:0.5, marginLeft:4 }}>
                {form.provider !== 'custom' ? '(only for custom endpoints)' : ''}
              </span>
            </label>
            <input type="text" value={form.baseUrl} onChange={e => set('baseUrl', e.target.value)}
              placeholder="https://your-llm-api.com/v1 (leave blank for default)"
              style={fieldStyle}/>
          </div>
        )}
      </div>

      {error && (
        <div style={{ fontSize:12, color:'var(--red)', marginBottom:10 }}>⚠ {error}</div>
      )}

      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <button className="btn btn-primary btn-sm" disabled={saving} onClick={handleSave}>
          {saving ? 'Saving…' : isEdit ? '✓ Save Changes' : '✓ Add Provider'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        {isEdit && (
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:11, color:'var(--text-muted)' }}>Enabled</span>
            <button
              onClick={() => set('enabled', !form.enabled)}
              style={{ background:'none', border:'none', cursor:'pointer', fontSize:16, lineHeight:1 }}>
              {form.enabled ? '✅' : '⬜'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── LLM Card ─────────────────────────────────────────────────────────────────

type LLMCardProps = {
  cfg:      any;
  priority: number;
  isEditing: boolean;
  onEditOpen:  () => void;
  onEditSave:  (form: FormState) => Promise<void>;
  onEditCancel:() => void;
  onToggle: () => void;
  onDelete: () => void;
};

function LLMCard({ cfg, priority, isEditing, onEditOpen, onEditSave, onEditCancel, onToggle, onDelete }: LLMCardProps) {
  const prov     = PROVIDERS[cfg.provider] ?? { name: cfg.provider, emoji:'🔧', models:[] };
  const taskMeta = TASKS.find(t => t.key === cfg.task) ?? TASKS[0];

  if (isEditing) {
    return <LLMForm initial={cfg} isEdit onSave={onEditSave} onCancel={onEditCancel}/>;
  }

  return (
    <div style={{
      display:'flex', alignItems:'center', gap:12, padding:'12px 14px',
      border:'1px solid var(--border)', borderRadius:'var(--radius-sm)',
      background: cfg.enabled ? 'var(--bg-surface)' : 'var(--bg-elevated)',
      opacity: cfg.enabled ? 1 : 0.6,
      transition:'all 0.15s',
    }}>
      {/* Priority # */}
      <div style={{ width:22, height:22, borderRadius:4, flexShrink:0,
        background:'var(--bg-hover)', display:'flex', alignItems:'center',
        justifyContent:'center', fontSize:10, fontWeight:700, color:'var(--text-muted)' }}>
        #{priority}
      </div>

      {/* Provider icon */}
      <div style={{ width:32, height:32, borderRadius:6, flexShrink:0,
        background:'var(--bg-elevated)', display:'flex', alignItems:'center',
        justifyContent:'center', fontSize:18 }}>
        {prov.emoji}
      </div>

      {/* Info block */}
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)',
          display:'flex', alignItems:'center', gap:7 }}>
          {cfg.label || prov.name}
          {/* Task badge */}
          <span style={{
            fontSize:9, padding:'1px 6px', borderRadius:10, fontWeight:700,
            background:`color-mix(in srgb, ${taskMeta.color} 15%, transparent)`,
            color: taskMeta.color,
            border:`1px solid color-mix(in srgb, ${taskMeta.color} 30%, transparent)`,
          }}>
            {taskMeta.label}
          </span>
          {/* Disabled badge */}
          {!cfg.enabled && (
            <span style={{ fontSize:9, padding:'1px 6px', borderRadius:10,
              background:'var(--bg-hover)', color:'var(--text-muted)', fontWeight:600 }}>
              disabled
            </span>
          )}
        </div>
        <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2,
          fontFamily:'var(--mono)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {prov.name !== (cfg.label || prov.name) && (
            <span style={{ marginRight:6, opacity:0.7 }}>{prov.name} ·</span>
          )}
          {cfg.model}
        </div>
      </div>

      {/* Key status */}
      <div style={{ flexShrink:0, fontSize:10, display:'flex', alignItems:'center', gap:4,
        color: cfg.hasKey ? 'var(--green)' : 'var(--red)' }}>
        <div style={{ width:5, height:5, borderRadius:'50%',
          background: cfg.hasKey ? 'var(--green)' : 'var(--red)' }}/>
        {cfg.hasKey ? (cfg.apiKeyMasked?.slice(-8) || 'key set') : 'no key'}
      </div>

      {/* Action buttons */}
      <div style={{ display:'flex', alignItems:'center', gap:2, flexShrink:0 }}>
        {/* Edit */}
        <button
          id={`llm-edit-${cfg.id}`}
          onClick={onEditOpen}
          title="Edit this provider"
          style={{ background:'none', border:'1px solid var(--border)', cursor:'pointer',
            padding:'4px 8px', borderRadius:'var(--radius-sm)', fontSize:11,
            color:'var(--text-secondary)', display:'flex', alignItems:'center', gap:4,
            transition:'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.background='var(--bg-hover)'; e.currentTarget.style.color='var(--text-primary)'; }}
          onMouseLeave={e => { e.currentTarget.style.background='none';           e.currentTarget.style.color='var(--text-secondary)'; }}
        >
          ✏️ Edit
        </button>

        {/* Enable/disable toggle */}
        <button
          onClick={onToggle}
          title={cfg.enabled ? 'Disable' : 'Enable'}
          style={{ background:'none', border:'none', cursor:'pointer', padding:'4px 6px', fontSize:14 }}>
          {cfg.enabled ? '✅' : '⬜'}
        </button>

        {/* Delete — triggers confirm modal */}
        <button
          id={`llm-delete-${cfg.id}`}
          onClick={onDelete}
          title="Remove this provider"
          style={{ background:'none', border:'none', cursor:'pointer', padding:'4px 6px',
            color:'var(--text-muted)', fontSize:13, borderRadius:'var(--radius-sm)',
            transition:'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.color='var(--red)'; e.currentTarget.style.background='var(--red-dim)'; }}
          onMouseLeave={e => { e.currentTarget.style.color='var(--text-muted)'; e.currentTarget.style.background='none'; }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// ─── Main LLMManager ──────────────────────────────────────────────────────────

export function LLMManager() {
  const [configs,      setConfigs]      = useState<any[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [adding,       setAdding]       = useState(false);
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [pendingDelete,setPendingDelete]= useState<any | null>(null);

  const load = async () => {
    try {
      const data = await api.getLLMConfigs();
      setConfigs(data.configs ?? []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  // ── Add ──────────────────────────────────────────────────────────
  const handleAdd = async (form: FormState) => {
    const result = await api.addLLMConfig({
      provider: form.provider, model: form.model,
      apiKey: form.apiKey, task: form.task,
      label:   form.label   || undefined,
      baseUrl: form.baseUrl || undefined,
      enabled: form.enabled,
    });
    setAdding(false);
    load();
    // Fire-and-forget probe for the newly added config
    const newId = result?.config?.id;
    if (newId) {
      api.probeLLMConfig(newId).catch(() => {});
    }
  };

  // ── Edit save ────────────────────────────────────────────────────
  const handleEditSave = async (id: string, form: FormState) => {
    const updates: Record<string, unknown> = {
      provider: form.provider,
      model:    form.model,
      task:     form.task,
      label:    form.label   || undefined,
      baseUrl:  form.baseUrl || undefined,
      enabled:  form.enabled,
    };
    // Only send apiKey if user actually typed one
    if (form.apiKey.trim()) updates['apiKey'] = form.apiKey;

    await api.updateLLMConfig(id, updates);
    setEditingId(null);
    load();
    // Fire-and-forget probe after edit
    api.probeLLMConfig(id).catch(() => {});
  };

  // ── Toggle enable ────────────────────────────────────────────────
  const handleToggle = async (cfg: any) => {
    await api.updateLLMConfig(cfg.id, { enabled: !cfg.enabled });
    load();
  };

  // ── Confirmed delete ─────────────────────────────────────────────
  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    await api.deleteLLMConfig(pendingDelete.id);
    setPendingDelete(null);
    load();
  };

  // Coverage check
  const coveredTasks = new Set(configs.filter(c => c.enabled).map((c: any) => c.task));
  const allCovered   = coveredTasks.has('all');
  const missing      = TASKS.filter(t => t.key !== 'fallback' && !allCovered && !coveredTasks.has(t.key));

  return (
    <>
      {/* Section header */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
        <span style={{ fontSize:18 }}>🤖</span>
        <span style={{ fontSize:16, fontWeight:700 }}>AI / LLM Providers</span>
      </div>
      <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:20 }}>
        Add multiple providers. Each is assigned a task — scoring uses cheap/fast models,
        generation uses your best model. Priority order determines fallback.
      </div>

      {/* Coverage warning */}
      {!loading && configs.length > 0 && missing.length > 0 && (
        <div style={{ padding:'10px 14px', borderRadius:'var(--radius-sm)', marginBottom:16,
          background:'color-mix(in srgb, var(--accent) 8%, transparent)',
          border:'1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
          fontSize:12, color:'var(--accent)' }}>
          ⚠️ No provider assigned to: <strong>{missing.map(m => m.label).join(', ')}</strong>.
          Add one or change an existing provider's task to "All Tasks".
        </div>
      )}

      {/* Add form */}
      {adding && (
        <LLMForm onSave={handleAdd} onCancel={() => setAdding(false)}/>
      )}

      {/* Config cards */}
      {loading ? (
        <div style={{ color:'var(--text-muted)', fontSize:12 }}>Loading…</div>
      ) : configs.length === 0 && !adding ? (
        <div style={{ padding:'32px 20px', textAlign:'center', borderRadius:'var(--radius)',
          border:'1px dashed var(--border)', background:'var(--bg-elevated)', marginBottom:16 }}>
          <div style={{ fontSize:28, marginBottom:8 }}>🤖</div>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:6 }}>No LLM providers configured</div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:16 }}>
            Add at least one provider to enable AI scoring and content generation.
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            ➕ Add your first LLM
          </button>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:16 }}>
          {configs.map((cfg, i) => (
            <LLMCard
              key={cfg.id}
              cfg={cfg}
              priority={i + 1}
              isEditing={editingId === cfg.id}
              onEditOpen={() => {
                setAdding(false);        // close Add form if open
                setEditingId(cfg.id);
              }}
              onEditSave={form => handleEditSave(cfg.id, form)}
              onEditCancel={() => setEditingId(null)}
              onToggle={() => handleToggle(cfg)}
              onDelete={() => setPendingDelete(cfg)}
            />
          ))}
        </div>
      )}

      {/* Add button */}
      {!adding && configs.length > 0 && (
        <button
          className="btn btn-surface btn-sm"
          onClick={() => { setAdding(true); setEditingId(null); }}
          style={{ width:'100%', justifyContent:'center', display:'flex',
            alignItems:'center', gap:6, padding:'9px 0', marginBottom:8 }}>
          ➕ Add LLM Provider
        </button>
      )}

      {/* Task coverage legend */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:12 }}>
        {TASKS.map(t => (
          <div key={t.key} style={{ display:'flex', alignItems:'center', gap:5, fontSize:11,
            color: coveredTasks.has(t.key) || allCovered ? t.color : 'var(--text-muted)' }}>
            <div style={{ width:6, height:6, borderRadius:'50%',
              background: coveredTasks.has(t.key) || allCovered ? t.color : 'var(--border-strong)' }}/>
            {t.label}
          </div>
        ))}
      </div>

      {/* ── Delete confirmation modal ── */}
      {pendingDelete && (
        <ConfirmModal
          title="Remove LLM Provider?"
          message={`"${pendingDelete.label || PROVIDERS[pendingDelete.provider]?.name || pendingDelete.provider}" (${pendingDelete.model}) will be removed. This cannot be undone.`}
          confirmLabel="Yes, Remove"
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}
