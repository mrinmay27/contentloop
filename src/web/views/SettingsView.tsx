import React, { useState, useEffect, useCallback } from 'react';
import { Icon } from '../components/ui/Icon';
import { api } from '../lib/api';
import { LLMManager } from '../components/settings/LLMManager';
import { ImageGenManager } from '../components/settings/ImageGenManager';
import { BrandKitLogoGenerator } from '../components/settings/BrandKitLogoGenerator';
import { OAuthConnectCard, type OAuthProvider } from '../components/settings/OAuthConnectCard';
import { SourcesPanel } from '../components/settings/SourcesPanel';

// ─── Types ────────────────────────────────────────────────────────────────────

type FieldMeta = {
  label:        string;
  group:        string;
  type:         'text' | 'secret' | 'boolean' | 'number' | 'select' | 'color';
  options?:     string[];
  placeholder?: string;
  required?:    boolean;
};

type FieldValue  = { value: string; masked: boolean };
type ConfigData  = { values: Record<string, FieldValue>; meta: Record<string, FieldMeta> };
type Integration = { connected: boolean; label: string };

// ─── Metadata ─────────────────────────────────────────────────────────────────

const GROUP_ICONS: Record<string, string> = {
  'AI / LLM':          '🤖',
  'Reddit':            '🔴',
  'Product Hunt':      '🐱',
  'Twitter / X':       '🐦',
  'Exploding Topics':  '🚀',
  'Instagram':         '📸',
  'YouTube':           '▶️',
  'Canva':             '🖼️',
  'Pipeline':          '⚙️',
  'Sources':           '📡',
};

const GROUP_DESC: Record<string, string> = {
  'AI / LLM':         'LLM provider, model, and API key for content generation',
  'Reddit':           'Free Reddit API credentials — boosts rate limits beyond public JSON',
  'Product Hunt':     'Free Developer Token — unlocks higher rate limits on the Product Hunt GraphQL API',
  'Twitter / X':      'Paid API — Bearer Token for trend ingestion (requires Basic plan, ~$100/mo)',
  'Exploding Topics': 'Paid Pro API — early-signal trend source (requires Pro subscription at explodingtopics.com)',
  'Instagram':        'Instagram access token for publishing to Instagram Reels & feed',
  'YouTube':          'YouTube Data API v3 key for Trending ingestion + OAuth for publishing Shorts',
  'Canva':            'Canva OAuth credentials for template autofill',
  'Pipeline':         'Automation limits, approval mode, scheduling defaults, and default content format',
  'Sources':          'Registry-driven per-page source map — toggle sources, tune config (subreddits, tags, feeds), add custom RSS, regenerate via AI',
};

// Groups that require a paid subscription to be useful
const PREMIUM_GROUPS = new Set(['Twitter / X', 'Exploding Topics']);

// Navigation sections — defines order and visual grouping in the left panel
const NAV_SECTIONS: { label: string; groups: string[] }[] = [
  { label: 'System',               groups: ['AI / LLM', 'Branding', 'Sources', 'Pipeline'] },
  { label: 'Generation',           groups: ['Image Generation'] },
  { label: 'Ingestion — Free',     groups: ['Reddit', 'Product Hunt'] },
  { label: 'Ingestion — Premium',  groups: ['Twitter / X', 'Exploding Topics'] },
  { label: 'Publishing',           groups: ['Instagram', 'YouTube', 'Canva'] },
];

const INTEGRATION_GROUPS = ['Reddit', 'Twitter / X', 'Instagram', 'YouTube', 'Canva'];
const INTEG_KEY: Record<string, string> = {
  'Reddit': 'reddit', 'Twitter / X': 'twitter', 'Instagram': 'instagram',
  'YouTube': 'youtube', 'Canva': 'canva',
};

function groupFields(meta: Record<string, FieldMeta>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, m] of Object.entries(meta)) {
    (out[m.group] ??= []).push(k);
  }
  return out;
}

// ─── SecretInput ──────────────────────────────────────────────────────────────

function SecretInput({ value, masked, onChange }: {
  value: string; masked: boolean; onChange: (v: string) => void;
}) {
  const [show,    setShow]    = useState(false);
  const [editing, setEditing] = useState(false);
  const [local,   setLocal]   = useState('');

  if (editing) return (
    <div style={{ display:'flex', gap:6, alignItems:'center', flex:1 }}>
      <input autoFocus type="text" value={local}
        onChange={e => setLocal(e.target.value)}
        placeholder="Enter new value…" style={{ flex:1 }}/>
      <button className="btn btn-primary btn-sm"
        onClick={() => { onChange(local); setEditing(false); }}>
        <Icon name="check" size={11}/>
      </button>
      <button className="btn btn-ghost btn-sm"
        onClick={() => { setLocal(''); setEditing(false); }}>
        <Icon name="x" size={11}/>
      </button>
    </div>
  );

  return (
    <div style={{ display:'flex', gap:6, alignItems:'center', flex:1 }}>
      <input readOnly value={value} type={show ? 'text' : 'password'}
        style={{ flex:1 }} placeholder="Not set"/>
      <button className="btn btn-ghost btn-sm" style={{ padding:'4px 8px' }}
        onClick={() => setShow(s => !s)}>{show ? '🙈' : '👁️'}</button>
      <button className="btn btn-surface btn-sm" style={{ padding:'4px 8px' }}
        onClick={() => { setLocal(''); setEditing(true); }}>Change</button>
    </div>
  );
}

// ─── ConfigRow ────────────────────────────────────────────────────────────────

function ConfigRow({ fieldKey, meta, current, onChange }: {
  fieldKey: string; meta: FieldMeta;
  current: FieldValue; onChange: (k: string, v: string) => void;
}) {
  const val = current?.value ?? '';
  const isSet = val.length > 0;

  return (
    <div style={{ display:'flex', alignItems:'center', gap:16, padding:'12px 0',
      borderBottom:'1px solid var(--border)' }}>
      {/* Label */}
      <div style={{ minWidth:200, flexShrink:0 }}>
        <div style={{ fontSize:13, fontWeight:500, color:'var(--text-primary)' }}>
          {meta.label}
          {meta.required && <span style={{ color:'var(--red)', marginLeft:3 }}>*</span>}
        </div>
        <div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'var(--mono)', marginTop:2 }}>
          {fieldKey}
        </div>
      </div>

      {/* Input */}
      <div style={{ flex:1, display:'flex', alignItems:'center', gap:8 }}>
        {meta.type === 'secret' && (
          <SecretInput value={val} masked={current?.masked ?? false}
            onChange={v => onChange(fieldKey, v)}/>
        )}
        {meta.type === 'color' && (
          <div style={{ display:'flex', gap:8, alignItems:'center', flex:1 }}>
            <input type="color" value={val || '#F5A623'}
              style={{ width:40, height:32, padding:2, borderRadius:'var(--radius-sm)',
                border:'1px solid var(--border)', cursor:'pointer', background:'none' }}
              onChange={e => onChange(fieldKey, e.target.value)}/>
            <input type="text" value={val} style={{ width:110 }}
              placeholder={meta.placeholder}
              onChange={e => onChange(fieldKey, e.target.value)}/>
            <div style={{ width:28, height:28, borderRadius:'var(--radius-sm)',
              background: val || '#F5A623', border:'1px solid var(--border)', flexShrink:0 }}/>
          </div>
        )}
        {meta.type === 'text' && (
          <input type="text" value={val} placeholder={meta.placeholder} style={{ flex:1 }}
            onChange={e => onChange(fieldKey, e.target.value)}/>
        )}
        {meta.type === 'number' && (
          <input type="number" value={val} style={{ width:100 }}
            onChange={e => onChange(fieldKey, e.target.value)}/>
        )}
        {meta.type === 'boolean' && (
          <div onClick={() => onChange(fieldKey, val === 'true' ? 'false' : 'true')}
            style={{ cursor:'pointer', position:'relative', width:40, height:22, borderRadius:11,
              background: val === 'true' ? 'var(--accent)' : 'var(--bg-hover)',
              border:'1px solid var(--border)', transition:'background 0.2s', flexShrink:0 }}>
            <div style={{ position:'absolute', top:2, left: val === 'true' ? 20 : 2,
              width:16, height:16, borderRadius:'50%', background:'#fff',
              transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,.3)' }}/>
          </div>
        )}
        {meta.type === 'select' && (
          <select value={val} style={{ width:200 }}
            onChange={e => onChange(fieldKey, e.target.value)}>
            {(meta.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        )}
      </div>

      {/* Status badge — only for non-boolean */}
      {meta.type !== 'boolean' && (
        isSet
          ? <span className="badge badge-green" style={{ flexShrink:0, fontSize:10 }}>Set</span>
          : <span className="badge badge-muted"  style={{ flexShrink:0, fontSize:10 }}>Empty</span>
      )}
    </div>
  );
}

// ─── BrandingSection (per-page) ──────────────────────────────────────────────

type BrandValues = {
  accent:        string;
  font:          string;
  captionTone:   string;
  watermark:     string;
  logoUrl:       string;
  hashtags:      string;
};

const BRAND_DEFAULTS: BrandValues = {
  accent:      '#F5A623',
  font:        'DM Sans',
  captionTone: 'Educational',
  watermark:   '',
  logoUrl:     '',
  hashtags:    '',
};

const FONTS = [
  'DM Sans','DM Serif Display',
  'Inter','Playfair Display',
  'Satoshi','Cabinet Grotesk',
  'Clash Display','Clash Grotesk',
  'Outfit','Merriweather',
  'Plus Jakarta Sans','Cormorant Garamond',
  'Geist','Geist Mono',
  'Poppins','Nunito','Raleway','Lato','Montserrat','Source Sans 3',
  'Manrope','Figtree','Syne','Space Grotesk',
  'Fraunces','Libre Baskerville','Lora','PT Serif','Crimson Pro','EB Garamond',
  'JetBrains Mono','Fira Code','IBM Plex Mono',
];

const FONT_PAIRS = [
  { heading: 'DM Serif Display',   body: 'DM Sans',           label: 'Modern Editorial' },
  { heading: 'Playfair Display',   body: 'Inter',             label: 'Classic & Clean'  },
  { heading: 'Clash Display',      body: 'Clash Grotesk',     label: 'Bold Brand'       },
  { heading: 'Fraunces',           body: 'Plus Jakarta Sans', label: 'Warm & Trustworthy'},
  { heading: 'Cormorant Garamond', body: 'Outfit',            label: 'Luxury Minimal'   },
  { heading: 'Syne',               body: 'Manrope',           label: 'Creative Studio'  },
];

const TONES = ['Educational','Bold & Direct','Casual & Friendly','Professional','Storytelling'];

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1,3),16)/255;
  const g = parseInt(hex.slice(3,5),16)/255;
  const b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h = 0, s = 0;
  const l = (max+min)/2;
  if (max !== min) {
    const d = max-min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch(max) {
      case r: h=((g-b)/d+(g<b?6:0))/6; break;
      case g: h=((b-r)/d+2)/6; break;
      case b: h=((r-g)/d+4)/6; break;
    }
  }
  return [Math.round(h*360), Math.round(s*100), Math.round(l*100)];
}

function hslToHex(h: number, s: number, l: number): string {
  s/=100; l/=100;
  const a = s*Math.min(l,1-l);
  const f = (n: number) => {
    const k=(n+h/30)%12;
    return Math.round((l-a*Math.max(-1,Math.min(k-3,Math.min(9-k,1))))*255)
      .toString(16).padStart(2,'0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function generatePalette(accent: string): string[] {
  try {
    const [h,s,l] = hexToHsl(accent);
    return [
      accent,
      hslToHex((h+30)%360, s, Math.min(l+10,90)),
      hslToHex((h+180)%360, Math.max(s-20,20), Math.min(l+15,90)),
      hslToHex(h, Math.max(s-40,10), Math.min(l+30,92)),
      hslToHex(h, s, Math.max(l-30,10)),
    ];
  } catch { return [accent,'#F5A623','#4A90E2','#F0EDE8','#1A1A2E']; }
}

function BrandingSection() {
  const [pages,    setPages]    = useState<any[]>([]);
  const [pageId,   setPageId]   = useState<string>('');
  const [brand,    setBrand]    = useState<BrandValues>(BRAND_DEFAULTS);
  const [loadingB, setLoadingB] = useState(false);
  const [savingB,  setSavingB]  = useState(false);
  const [msg,      setMsg]      = useState<string | null>(null);

  // Load page list
  useEffect(() => {
    api.getPages().then((ps: any[]) => {
      setPages(ps);
      if (ps.length > 0 && !pageId) setPageId(ps[0].id);
    }).catch(() => {});
  }, []);

  // Load branding whenever selected page changes
  useEffect(() => {
    if (!pageId) return;
    setLoadingB(true);
    api.getBranding(pageId)
      .then(({ brand: b }) => setBrand({ ...BRAND_DEFAULTS, ...b }))
      .catch(() => setBrand(BRAND_DEFAULTS))
      .finally(() => setLoadingB(false));
  }, [pageId]);

  const handleSave = async () => {
    if (!pageId) return;
    setSavingB(true);
    try {
      await api.patchBranding(pageId, brand as any);
      setMsg('✓ Saved');
    } catch { setMsg('✗ Failed'); }
    finally { setSavingB(false); setTimeout(() => setMsg(null), 2000); }
  };

  const selectedPage = pages.find(p => p.id === pageId);
  const palette      = generatePalette(brand.accent);

  return (
    <div>
      {/* Section header */}
      <div style={{ marginBottom:16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
          <span style={{ fontSize:18 }}>🎨</span>
          <span style={{ fontSize:16, fontWeight:700 }}>Branding</span>
        </div>
        <div style={{ fontSize:12, color:'var(--text-muted)' }}>
          Per-page brand settings — stored in each page's brand column.
        </div>
      </div>

      {/* Page selector */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20,
        padding:'10px 14px', background:'var(--bg-elevated)',
        border:'1px solid var(--border)', borderRadius:'var(--radius-sm)' }}>
        <span style={{ fontSize:12, color:'var(--text-muted)', flexShrink:0 }}>Theme Page:</span>
        <select value={pageId} onChange={e => setPageId(e.target.value)}
          style={{ flex:1, minWidth:0 }}>
          {pages.map(p => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.handle} ({p.platform})
            </option>
          ))}
        </select>
        {selectedPage && (
          <div style={{ width:10, height:10, borderRadius:'50%',
            background: selectedPage.brand?.accent ?? 'var(--accent)', flexShrink:0 }}/>
        )}
        {loadingB && <span style={{ fontSize:11, color:'var(--text-muted)' }}>Loading…</span>}
      </div>

      {/* Branding fields */}
      <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)',
        borderRadius:'var(--radius)', padding:'0 16px' }}>

        {/* Primary Color */}
        <div style={{ display:'flex', alignItems:'center', gap:16, padding:'12px 0',
          borderBottom:'1px solid var(--border)' }}>
          <div style={{ minWidth:200, flexShrink:0 }}>
            <div style={{ fontSize:13, fontWeight:500 }}>Primary Color</div>
            <div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'var(--mono)', marginTop:2 }}>accent</div>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flex:1 }}>
            <input type="color" value={brand.accent}
              style={{ width:40, height:32, padding:2, borderRadius:'var(--radius-sm)',
                border:'1px solid var(--border)', cursor:'pointer' }}
              onChange={e => setBrand(b => ({ ...b, accent: e.target.value }))}/>
            <input type="text" value={brand.accent} style={{ width:110 }}
              onChange={e => setBrand(b => ({ ...b, accent: e.target.value }))}/>
            <div style={{ width:28, height:28, borderRadius:'var(--radius-sm)',
              background:brand.accent, border:'1px solid var(--border)' }}/>
          </div>
        </div>

        {/* Generated Palette */}
        <div style={{ display:'flex', alignItems:'center', gap:16, padding:'12px 0',
          borderBottom:'1px solid var(--border)' }}>
          <div style={{ minWidth:200, flexShrink:0 }}>
            <div style={{ fontSize:13, fontWeight:500 }}>Generated Palette</div>
            <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>Auto-generated from primary color</div>
          </div>
          <div style={{ display:'flex', gap:6, alignItems:'center', flex:1 }}>
            {palette.map((hex, i) => (
              <div key={i} title={`${hex} — click to copy`}
                onClick={() => navigator.clipboard?.writeText(hex)}
                style={{ width:32, height:32, borderRadius:'var(--radius-sm)',
                  background:hex, border:'1px solid var(--border)', cursor:'pointer', flexShrink:0 }}/>
            ))}
            <div style={{ fontSize:10, color:'var(--text-muted)', marginLeft:4 }}>Click to copy hex</div>
          </div>
        </div>

        {/* Font */}
        <div style={{ display:'flex', alignItems:'center', gap:16, padding:'12px 0',
          borderBottom:'1px solid var(--border)' }}>
          <div style={{ minWidth:200, flexShrink:0 }}>
            <div style={{ fontSize:13, fontWeight:500 }}>Default Font</div>
            <div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'var(--mono)', marginTop:2 }}>font</div>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:8 }}>
              {FONT_PAIRS.map(pair => (
                <button key={pair.label}
                  onClick={() => setBrand(b => ({ ...b, font: pair.body }))}
                  className={`btn btn-sm ${brand.font === pair.body ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ fontSize:10 }} title={`${pair.heading} / ${pair.body}`}>
                  {pair.label}
                </button>
              ))}
            </div>
            <select value={brand.font} style={{ width:220 }}
              onChange={e => setBrand(b => ({ ...b, font: e.target.value }))}>
              {FONTS.map(f => <option key={f}>{f}</option>)}
            </select>
          </div>
        </div>

        {/* Caption Tone */}
        <div style={{ display:'flex', alignItems:'center', gap:16, padding:'12px 0',
          borderBottom:'1px solid var(--border)' }}>
          <div style={{ minWidth:200, flexShrink:0 }}>
            <div style={{ fontSize:13, fontWeight:500 }}>Caption Tone</div>
            <div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'var(--mono)', marginTop:2 }}>captionTone</div>
          </div>
          <select value={brand.captionTone} style={{ width:200 }}
            onChange={e => setBrand(b => ({ ...b, captionTone: e.target.value }))}>
            {TONES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>

        {/* Watermark */}
        <div style={{ display:'flex', alignItems:'center', gap:16, padding:'12px 0',
          borderBottom:'1px solid var(--border)' }}>
          <div style={{ minWidth:200, flexShrink:0 }}>
            <div style={{ fontSize:13, fontWeight:500 }}>Watermark / Handle</div>
            <div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'var(--mono)', marginTop:2 }}>watermark</div>
          </div>
          <input type="text" value={brand.watermark} placeholder="@yourhandle" style={{ flex:1 }}
            onChange={e => setBrand(b => ({ ...b, watermark: e.target.value }))}/>
        </div>

        {/* Logo URL */}
        <div style={{ display:'flex', alignItems:'center', gap:16, padding:'12px 0',
          borderBottom:'1px solid var(--border)' }}>
          <div style={{ minWidth:200, flexShrink:0 }}>
            <div style={{ fontSize:13, fontWeight:500 }}>Logo URL</div>
            <div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'var(--mono)', marginTop:2 }}>logoUrl</div>
          </div>
          <input type="text" value={brand.logoUrl} placeholder="https://…/logo.png" style={{ flex:1 }}
            onChange={e => setBrand(b => ({ ...b, logoUrl: e.target.value }))}/>
          {brand.logoUrl && (
            <img src={brand.logoUrl} alt="logo preview"
              style={{ width:32, height:32, objectFit:'contain', borderRadius:4,
                border:'1px solid var(--border)', flexShrink:0 }}
              onError={e => (e.currentTarget.style.display='none')}/>
          )}
        </div>

        {/* Hashtags */}
        <div style={{ display:'flex', alignItems:'center', gap:16, padding:'12px 0' }}>
          <div style={{ minWidth:200, flexShrink:0 }}>
            <div style={{ fontSize:13, fontWeight:500 }}>Default Hashtags</div>
            <div style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'var(--mono)', marginTop:2 }}>hashtags</div>
          </div>
          <input type="text" value={brand.hashtags}
            placeholder="#AI #ContentCreator #Growth" style={{ flex:1 }}
            onChange={e => setBrand(b => ({ ...b, hashtags: e.target.value }))}/>
        </div>
      </div>

      {/* Save */}
      <div style={{ marginTop:16, display:'flex', gap:10, alignItems:'center' }}>
        <button className="btn btn-primary btn-sm" disabled={savingB || !pageId}
          onClick={handleSave}>
          <Icon name="check" size={11}/> {savingB ? 'Saving…' : 'Save Branding'}
        </button>
        {msg && (
          <span style={{ fontSize:12,
            color: msg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>
            {msg}
          </span>
        )}
      </div>

      <BrandKitLogoGenerator
        brandAccent={brand.accent}
        brandFont={brand.font}
        brandName={selectedPage?.name ?? selectedPage?.handle ?? ''}
        pageId={selectedPage?.id}
        brandLogoUrl={brand.logoUrl}
      />
    </div>
  );
}

// ─── Setup Guide ──────────────────────────────────────────────────────────────

type GuideStep = { title: string; body: string; link?: { label: string; url: string } };

const SETUP_GUIDES: Record<string, GuideStep[]> = {
  'AI / LLM': [
    {
      title: '1. Pick a provider',
      body:  'Groq is free and fast — recommended to start. OpenAI works too but costs money per request.',
    },
    {
      title: '2. Create a free Groq account',
      body:  'Go to console.groq.com → Sign up → You\'ll land on the API Keys page.',
      link:  { label: 'Open Groq Console →', url: 'https://console.groq.com/keys' },
    },
    {
      title: '3. Generate an API Key',
      body:  'Click "Create API Key" → name it "TPCE" → copy the key starting with gsk_…',
    },
    {
      title: '4. Paste it here',
      body:  'Paste into the "LLM API Key" field above. Set Provider = groq. Model = llama-3.3-70b-versatile (already filled).',
    },
  ],
  'Reddit': [
    {
      title: '1. Create a Reddit account',
      body:  'You need a Reddit account. Go to reddit.com and sign up if you don\'t have one.',
      link:  { label: 'reddit.com →', url: 'https://reddit.com' },
    },
    {
      title: '2. Go to App Preferences',
      body:  'Visit reddit.com/prefs/apps → scroll to the bottom → click "create another app…"',
      link:  { label: 'Open App Preferences →', url: 'https://www.reddit.com/prefs/apps' },
    },
    {
      title: '3. Fill in the form',
      body:  'Name: TPCE · Type: select "script" · Redirect URI: http://localhost · Click "create app".',
    },
    {
      title: '4. Copy your credentials',
      body:  'Under your app name: the short string below the icon is your Client ID. "Secret" is your Client Secret.',
    },
    {
      title: '5. Set User Agent',
      body:  'Enter something like: TPCE/1.0 by u/yourredditusername',
    },
  ],
  'Twitter / X': [
    {
      title: '1. Apply for developer access',
      body:  'Go to developer.twitter.com → Sign in → Click "Sign up for Free Account". Fill in the use-case form (say: "content research / social listening").',
      link:  { label: 'Twitter Developer Portal →', url: 'https://developer.twitter.com/en/portal/dashboard' },
    },
    {
      title: '2. Create a Project + App',
      body:  'In the dashboard: New Project → name it "TPCE" → create an App inside it.',
    },
    {
      title: '3. Get the Bearer Token',
      body:  'Inside your App → "Keys and Tokens" tab → scroll to "Bearer Token" → click Generate → copy it.',
    },
    {
      title: '4. Paste here',
      body:  'Paste into the "Bearer Token" field above. This is read-only access — no tweets are posted.',
    },
  ],
  'Instagram': [
    {
      title: 'Convert to a Professional account',
      body:  'In the Instagram app → Settings → Account → Switch to Professional Account. This is required for API posting access.',
    },
    {
      title: 'Create a Meta Developer App',
      body:  'Go to developers.facebook.com → My Apps → Create App → choose "Other" → "Business".',
      link:  { label: 'Meta Developers →', url: 'https://developers.facebook.com/apps' },
    },
    {
      title: 'Add Instagram to your app',
      body:  'Inside your app → Add Product → Instagram → Basic Display → Set Up.',
    },
    {
      title: 'Set the Redirect URI',
      body:  'In your app\'s Instagram → Basic Display settings, add this as a Valid OAuth Redirect URI: http://localhost:4000/auth/instagram/callback',
    },
    {
      title: 'Copy App ID + App Secret',
      body:  'From your app\'s dashboard, copy the App ID and App Secret. Expand "Developer credentials — one-time setup" above and paste them in.',
    },
    {
      title: 'Click Connect Instagram',
      body:  'Hit the Connect Instagram button at the top of this section. Meta Login opens in your browser. Sign in with your Instagram account — done! Tokens are stored automatically.',
    },
  ],
  'YouTube': [
    {
      title: 'Create a Google Cloud Project',
      body:  'Go to console.cloud.google.com → New Project → name it "TPCE" → Create.',
      link:  { label: 'Google Cloud Console →', url: 'https://console.cloud.google.com' },
    },
    {
      title: 'Enable YouTube Data API v3',
      body:  'In your project → APIs & Services → Library → search "YouTube Data API v3" → Enable.',
    },
    {
      title: 'Create OAuth 2.0 credentials',
      body:  'APIs & Services → Credentials → Create Credentials → OAuth Client ID → Application type: Web application.',
    },
    {
      title: 'Add Redirect URI',
      body:  'In your OAuth Client settings add: http://localhost:4000/auth/youtube/callback as an Authorized Redirect URI.',
    },
    {
      title: 'Copy Client ID + Client Secret',
      body:  'From the OAuth Client page, copy Client ID and Client Secret. Expand "Developer credentials — one-time setup" above and paste them in.',
    },
    {
      title: 'Click Connect YouTube',
      body:  'Hit the Connect YouTube button at the top of this section. Google Sign-In opens — sign in with the Google account that owns your channel. Tokens are saved automatically.',
    },
    {
      title: 'Data API Key (required for YouTube Trending ingestion)',
      body:  'APIs & Services → Credentials → Create Credentials → API Key. Copy and paste into the "Data API Key" field above. This activates the YouTube Trending source in the ingestion pipeline. Free tier: 10,000 units/day.',
    },
  ],
  'Canva': [
    {
      title: 'Join Canva Developers',
      body:  'Go to www.canva.com/developers → Sign in → Create an integration.',
      link:  { label: 'Canva Developer Portal →', url: 'https://www.canva.com/developers' },
    },
    {
      title: 'Create a new integration',
      body:  'Click "Create an integration" → name it "TPCE" → Integration type: "Content Fill" → Save.',
    },
    {
      title: 'Set Redirect URI',
      body:  'In your integration settings add: http://localhost:4000/auth/canva/callback as an Allowed Redirect URI.',
    },
    {
      title: 'Copy Client ID + Client Secret',
      body:  'From your integration page, copy the Client ID and Client Secret. Expand "Developer credentials — one-time setup" above and paste them in.',
    },
    {
      title: 'Click Connect Canva',
      body:  'Hit the Connect Canva button at the top of this section. Canva Login opens — sign in with your Canva account. Your account is linked automatically.',
    },
  ],
  'Product Hunt': [
    {
      title: 'Create a free Product Hunt account',
      body:  'Go to producthunt.com and sign up if you don\'t have one. No payment needed — the Developer Token is completely free.',
      link:  { label: 'producthunt.com →', url: 'https://www.producthunt.com' },
    },
    {
      title: 'Go to the API applications page',
      body:  'Visit api.producthunt.com/v2/oauth/applications → click "Add an application".',
      link:  { label: 'API Applications →', url: 'https://api.producthunt.com/v2/oauth/applications' },
    },
    {
      title: 'Create the application',
      body:  'Name: TPCE · Redirect URI: http://localhost · Click "Create". On the next screen you\'ll see your Developer Token.',
    },
    {
      title: 'Copy and paste the Developer Token',
      body:  'Copy the Developer Token (starts with ph_) and paste it into the field above. This boosts your rate limit from ~10 requests/hour to the full authenticated quota.',
    },
  ],
  'Exploding Topics': [
    {
      title: 'Subscribe to Exploding Topics Pro',
      body:  'Go to explodingtopics.com/pricing and subscribe to the Pro plan (~$39/mo). This is required — their public API endpoints are no longer accessible without a subscription.',
      link:  { label: 'Exploding Topics Pricing →', url: 'https://explodingtopics.com/pricing' },
    },
    {
      title: 'Find your API Key',
      body:  'After subscribing, log in to your dashboard → navigate to Settings or API section → generate an API key.',
    },
    {
      title: 'Paste the key above',
      body:  'Paste your API key into the "API Key" field above and click Save. Exploding Topics will activate on the next pipeline run and surface early-signal trends 6–18 months before they peak.',
    },
  ],
  'Pipeline': [
    {
      title: 'Approval Required',
      body:  'ON = every generated piece of content needs your manual approval before scheduling. OFF = content is auto-approved (fully autonomous mode). Recommended: ON while getting started.',
    },
    {
      title: 'Dry-run Mode',
      body:  'ON = pipeline runs but nothing is actually posted to Instagram/YouTube. Great for testing. Turn OFF when you\'re ready to go live.',
    },
    {
      title: 'Max Posts Per Day',
      body:  'How many posts to schedule per page per day. Instagram best practice: 1–2/day for feed, up to 5 for Reels.',
    },
    {
      title: 'Post Times',
      body:  'Enter times in HH:MM format separated by commas. Example: 09:00,12:00,18:00. The scheduler will use your timezone from the server.',
    },
  ],
};

function SetupGuide({ group }: { group: string }) {
  const [open, setOpen] = React.useState(false);
  const steps = SETUP_GUIDES[group];
  if (!steps || steps.length === 0) return null;

  return (
    <div style={{
      marginTop: 20,
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      overflow: 'hidden',
    }}>
      {/* Toggle header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', padding: '12px 16px',
          background: open ? 'var(--bg-elevated)' : 'var(--bg-surface)',
          border: 'none', cursor: 'pointer', textAlign: 'left',
          borderBottom: open ? '1px solid var(--border)' : 'none',
          transition: 'background 0.15s',
        }}
      >
        <span style={{ fontSize: 15 }}>📖</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            How to get {group} credentials
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
            Step-by-step setup guide — no technical knowledge needed
          </div>
        </div>
        <span style={{
          fontSize: 11, color: 'var(--text-muted)',
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s',
          display: 'inline-block',
        }}>▼</span>
      </button>

      {/* Steps */}
      {open && (
        <div style={{ padding: '16px 16px 8px', background: 'var(--bg-surface)' }}>
          {steps.map((step, i) => (
            <div key={i} style={{
              display: 'flex', gap: 14, marginBottom: 20,
            }}>
              {/* Step number bubble */}
              <div style={{
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                background: 'var(--accent-dim)', border: '1.5px solid var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: 'var(--accent)',
                marginTop: 1,
              }}>
                {i + 1}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                  {step.title.replace(/^\d+\. /, '')}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.65 }}>
                  {step.body}
                </div>
                {step.link && (
                  <a
                    href={step.link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      marginTop: 8, fontSize: 11, color: 'var(--accent)',
                      fontWeight: 600, textDecoration: 'none',
                      padding: '3px 8px', borderRadius: 4,
                      background: 'var(--accent-dim)',
                      border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                    }}
                  >
                    {step.link.label}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── OAuthCredentialFields ────────────────────────────────────────────────────
// Collapsible panel for App ID / Secret — secondary, hidden by default.
// Users only need this once when setting up the developer app.

function OAuthCredentialFields({ group, fieldsInGroup, config, dirty, onChange }: {
  group:         string;
  fieldsInGroup: string[];
  config:        ConfigData;
  dirty:         Record<string, string>;
  onChange:      (key: string, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const dirtyCount = fieldsInGroup.filter(k => dirty[k]).length;

  return (
    <div style={{ border:'1px solid var(--border)', borderRadius:'var(--radius)',
      overflow:'hidden', marginBottom:16 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width:'100%', display:'flex', alignItems:'center', gap:10,
          padding:'10px 14px', background:'var(--bg-elevated)',
          border:'none', cursor:'pointer', textAlign:'left',
          color:'var(--text-primary)' }}
      >
        <span style={{ fontSize:13 }}>⚙️</span>
        <div style={{ flex:1 }}>
          <span style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)' }}>
            Developer credentials — one-time setup
          </span>
          {dirtyCount > 0 && (
            <span style={{ marginLeft:8, fontSize:10, color:'var(--accent)',
              background:'var(--accent-dim)', padding:'1px 6px', borderRadius:10 }}>
              {dirtyCount} unsaved
            </span>
          )}
        </div>
        <span style={{ fontSize:11, color:'var(--text-muted)',
          transform: open ? 'rotate(180deg)' : 'none', transition:'transform 0.2s',
          display:'inline-block' }}>▼</span>
      </button>
      {open && (
        <div style={{ background:'var(--bg-surface)', padding:'0 16px' }}>
          <div style={{ fontSize:11, color:'var(--text-muted)', padding:'10px 0 6px',
            lineHeight:1.6, borderBottom:'1px solid var(--border)', marginBottom:4 }}>
            These are your <strong>{group} developer app</strong> credentials — not your personal account.
            You only need to fill this in once. After saving, click <strong>Connect {group}</strong> above.
          </div>
          {fieldsInGroup.map(key => (
            <ConfigRow key={key} fieldKey={key}
              meta={config.meta[key]} current={config.values[key]}
              onChange={onChange}/>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

const GROUP_ORDER_WITH_BRANDING = [
  'AI / LLM', 'Branding', 'Sources', 'Pipeline',
  'Image Generation',
  'Reddit', 'Product Hunt',
  'Twitter / X', 'Exploding Topics',
  'Instagram', 'YouTube', 'Canva',
];
const ALL_GROUP_ICONS: Record<string, string> = {
  ...GROUP_ICONS,
  'Branding':         '🎨',
  'Image Generation': '🖼️',
};

export const SettingsView: React.FC = () => {
  const [config,      setConfig]     = useState<ConfigData | null>(null);
  const [integrations,setIntegrations] = useState<Record<string, Integration>>({});
  const [loading,     setLoading]    = useState(true);
  const [activeGroup, setActiveGroup] = useState('AI / LLM');
  const [dirty,       setDirty]      = useState<Record<string, string>>({});
  const [saving,      setSaving]     = useState(false);
  const [saveMsg,     setSaveMsg]    = useState<string | null>(null);
  const [settingsPageId, setSettingsPageId] = useState<string | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetting,    setResetting]    = useState(false);
  const [resetMsg,     setResetMsg]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, sett, pages] = await Promise.all([
        api.getConfig(),
        api.getSettings(),
        api.getPages(),
      ]);
      setConfig(cfg);
      setIntegrations(sett.integrations ?? {});
      if (pages.length > 0 && !settingsPageId) setSettingsPageId(pages[0].id);
    } catch {}
    finally { setLoading(false); }
  }, [settingsPageId]);

  useEffect(() => { load(); }, [load]);

  const handleChange = (key: string, value: string) => {
    setDirty(d => ({ ...d, [key]: value }));
    setConfig(c => c ? {
      ...c, values: { ...c.values, [key]: { value, masked: false } }
    } : c);
  };

  const handleSave = async () => {
    if (!Object.keys(dirty).length) return;
    setSaving(true);
    try {
      const { saved } = await api.patchConfig(dirty);
      setDirty({});
      setSaveMsg(`✓ Saved ${saved.length} field${saved.length !== 1 ? 's' : ''}`);
      setTimeout(() => { setSaveMsg(null); load(); }, 2200);
    } catch {
      setSaveMsg('✗ Save failed');
      setTimeout(() => setSaveMsg(null), 3000);
    } finally { setSaving(false); }
  };

  const handleReset = async () => {
    if (!resetConfirm) { setResetConfirm(true); return; }
    setResetting(true);
    setResetConfirm(false);
    try {
      await api.resetPipeline();
      setResetMsg('✓ Pipeline data cleared — topics, content and posts deleted');
      setTimeout(() => setResetMsg(null), 5000);
    } catch {
      setResetMsg('✗ Reset failed');
      setTimeout(() => setResetMsg(null), 3000);
    } finally { setResetting(false); }
  };

  const groups       = config ? groupFields(config.meta) : {};
  // Add Branding as a virtual group (not in config meta — it's per-page)
  const allGroups    = { ...groups, Branding: [] } as Record<string, string[]>;
  const fieldsInGroup  = groups[activeGroup] ?? [];
  const dirtyCount   = Object.keys(dirty).length;
  const isIntegGroup = INTEGRATION_GROUPS.includes(activeGroup);
  const integStatus  = integrations[INTEG_KEY[activeGroup] ?? ''];

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

      {/* Topbar — same pattern as every other view */}
      <div className="topbar">
        <span className="topbar-title">Settings & Configuration</span>
        {loading && <span style={{ marginLeft:12, fontSize:11, color:'var(--text-muted)' }}>Loading…</span>}
        <div className="topbar-right">
          {dirtyCount > 0 && (
            <span style={{ fontSize:11, color:'var(--accent)', fontFamily:'var(--mono)' }}>
              {dirtyCount} unsaved
            </span>
          )}
          {saveMsg && (
            <span style={{ fontSize:11,
              color: saveMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)' }}>
              {saveMsg}
            </span>
          )}
          <button className="btn btn-primary btn-sm"
            disabled={saving || dirtyCount === 0} onClick={handleSave}>
            {saving ? 'Saving…' : <><Icon name="check" size={11}/> Save All</>}
          </button>
        </div>
      </div>

      {/* Body — same 2-column pattern as Dashboard */}
      <div style={{ flex:1, display:'grid', gridTemplateColumns:'1fr 220px',
        overflow:'hidden', minHeight:0 }}>

        {/* CENTER — scrollable config form */}
        <div className="view-area" style={{ borderRight:'1px solid var(--border)' }}>
          {/* AI/LLM has its own multi-provider manager */}
          {activeGroup === 'AI / LLM' ? (
            <LLMManager />
          ) : activeGroup === 'Branding' ? (
            <BrandingSection/>
          ) : activeGroup === 'Sources' ? (
            <SourcesPanel />
          ) : activeGroup === 'Image Generation' ? (
            <ImageGenManager />
          ) : loading ? (
            <div style={{ color:'var(--text-muted)', fontSize:13 }}>Loading configuration…</div>
          ) : !config ? (
            <div style={{ color:'var(--text-muted)', fontSize:13 }}>Failed to load config.</div>
          ) : (
            <>
              {/* OAuth connect card — shown for Instagram / YouTube / Canva instead of static status */}
              {(['Instagram', 'YouTube', 'Canva'] as const).includes(activeGroup as any) ? (
                <>
                  <OAuthConnectCard
                    provider={activeGroup.toLowerCase() as OAuthProvider}
                    pageId={settingsPageId}
                  />
                  {/* Divider before credentials section */}
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:10, marginTop:4 }}>
                    ↓ Fill in your App credentials below, then click Connect above.
                  </div>
                </>
              ) : (
                /* Static status banner for Reddit / Twitter */
                isIntegGroup && integStatus && (
                  <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
                    background: integStatus.connected ? '#10b98111' : 'var(--bg-elevated)',
                    border:`1px solid ${integStatus.connected ? 'var(--green)' : 'var(--border)'}`,
                    borderRadius:'var(--radius-sm)', marginBottom:20 }}>
                    <span style={{ fontSize:20 }}>{GROUP_ICONS[activeGroup]}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:600 }}>{integStatus.label}</div>
                      <div style={{ fontSize:11, color:'var(--text-muted)' }}>{GROUP_DESC[activeGroup]}</div>
                    </div>
                    {integStatus.connected
                      ? <span className="badge badge-green badge-dot">Connected</span>
                      : <span className="badge badge-muted">Not connected — fill keys below</span>
                    }
                  </div>
                )
              )}

              {/* Fields — OAuth groups show a collapsible credentials panel;
                  all other groups show the header + fields directly */}
              {(['Instagram', 'YouTube', 'Canva'] as const).includes(activeGroup as any) ? (
                fieldsInGroup.length > 0 && (
                  <OAuthCredentialFields
                    group={activeGroup}
                    fieldsInGroup={fieldsInGroup}
                    config={config}
                    dirty={dirty}
                    onChange={handleChange}
                  />
                )
              ) : (
                <>
                  {/* Section header */}
                  <div style={{ marginBottom:16 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                      <span style={{ fontSize:18 }}>{GROUP_ICONS[activeGroup]}</span>
                      <span style={{ fontSize:16, fontWeight:700 }}>{activeGroup}</span>
                      {PREMIUM_GROUPS.has(activeGroup) && (
                        <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px',
                          borderRadius:4, background:'color-mix(in srgb, var(--accent) 15%, transparent)',
                          color:'var(--accent)', border:'1px solid color-mix(in srgb, var(--accent) 30%, transparent)',
                          letterSpacing:'0.05em' }}>PRO</span>
                      )}
                    </div>
                    <div style={{ fontSize:12, color:'var(--text-muted)' }}>
                      {GROUP_DESC[activeGroup]}
                      {' '}Saved to{' '}
                      <code style={{ fontFamily:'var(--mono)', background:'var(--bg-elevated)',
                        padding:'1px 5px', borderRadius:3 }}>data/app.config.json</code>
                      {' '}— no restart needed.
                    </div>
                  </div>

                  {/* Premium source banner */}
                  {PREMIUM_GROUPS.has(activeGroup) && (
                    <div style={{ display:'flex', gap:12, padding:'12px 14px', marginBottom:16,
                      background:'color-mix(in srgb, var(--accent) 6%, transparent)',
                      border:'1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
                      borderRadius:'var(--radius-sm)' }}>
                      <span style={{ fontSize:20, flexShrink:0 }}>🔒</span>
                      <div style={{ fontSize:12, color:'var(--text-secondary)', lineHeight:1.65 }}>
                        <strong style={{ color:'var(--text-primary)' }}>Premium source — requires a paid subscription.</strong>
                        {' '}The source is skipped during ingestion until a valid API key is saved here.
                        See the setup guide below for instructions.
                      </div>
                    </div>
                  )}

                  <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)',
                    borderRadius:'var(--radius)', padding:'0 16px' }}>
                    {fieldsInGroup.map(key => (
                      <ConfigRow key={key} fieldKey={key}
                        meta={config.meta[key]} current={config.values[key]}
                        onChange={handleChange}/>
                    ))}
                  </div>
                </>
              )}

              {/* Setup guide — shown below config fields */}
              <SetupGuide group={activeGroup} />

              {/* Danger Zone — Pipeline section only */}
              {activeGroup === 'Pipeline' && (
                <div style={{ marginTop:24, padding:16,
                  border:'1px solid var(--red, #ef4444)', borderRadius:'var(--radius)',
                  background:'rgba(239,68,68,0.04)' }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'var(--red, #ef4444)',
                    textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:6 }}>
                    ⚠ Danger Zone
                  </div>
                  <div style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:12, lineHeight:1.6 }}>
                    <strong>Reset Pipeline Data</strong> deletes all topics, generated content, and posts
                    from the database. Niches, pages, and settings are untouched.
                    Use this to start fresh after testing.
                  </div>
                  {resetMsg && (
                    <div style={{ fontSize:11, marginBottom:10,
                      color: resetMsg.startsWith('✓') ? 'var(--green)' : 'var(--red, #ef4444)',
                      fontWeight:600 }}>
                      {resetMsg}
                    </div>
                  )}
                  {resetConfirm ? (
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontSize:12, color:'var(--red, #ef4444)', fontWeight:600 }}>
                        Are you sure? This cannot be undone.
                      </span>
                      <button
                        className="btn btn-sm"
                        disabled={resetting}
                        onClick={handleReset}
                        style={{ background:'var(--red, #ef4444)', color:'#fff',
                          border:'none', fontWeight:700 }}>
                        {resetting ? 'Deleting…' : 'Yes, delete everything'}
                      </button>
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => setResetConfirm(false)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-sm"
                      onClick={handleReset}
                      style={{ border:'1px solid var(--red, #ef4444)',
                        color:'var(--red, #ef4444)', background:'transparent', fontWeight:600 }}>
                      🗑 Reset Pipeline Data
                    </button>
                  )}
                </div>
              )}

              {/* Per-section save */}
              {dirtyCount > 0 && (
                <div style={{ marginTop:16, display:'flex', gap:10, alignItems:'center' }}>
                  <button className="btn btn-primary btn-sm"
                    disabled={saving} onClick={handleSave}>
                    {saving ? 'Saving…' : <><Icon name="check" size={11}/> Save Changes</>}
                  </button>
                  <button className="btn btn-ghost btn-sm"
                    onClick={() => { setDirty({}); load(); }}>
                    Discard
                  </button>
                  <span style={{ fontSize:11, color:'var(--text-muted)' }}>
                    {dirtyCount} field{dirtyCount !== 1 ? 's' : ''} changed
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* RIGHT PANEL — sectioned group nav */}
        <div style={{ display:'flex', flexDirection:'column', overflowY:'auto',
          background:'var(--bg-surface)', padding:'12px 0' }}>
          {NAV_SECTIONS.map((section, si) => {
            const sectionGroups = section.groups.filter(g => allGroups[g] !== undefined);
            if (sectionGroups.length === 0) return null;
            return (
              <div key={section.label}>
                {si > 0 && <div className="divider" style={{ margin:'8px 14px' }}/>}
                <div style={{ padding:'6px 14px 4px', fontSize:9, fontWeight:700,
                  letterSpacing:'0.09em', textTransform:'uppercase',
                  color:'var(--text-muted)' }}>
                  {section.label}
                </div>
                {sectionGroups.map(group => {
                  const isDirty   = (groups[group] ?? []).some(k => dirty[k]);
                  const isActive  = group === activeGroup;
                  const integKey  = INTEG_KEY[group];
                  const connected = integKey ? integrations[integKey]?.connected : undefined;
                  const isPremium = PREMIUM_GROUPS.has(group);

                  return (
                    <button key={group}
                      onClick={() => setActiveGroup(group)}
                      style={{ display:'flex', alignItems:'center', gap:9, width:'100%',
                        padding:'8px 14px', background: isActive ? 'var(--bg-hover)' : 'transparent',
                        border:'none', borderLeft:`2px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                        cursor:'pointer', textAlign:'left' }}>
                      <span style={{ fontSize:13, flexShrink:0 }}>{ALL_GROUP_ICONS[group]}</span>
                      <span style={{ fontSize:12, fontWeight: isActive ? 600 : 400,
                        color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                        flex:1, lineHeight:1.3 }}>
                        {group}
                      </span>
                      <div style={{ display:'flex', gap:4, alignItems:'center', flexShrink:0 }}>
                        {isPremium && (
                          <span style={{ fontSize:8, fontWeight:700, padding:'1px 4px',
                            borderRadius:3, background:'color-mix(in srgb, var(--accent) 15%, transparent)',
                            color:'var(--accent)', border:'1px solid color-mix(in srgb, var(--accent) 25%, transparent)',
                            letterSpacing:'0.05em' }}>PRO</span>
                        )}
                        {isDirty && (
                          <div style={{ width:5, height:5, borderRadius:'50%',
                            background:'var(--accent)' }} title="Unsaved changes"/>
                        )}
                        {connected === true  && <div style={{ width:5, height:5, borderRadius:'50%', background:'var(--green)' }} title="Connected"/>}
                        {connected === false && <div style={{ width:5, height:5, borderRadius:'50%', background:'var(--border-strong)' }} title="Not connected"/>}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}

          <div className="divider" style={{ margin:'10px 14px' }}/>
          <div style={{ padding:'0 14px' }}>
            <div style={{ fontSize:9, color:'var(--text-muted)', lineHeight:1.6 }}>
              Saved to <code style={{ fontFamily:'var(--mono)', fontSize:9 }}>data/app.config.json</code>
              <br/>
              .env values used as fallbacks.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
