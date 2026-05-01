/**
 * CanvaPanel — right-panel section inside ContentEditor.
 *
 * States:
 *   not_connected → shows Connect button (opens OAuth flow)
 *   connected, no_template → shows template picker
 *   template_selected → shows Autofill button
 *   autofilling → spinner
 *   done → edit URL + export buttons
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Icon } from '../ui/Icon';
import { api } from '../../lib/api';

type Template = { id: string; title: string; thumbnail?: { url: string } };
type Design   = { id: string; title: string; thumbnail?: { url: string }; urls?: { edit_url?: string } };

type Props = {
  pageId:  string;
  /** The current hook text to push into the template */
  hook:    string;
  /** Slide texts for carousel autofill */
  slides:  string[];
};

type Phase =
  | 'checking'
  | 'not_connected'
  | 'picking_template'
  | 'template_selected'
  | 'autofilling'
  | 'done'
  | 'error';

export const CanvaPanel: React.FC<Props> = ({ pageId, hook, slides }) => {
  const [phase,       setPhase]       = useState<Phase>('checking');
  const [templates,   setTemplates]   = useState<Template[]>([]);
  const [selectedTpl, setSelectedTpl] = useState<Template | null>(null);
  const [fields,      setFields]      = useState<{ name:string; type:string }[]>([]);
  const [resultDesign,setResultDesign]= useState<{ id:string; editUrl:string } | null>(null);
  const [exportUrls,  setExportUrls]  = useState<string[]>([]);
  const [error,       setError]       = useState<string | null>(null);
  const [exporting,   setExporting]   = useState(false);

  // ─── Check connection on mount ────────────────────────────────────────
  useEffect(() => {
    api.canvaStatus(pageId)
      .then(({ connected }) => {
        setPhase(connected ? 'picking_template' : 'not_connected');
        if (connected) loadTemplates();
      })
      .catch(() => setPhase('not_connected'));
  }, [pageId]);

  const loadTemplates = useCallback(async () => {
    try {
      const { templates } = await api.canvaTemplates(pageId);
      setTemplates(templates);
    } catch {
      // Fall back to listing regular designs if brand templates fail
      try {
        const { designs } = await api.canvaDesigns(pageId);
        setTemplates(designs);
      } catch {
        setTemplates([]);
      }
    }
  }, [pageId]);

  // ─── Select template, fetch its autofillable fields ───────────────────
  const handleSelectTemplate = async (tpl: Template) => {
    setSelectedTpl(tpl);
    setPhase('template_selected');
    try {
      const { fields: f } = await api.canvaDataset(pageId, tpl.id);
      setFields(f);
    } catch {
      setFields([]); // not a brand template — autofill will use first text field
    }
  };

  // ─── Build autofill data map from hook + slides ───────────────────────
  const buildAutofillData = () => {
    const data: Record<string, { type: 'text'; text: string }> = {};
    const texts = [hook, ...slides].filter(Boolean);
    if (fields.length > 0) {
      fields.filter(f => f.type === 'text').forEach((f, i) => {
        if (texts[i]) data[f.name] = { type: 'text', text: texts[i] };
      });
    } else {
      // No dataset — use positional names (common in Canva templates)
      texts.forEach((text, i) => {
        data[`text_${i + 1}`] = { type: 'text', text };
      });
    }
    return data;
  };

  // ─── Autofill ─────────────────────────────────────────────────────────
  const handleAutofill = async () => {
    if (!selectedTpl) return;
    setPhase('autofilling');
    setError(null);
    try {
      const data   = buildAutofillData();
      const result = await api.canvaAutofill(pageId, { templateId: selectedTpl.id, data });
      setResultDesign({ id: result.designId, editUrl: result.editUrl });
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Autofill failed');
      setPhase('error');
    }
  };

  // ─── Export ───────────────────────────────────────────────────────────
  const handleExport = async (format: 'png' | 'pdf' | 'mp4') => {
    if (!resultDesign) return;
    setExporting(true);
    try {
      const { urls } = await api.canvaExport(pageId, { designId: resultDesign.id, format });
      setExportUrls(urls);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  // ─── Disconnect ───────────────────────────────────────────────────────
  const handleDisconnect = async () => {
    await api.canvaDisconnect(pageId);
    setPhase('not_connected');
    setTemplates([]);
    setSelectedTpl(null);
    setResultDesign(null);
    setExportUrls([]);
  };

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div style={{ width:'100%' }}>
      <div className="section-label" style={{ marginBottom:8 }}>
        Canva Integration
      </div>

      {/* NOT CONNECTED */}
      {phase === 'not_connected' && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ fontSize:11, color:'var(--text-muted)', lineHeight:1.5 }}>
            Connect Canva to auto-fill your brand templates with this content.
          </div>
          <a href={api.canvaConnectUrl(pageId)}
            style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6,
              padding:'8px 0', borderRadius:'var(--radius-sm)',
              background:'var(--accent)', color:'#000', fontWeight:600, fontSize:12,
              textDecoration:'none', cursor:'pointer' }}>
            <Icon name="canva" size={13}/> Connect Canva
          </a>
        </div>
      )}

      {/* CHECKING */}
      {phase === 'checking' && (
        <div style={{ fontSize:11, color:'var(--text-muted)' }}>Checking connection…</div>
      )}

      {/* PICKING TEMPLATE */}
      {phase === 'picking_template' && (
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          <div style={{ fontSize:11, color:'var(--text-muted)' }}>
            {templates.length === 0 ? 'No brand templates found. Create one in Canva first.' : 'Pick a template to autofill:'}
          </div>
          {templates.map(tpl => (
            <button key={tpl.id} onClick={() => handleSelectTemplate(tpl)}
              style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px',
                background:'var(--bg-hover)', border:'1px solid var(--border)',
                borderRadius:'var(--radius-sm)', cursor:'pointer', width:'100%',
                textAlign:'left' }}>
              {tpl.thumbnail?.url
                ? <img src={tpl.thumbnail.url} style={{ width:36, height:36, borderRadius:4, objectFit:'cover' }} alt=""/>
                : <div style={{ width:36, height:36, borderRadius:4, background:'var(--bg-elevated)',
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>🎨</div>
              }
              <span style={{ fontSize:12, color:'var(--text-primary)', overflow:'hidden',
                textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {tpl.title || 'Untitled'}
              </span>
            </button>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={handleDisconnect}
            style={{ marginTop:4, width:'100%', justifyContent:'center' }}>
            Disconnect Canva
          </button>
        </div>
      )}

      {/* TEMPLATE SELECTED — ready to autofill */}
      {phase === 'template_selected' && selectedTpl && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 10px',
            background:'var(--bg-elevated)', borderRadius:'var(--radius-sm)',
            border:'1px solid var(--border)' }}>
            <span style={{ fontSize:11, color:'var(--text-secondary)', flex:1,
              overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {selectedTpl.title}
            </span>
            <button onClick={() => setPhase('picking_template')}
              style={{ background:'none', border:'none', color:'var(--text-muted)',
                cursor:'pointer', padding:0 }}>
              <Icon name="x" size={10}/>
            </button>
          </div>
          {fields.length > 0 && (
            <div style={{ fontSize:10, color:'var(--text-muted)' }}>
              {fields.length} autofillable field{fields.length !== 1 ? 's' : ''} detected
            </div>
          )}
          <button className="btn btn-primary btn-sm" onClick={handleAutofill}
            style={{ width:'100%', justifyContent:'center' }}>
            <Icon name="canva" size={12}/> Autofill Template
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setPhase('picking_template')}
            style={{ width:'100%', justifyContent:'center' }}>
            Change Template
          </button>
        </div>
      )}

      {/* AUTOFILLING */}
      {phase === 'autofilling' && (
        <div style={{ textAlign:'center', padding:'16px 0', color:'var(--text-muted)', fontSize:12 }}>
          <div style={{ marginBottom:8 }}>Generating your design…</div>
          <div className="pulse" style={{ width:32, height:32, borderRadius:'50%',
            background:'var(--accent)', margin:'0 auto', opacity:0.6 }}/>
        </div>
      )}

      {/* DONE */}
      {phase === 'done' && resultDesign && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ display:'flex', gap:4, alignItems:'center',
            fontSize:12, color:'var(--green)' }}>
            <Icon name="check" size={12}/> Design created!
          </div>
          <a href={resultDesign.editUrl} target="_blank" rel="noreferrer"
            className="btn btn-primary btn-sm"
            style={{ width:'100%', justifyContent:'center', textDecoration:'none' }}>
            <Icon name="canva" size={12}/> Open in Canva
          </a>
          <div style={{ display:'flex', gap:6 }}>
            {(['png','pdf','mp4'] as const).map(fmt => (
              <button key={fmt} className="btn btn-surface btn-sm"
                style={{ flex:1, justifyContent:'center' }}
                disabled={exporting}
                onClick={() => handleExport(fmt)}>
                {fmt.toUpperCase()}
              </button>
            ))}
          </div>
          {exporting && (
            <div style={{ fontSize:11, color:'var(--text-muted)' }}>Exporting…</div>
          )}
          {exportUrls.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {exportUrls.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer"
                  style={{ fontSize:11, color:'var(--accent)' }}>
                  ↓ Download {i + 1}
                </a>
              ))}
            </div>
          )}
          <button className="btn btn-ghost btn-sm"
            style={{ width:'100%', justifyContent:'center' }}
            onClick={() => { setPhase('picking_template'); setResultDesign(null); setExportUrls([]); }}>
            Use Different Template
          </button>
        </div>
      )}

      {/* ERROR */}
      {phase === 'error' && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div style={{ fontSize:11, color:'var(--red)', lineHeight:1.4 }}>
            {error}
          </div>
          <button className="btn btn-surface btn-sm"
            onClick={() => { setPhase(selectedTpl ? 'template_selected' : 'picking_template'); setError(null); }}>
            Try Again
          </button>
        </div>
      )}
    </div>
  );
};
