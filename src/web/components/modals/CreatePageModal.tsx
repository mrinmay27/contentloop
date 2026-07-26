import React, { useState } from 'react';
import { Icon } from '../ui/Icon';
import { api } from '../../lib/api';
// Imported rather than duplicated: tone ids must match what the generator
// reads from pages.brand.tone, and this module is pure (no node deps), so it
// bundles cleanly. Local copies are the convention for server config shapes
// that would drag in server-only imports — this one wouldn't.
import { CAPTION_TONES, DEFAULT_TONE } from '../../../domain/tone';
import type { CaptionTone } from '../../../domain/tone';
import type { ThemePage } from '../../lib/types';

const NICHES = [
  { id:'n1',  name:'AI Tools',         trendScore:97, monetizationScore:92, competition:'High', growth:'+34%', emoji:'🤖' },
  { id:'n2',  name:'Side Hustles',      trendScore:94, monetizationScore:96, competition:'Med',  growth:'+28%', emoji:'💰' },
  { id:'n3',  name:'Crypto & Web3',     trendScore:85, monetizationScore:88, competition:'High', growth:'+19%', emoji:'⛓️' },
  { id:'n4',  name:'Fitness & Health',  trendScore:91, monetizationScore:85, competition:'High', growth:'+22%', emoji:'💪' },
  { id:'n5',  name:'Personal Finance',  trendScore:89, monetizationScore:93, competition:'Med',  growth:'+31%', emoji:'📊' },
  { id:'n6',  name:'Mental Health',     trendScore:88, monetizationScore:72, competition:'Low',  growth:'+41%', emoji:'🧠' },
  { id:'n7',  name:'Productivity',      trendScore:86, monetizationScore:80, competition:'Med',  growth:'+18%', emoji:'⚡' },
  { id:'n8',  name:'Travel Hacks',      trendScore:83, monetizationScore:78, competition:'Med',  growth:'+15%', emoji:'✈️' },
  { id:'n9',  name:'Real Estate',       trendScore:80, monetizationScore:94, competition:'Low',  growth:'+12%', emoji:'🏠' },
  { id:'n10', name:'Sustainable Living',trendScore:79, monetizationScore:70, competition:'Low',  growth:'+47%', emoji:'🌿' },
  { id:'n11', name:'Creator Economy',   trendScore:88, monetizationScore:89, competition:'Med',  growth:'+26%', emoji:'🎬' },
  { id:'n12', name:'Tech News',         trendScore:82, monetizationScore:75, competition:'High', growth:'+11%', emoji:'💻' },
];

const NAMES = ['AI Tools Daily','The AI Toolkit','Automate Everything','AI Insider Daily',
  'The Future Worker','AI Edge','Smart Tools HQ','The AI Stack','Build With AI','AI Creators Lab'];

const COLORS = ['#F5A623','#10B981','#6366F1','#EF4444','#0EA5E9','#EC4899','#8B5CF6','#14B8A6'];

const STEP_LABELS = ['Niche','Keywords','Name','Branding'];

// Sprint U1 Task 5: sentinel id for the "+ Custom niche" card — routes the
// wizard to api.createNiche()/api.createPage() instead of the static NICHES
// list, which stays untouched for the standard path.
const CUSTOM_NICHE_ID = '__custom__';

const parseCsv = (raw: string): string[] =>
  [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))];

type Props = {
  onClose: () => void;
  onCreate: (page: Omit<ThemePage, 'id'> & { id?: string }) => void;
  /** Sprint U1 Task 5: surfaces a short-lived notice banner in App (e.g.
   *  "sources are being generated") — App has no toast system today, so this
   *  is the smallest hook that lets the modal report async follow-up work. */
  onNotice?: (message: string) => void;
};

export const CreatePageModal: React.FC<Props> = ({ onClose, onCreate, onNotice }) => {
  const [step, setStep]                   = useState(1);
  const [selectedNiche, setSelectedNiche] = useState<string|null>(null);
  const [nicheSearch, setNicheSearch]     = useState('');
  const [keywords, setKeywords]           = useState(['AI tools','automation','ChatGPT','productivity hacks','side hustle','passive income','AI art','no code']);
  const [selectedName, setSelectedName]   = useState<string|null>(null);
  const [primaryColor, setPrimaryColor]   = useState('#F5A623');
  const [captionTone, setCaptionTone]     = useState<CaptionTone>(DEFAULT_TONE);

  // Custom niche fields (Sprint U1 Task 5) — only used when
  // selectedNiche === CUSTOM_NICHE_ID.
  const [customName, setCustomName]             = useState('');
  const [customKeywordsRaw, setCustomKeywordsRaw] = useState('');
  const [customPersona, setCustomPersona]         = useState('');
  const [customMonetizationRaw, setCustomMonetizationRaw] = useState('');
  const [creating, setCreating]     = useState(false);
  const [createError, setCreateError] = useState<string|null>(null);

  const filteredNiches = NICHES.filter(n => n.name.toLowerCase().includes(nicheSearch.toLowerCase()));
  const isCustom = selectedNiche === CUSTOM_NICHE_ID;
  const customKeywordsList = parseCsv(customKeywordsRaw);
  const customValid = customName.trim().length >= 2 && customKeywordsList.length >= 2 && customPersona.trim().length >= 3;

  const canNext =
    (step===1 && (isCustom ? customValid : !!selectedNiche)) ||
    (step===2 && keywords.length >= (isCustom ? 2 : 1)) || // custom niches need >=2 (API zod .min(2))
    (step===3 && !!selectedName) ||
    step===4;

  // Moving past the custom-niche step seeds the shared `keywords` state from
  // the comma-separated input so Step 2's existing add/remove-tag UI works
  // unchanged for both flows.
  const goNext = () => {
    if (step === 1 && isCustom) setKeywords(customKeywordsList);
    setStep(s => s + 1);
  };

  const handleCreate = async () => {
    if (!isCustom) {
      const niche = NICHES.find(n => n.id===selectedNiche);
      onCreate({ name: selectedName!, niche: niche?.name ?? 'Custom', nicheId: niche?.id ?? '', accent: primaryColor, status:'active', posts:0, followers:'0' });
      onClose();
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const { niche } = await api.createNiche({
        name: customName,
        keywords,
        monetizationKeywords: parseCsv(customMonetizationRaw),
        negativeKeywords: [],
        targetPersona: customPersona,
      });
      const { page } = await api.createPage({
        nicheId: niche.id,
        name: selectedName!,
        brand: { accent: primaryColor, tone: captionTone },
      });
      // Fire-and-forget — the Sources panel shows progress/results; a failure
      // here shouldn't block the page from being created.
      api.regenerateSources(page.id).catch(() => {});
      onNotice?.('Sources are being generated — review them in Settings → Sources.');
      onCreate({
        id: page.id,
        name: page.name,
        niche: niche.name,
        nicheId: niche.id,
        accent: primaryColor,
        status: 'active',
        posts: 0,
        followers: '0',
      });
      onClose();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create custom niche');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div style={{ fontWeight:700, fontSize:15 }}>Create New Theme Page</div>
            <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>Step {step} of 4 — {STEP_LABELS[step-1]}</div>
          </div>
          <button className="btn-icon" onClick={onClose}><Icon name="x" size={14}/></button>
        </div>

        {/* Wizard progress */}
        <div style={{ padding:'16px 24px 0' }}>
          <div className="wizard-steps">
            {STEP_LABELS.map((label,i) => (
              <div key={label} className={`wizard-step ${i+1<step?'done':i+1===step?'active':''}`}>
                <div className="wizard-step-dot">
                  {i+1<step ? <Icon name="check" size={12}/> : i+1}
                </div>
                <div className="wizard-step-label">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-body">
          {/* Step 1: Niche */}
          {step===1 && (
            <div>
              <div style={{ marginBottom:14 }}>
                <div className="search-wrap">
                  <span className="search-icon"><Icon name="search" size={12}/></span>
                  <input type="text" className="search-input" placeholder="Search niches…"
                    value={nicheSearch} onChange={e => setNicheSearch(e.target.value)} style={{ width:'100%' }}/>
                </div>
              </div>
              <div className="niche-grid">
                {filteredNiches.map(niche => (
                  <div key={niche.id} className={`niche-card ${selectedNiche===niche.id?'selected':''}`}
                    onClick={() => setSelectedNiche(niche.id)}>
                    <div className="niche-card-name">
                      <span style={{ fontSize:16 }}>{niche.emoji}</span>{niche.name}
                      {selectedNiche===niche.id && <span style={{ marginLeft:'auto' }}><Icon name="check" size={12}/></span>}
                    </div>
                    <div className="niche-scores">
                      <div>
                        <div className="niche-score-label">Trend</div>
                        <div className="niche-score-val" style={{ color:'var(--accent)' }}>{niche.trendScore}</div>
                        <div className="score-bar"><div className="score-fill" style={{ width:`${niche.trendScore}%` }}/></div>
                      </div>
                      <div>
                        <div className="niche-score-label">Monetization</div>
                        <div className="niche-score-val" style={{ color:'var(--green)' }}>{niche.monetizationScore}</div>
                        <div className="score-bar"><div className="score-fill" style={{ width:`${niche.monetizationScore}%`, background:'var(--green)' }}/></div>
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:6, marginTop:8, alignItems:'center' }}>
                      <span className={`badge ${niche.competition==='Low'?'badge-green':niche.competition==='Med'?'badge-amber':'badge-red'}`}>{niche.competition} competition</span>
                      <span style={{ fontSize:11, color:'var(--green)', fontFamily:'var(--mono)', marginLeft:'auto' }}>↑ {niche.growth}</span>
                    </div>
                  </div>
                ))}

                {/* Sprint U1 Task 5: custom-niche path — creates a real niche
                    (POST /api/niches) instead of picking from the static list. */}
                <div key={CUSTOM_NICHE_ID}
                  className={`niche-card ${isCustom ? 'selected' : ''}`}
                  style={{ borderStyle: 'dashed' }}
                  onClick={() => setSelectedNiche(CUSTOM_NICHE_ID)}>
                  <div className="niche-card-name">
                    <span style={{ fontSize:16 }}>➕</span>Custom niche
                    {isCustom && <span style={{ marginLeft:'auto' }}><Icon name="check" size={12}/></span>}
                  </div>
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:6 }}>
                    Define your own niche — name, keywords, persona.
                  </div>
                </div>
              </div>

              {isCustom && (
                <div style={{ marginTop:16, display:'flex', flexDirection:'column', gap:10,
                  padding:14, background:'var(--bg-elevated)', borderRadius:'var(--radius-sm)',
                  border:'1px solid var(--border)' }}>
                  <div>
                    <div className="section-label" style={{ marginBottom:6 }}>Niche name</div>
                    <input type="text" placeholder="e.g. AI for Nurses" style={{ width:'100%' }}
                      value={customName} onChange={e => setCustomName(e.target.value)}/>
                  </div>
                  <div>
                    <div className="section-label" style={{ marginBottom:6 }}>Keywords (comma-separated, 2+)</div>
                    <input type="text" placeholder="e.g. nursing, patient care, clinical AI" style={{ width:'100%' }}
                      value={customKeywordsRaw} onChange={e => setCustomKeywordsRaw(e.target.value)}/>
                  </div>
                  <div>
                    <div className="section-label" style={{ marginBottom:6 }}>Target persona</div>
                    <input type="text" placeholder="e.g. Working nurses curious about AI tools" style={{ width:'100%' }}
                      value={customPersona} onChange={e => setCustomPersona(e.target.value)}/>
                  </div>
                  <div>
                    <div className="section-label" style={{ marginBottom:6 }}>Monetization keywords (optional)</div>
                    <input type="text" placeholder="e.g. course, certification, software" style={{ width:'100%' }}
                      value={customMonetizationRaw} onChange={e => setCustomMonetizationRaw(e.target.value)}/>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Keywords */}
          {step===2 && (
            <div>
              <div style={{ marginBottom:12, padding:'10px 14px', background:'var(--bg-elevated)', borderRadius:'var(--radius-sm)', border:'1px solid var(--border)' }}>
                <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:4 }}>Auto-generated for</div>
                <div style={{ fontWeight:600 }}>{isCustom ? customName : NICHES.find(n=>n.id===selectedNiche)?.name}</div>
              </div>
              <div className="section-label" style={{ marginBottom:8 }}>Keywords — click to remove</div>
              <div className="keyword-tags" style={{ marginBottom:16 }}>
                {keywords.map(kw => (
                  <span key={kw} className="tag" style={{ cursor:'pointer' }}
                    onClick={() => setKeywords(k => k.filter(x=>x!==kw))}>
                    {kw} <span className="tag-remove">×</span>
                  </span>
                ))}
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <input type="text" placeholder="Add custom keyword…" style={{ flex:1 }}
                  onKeyDown={e => { if (e.key==='Enter' && (e.target as HTMLInputElement).value) {
                    setKeywords(k => [...k, (e.target as HTMLInputElement).value]);
                    (e.target as HTMLInputElement).value = '';
                  }}}/>
                <button className="btn btn-ghost btn-sm"><Icon name="refresh" size={11}/> Regenerate</button>
              </div>
            </div>
          )}

          {/* Step 3: Name */}
          {step===3 && (
            <div>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                <div style={{ fontSize:13, color:'var(--text-secondary)' }}>Select a name or type your own</div>
                <button className="btn btn-sm btn-ghost"><Icon name="refresh" size={11}/> Regenerate</button>
              </div>
              <input type="text" placeholder="Or type a custom name…" style={{ width:'100%', marginBottom:14 }}
                onChange={e => setSelectedName(e.target.value || null)}/>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }} className="stagger">
                {NAMES.map(name => (
                  <div key={name} className={`name-suggestion ${selectedName===name?'selected':''}`}
                    onClick={() => setSelectedName(name)}>
                    <span style={{ fontWeight:500, fontSize:13 }}>{name}</span>
                    <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                      <span style={{ fontSize:11, color:'var(--green)', fontFamily:'var(--mono)' }}>✓ Available</span>
                      {selectedName===name && <Icon name="check" size={13}/>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 4: Branding */}
          {step===4 && (
            <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
              <div>
                <div className="section-label" style={{ marginBottom:8 }}>Logo</div>
                <div className="upload-zone">
                  <Icon name="upload" size={20}/>
                  <span style={{ fontSize:13, fontWeight:500 }}>Upload logo image</span>
                  <span style={{ fontSize:11, color:'var(--text-muted)' }}>PNG, SVG · recommended 400×400px</span>
                </div>
              </div>
              <div>
                <div className="section-label" style={{ marginBottom:8 }}>Brand Color</div>
                <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                  {COLORS.map(color => (
                    <div key={color} className={`color-swatch ${primaryColor===color?'active':''}`}
                      style={{ background:color }} onClick={() => setPrimaryColor(color)}/>
                  ))}
                </div>
              </div>
              <div>
                <div className="section-label" style={{ marginBottom:8 }}>Caption Tone</div>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                  {CAPTION_TONES.map(tone => (
                    <button
                      key={tone.id}
                      type="button"
                      aria-pressed={captionTone===tone.id}
                      className={`btn btn-sm ${captionTone===tone.id?'btn-primary':'btn-ghost'}`}
                      onClick={() => setCaptionTone(tone.id)}
                    >
                      {tone.label}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:8 }}>
                  Sets the voice ContentLoop writes captions and scripts in. You can change it later.
                </div>
              </div>
            </div>
          )}
        </div>

        {createError && (
          <div style={{ padding:'0 24px', color:'var(--red)', fontSize:12 }}>{createError}</div>
        )}

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => step>1 ? setStep(s=>s-1) : onClose()} disabled={creating}>
            {step>1 ? '← Back' : 'Cancel'}
          </button>
          <button className="btn btn-primary" disabled={!canNext || creating}
            style={{ opacity: (canNext && !creating) ? 1 : 0.4 }}
            onClick={() => step<4 ? goNext() : handleCreate()}>
            {creating ? 'Creating…' : step<4 ? 'Continue →' : '🚀 Create Theme Page'}
          </button>
        </div>
      </div>
    </div>
  );
};
