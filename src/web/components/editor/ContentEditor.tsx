import React, { useState, useEffect } from 'react';
import { Player } from '@remotion/player';
import { Icon } from '../ui/Icon';
import { CanvaPanel } from './CanvaPanel';
import { ContentImageGenerator } from './ContentImageGenerator';
import { api } from '../../lib/api';
import type { NavKey, SuggestedFormat, Topic, ThemePage } from '../../lib/types';
import { ReelComposition, reelDurationFrames, REEL_FPS, REEL_WIDTH, REEL_HEIGHT } from '../../../remotion/ReelComposition';
import { parseReelScript } from '../../../remotion/parseReelScript';
import { ReelScriptGenerator } from './ReelScriptGenerator';
import { PublishPanel } from './PublishPanel';

// Build an image prompt that incorporates brand context. The user can override per-image.
function buildContentImagePrompt(opts: {
  topic:        string;
  slideText?:   string;
  brandAccent?: string;
  brandFont?:   string;
  niche?:       string;
  aspectRatio?: '1:1' | '9:16';   // default 1:1 for posts/carousel, 9:16 for reel
}): string {
  const { topic, slideText, brandAccent, brandFont, niche, aspectRatio = '1:1' } = opts;
  const slideNote = slideText?.trim() && slideText.trim() !== topic
    ? ` Slide angle: "${slideText.trim()}".`
    : '';
  const isReel = aspectRatio === '9:16';
  return [
    `Vivid, cinematic${isReel ? ', portrait-orientation' : ''} social media image illustrating "${topic}".${slideNote}`,
    niche       && `Theme: ${niche}.`,
    // For reel slides: keep the background dark/moody so text overlaid at the bottom stays legible.
    // Don't make the whole image the accent colour — use it as an accent only.
    isReel
      ? `Moody, dramatic lighting. Dark background preferred — the image will have text overlaid at the bottom. ${brandAccent ? `Accent color hint: ${brandAccent}.` : ''}`
      : brandAccent && `Use accent color ${brandAccent} as the dominant color.`,
    brandFont   && `If text appears in the image, use a font similar to ${brandFont}.`,
    `High contrast, modern, clean composition. ${isReel ? 'Portrait 9:16 vertical format.' : 'Square 1:1 aspect ratio.'}`,
    'No watermarks, no logos other than what is described.',
  ].filter(Boolean).join(' ');
}

type Slide = { id: number; text: string };

type Props = {
  topic:     Topic;
  page:      ThemePage;   // needed for Canva pageId
  sourceNav: NavKey;
  onBack:    () => void;
};

const NAV_LABELS: Record<NavKey, string> = {
  dashboard: 'Dashboard',
  pipeline:  'Pipeline',
  scheduler: 'Scheduler',
  analytics: 'Analytics',
  settings:  'Settings',
};

const FORMAT_LABELS: Record<SuggestedFormat, string> = {
  post:     '📄 Post',
  carousel: '🎠 Carousel',
  reel:     '🎬 Reel',
};

export const ContentEditor: React.FC<Props> = ({ topic, page, sourceNav, onBack }) => {
  const [hook, setHook]       = useState(topic.title);
  const [caption, setCaption] = useState(`Deep dive into: ${topic.title}\n\n👇 Save this for later`);

  // Task 3.1: Pre-select format tab from topic.suggestedFormat
  const [previewTab, setPreviewTab] = useState<SuggestedFormat>(
    topic.suggestedFormat ?? 'post'
  );
  const [hasUserOverridden, setHasUserOverridden] = useState(
    topic.formatConfidence === 'user'
  );
  const [saveStatus,    setSaveStatus]    = useState<'idle' | 'saving' | 'saved'>('idle');
  const [approveStatus, setApproveStatus] = useState<'idle' | 'approving' | 'done'>('idle');
  const [isDirty,       setIsDirty]       = useState(false);
  const [renderStatus,    setRenderStatus]    = useState<'idle' | 'rendering' | 'done'>('idle');
  const [reelVideoUrl,    setReelVideoUrl]    = useState<string | null>(null);
  const [reelSavedImages, setReelSavedImages] = useState<Record<number, string>>({});

  const handleReelSavedImage = (idx: number) => (url: string) =>
    setReelSavedImages(prev => ({ ...prev, [idx]: url }));
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [currentSlide, setCurrentSlide] = useState(0);
  const [slides, setSlides]   = useState<Slide[]>([
    { id:1, text:'Hook slide — Main title + statistic' },
    { id:2, text:'Problem — What you\'re losing without this' },
    { id:3, text:'Solution #1 — Key insight' },
    { id:4, text:'Solution #2 — Implementation' },
    { id:5, text:'Solution #3 — Quick win' },
    { id:6, text:'CTA — Follow for more breakdowns' },
  ]);

  // Reel script fields
  const [reelScript, setReelScript] = useState(
    `Hook: ${topic.title}\n\n[Body: 3 key points about this topic]\n\nCTA: Follow for daily insights`
  );

  // Brand kit + content_item draft for image generation
  const [brand, setBrand] = useState<Record<string, any>>({
    accent: '#F5A623',
    font:   'DM Sans',
  });
  const [draftId,      setDraftId]      = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(true);
  const [draftError,   setDraftError]   = useState<string | null>(null);
  const [savedImages, setSavedImages] = useState<Record<number, string>>({});

  // Load brand + ensure a draft content_item exists for this (topic, page, format)
  useEffect(() => {
    api.getBranding(page.id)
      .then(({ brand: b }) => setBrand({ accent: '#F5A623', font: 'DM Sans', ...(b ?? {}) }))
      .catch(() => {});
  }, [page.id]);

  const loadDraft = () => {
    setDraftId(null);
    setSavedImages({});
    setDraftLoading(true);
    setDraftError(null);
    setApproveStatus('idle');
    setIsDirty(false);
    api.ensureDraftContent({ topicId: topic.id, pageId: page.id, type: previewTab })
      .then(({ content }) => {
        setDraftId(content.id);
        if (content.status === 'approved') setApproveStatus('done');
        const p = content.payload ?? {};

        // Hydrate text fields saved from a previous session
        if (p.hook)    setHook(p.hook);
        if (p.caption) setCaption(p.caption);
        if (Array.isArray(p.slides) && p.slides.length > 0) setSlides(p.slides);
        if (p.reelScript) setReelScript(p.reelScript);
        if (p.reelTarget) setReelTarget(p.reelTarget as any);

        // Hydrate saved image URLs
        const imgs: any[] = Array.isArray(p.images) ? p.images : [];
        const hydrated: Record<number, string> = {};
        imgs.forEach((img: any) => {
          if (img && typeof img === 'object' && typeof img.slideIndex === 'number' && img.url)
            hydrated[img.slideIndex] = img.url;
        });
        setSavedImages(hydrated);
      })
      .catch((err: any) => {
        setDraftError(err?.message ?? 'Failed to initialise content draft');
      })
      .finally(() => setDraftLoading(false));
  };

  useEffect(() => { loadDraft(); }, [topic.id, page.id, previewTab]);

  const handleSavedImage = (slideIndex: number) => (url: string) =>
    setSavedImages(prev => ({ ...prev, [slideIndex]: url }));

  const addSlide    = () => { setSlides(s => [...s, { id: Date.now(), text: `Slide ${s.length + 1}` }]); setIsDirty(true); };
  const removeSlide = (id: number) => { setSlides(s => s.filter(sl => sl.id !== id)); setIsDirty(true); };
  const updateSlide = (id: number, text: string) => {
    setSlides(s => s.map(sl => sl.id === id ? { ...sl, text } : sl));
    setIsDirty(true);
  };

  const prevSlide = () => setCurrentSlide(i => Math.max(0, i - 1));
  const nextSlide = () => setCurrentSlide(i => Math.min(slides.length - 1, i + 1));
  React.useEffect(() => {
    setCurrentSlide(i => Math.min(i, slides.length - 1));
  }, [slides.length]);

  // Platform targeting for Reel content
  type ReelTarget = 'instagram' | 'youtube_shorts' | 'both';
  const [reelTarget, setReelTarget] = useState<ReelTarget>('both');

  const REEL_TARGETS: { key: ReelTarget; label: string; icon: string }[] = [
    { key: 'instagram',      label: 'Instagram Reels', icon: '📸' },
    { key: 'youtube_shorts', label: 'YouTube Shorts',  icon: '▶️' },
    { key: 'both',           label: 'Both',            icon: '🚀' },
  ];

  const previewH = previewTab === 'reel' ? 560 : 480;

  // Task 3.3: Handle format tab change → notify user if overriding suggestion
  const handleTabChange = (tab: SuggestedFormat) => {
    if (tab !== previewTab && topic.suggestedFormat && tab !== topic.suggestedFormat && !hasUserOverridden) {
      showToast(`Format changed to ${FORMAT_LABELS[tab]}`);
    }
    setPreviewTab(tab);
    setHasUserOverridden(true);
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleRenderReel = async () => {
    if (!draftId || renderStatus === 'rendering') return;
    setRenderStatus('rendering');
    showToast('🎬 Rendering reel — this takes ~30-60s…');
    try {
      const slides = parseReelScript(reelScript);
      const { url } = await api.renderReel(draftId, {
        slides,
        handle:           page.niche ?? page.name,
        accent:           brand.accent,
        font:             brand.font,
        reelTarget,
        backgroundImages: slides.map((_, i) => {
          const imgUrl = reelSavedImages[i];
          // Make absolute for server-side renderer (Node.js can't resolve relative paths)
          return imgUrl ? `http://localhost:4000${imgUrl.split('?')[0]}` : '';
        }),
      });
      setReelVideoUrl(url);
      setRenderStatus('done');
      showToast('✓ Reel rendered — click Download to save');
    } catch (err: any) {
      setRenderStatus('idle');
      showToast(`Render failed: ${err?.message ?? 'unknown error'}`);
    }
  };

  const handleApprove = async () => {
    if (!draftId || approveStatus !== 'idle') return;
    setApproveStatus('approving');
    try {
      // Auto-save current content first, then flip status to approved
      const contentPayload: Record<string, unknown> = { hook, caption };
      if (previewTab === 'carousel') contentPayload.slides = slides;
      if (previewTab === 'reel')     { contentPayload.reelScript = reelScript; contentPayload.reelTarget = reelTarget; }
      await api.patchContent(draftId, contentPayload);
      await api.approveContent(draftId);
      setApproveStatus('done');
      showToast('✓ Approved — content queued for scheduling');
      setTimeout(() => onBack(), 1200);
    } catch {
      setApproveStatus('idle');
      showToast('Approval failed — try again');
    }
  };

  const handleSaveDraft = async () => {
    if (!draftId) return;
    setSaveStatus('saving');
    try {
      // Persist hook + caption + format-specific fields
      const contentPayload: Record<string, unknown> = { hook, caption };
      if (previewTab === 'carousel') contentPayload.slides = slides;
      if (previewTab === 'reel')     { contentPayload.reelScript = reelScript; contentPayload.reelTarget = reelTarget; }
      await api.patchContent(draftId, contentPayload);

      // Persist format override if the user changed it
      if (hasUserOverridden && previewTab !== topic.suggestedFormat) {
        await api.patch(`/api/topics/${topic.id}/format`, {
          suggested_format: previewTab,
          format_confidence: 'user',
        });
      }

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('idle');
    }
  };

  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minHeight:0 }}>

      {/* Toast notification */}
      {toastMsg && (
        <div style={{
          position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)',
          background:'var(--bg-surface)', border:'1px solid var(--border)',
          borderRadius:'var(--radius)', padding:'8px 18px', fontSize:13,
          color:'var(--text-primary)', boxShadow:'0 4px 16px rgba(0,0,0,0.3)',
          zIndex:99999, fontWeight:500, display:'flex', alignItems:'center', gap:8,
          animation: 'fadeIn 0.2s ease',
        }}>
          {toastMsg}
        </div>
      )}

      {/* Topbar */}
      <div className="topbar">
        {/* Back button */}
        <button className="btn btn-ghost btn-sm" onClick={onBack}
          style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 10px' }}>
          <Icon name="arrow-left" size={13}/>
          <span>{NAV_LABELS[sourceNav]}</span>
        </button>

        <div style={{ width:1, height:18, background:'var(--border)', margin:'0 4px' }}/>

        {/* Breadcrumb + format badge */}
        <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0, overflow:'hidden' }}>
          <div style={{ width:7, height:7, borderRadius:'50%', background:'var(--accent)', flexShrink:0 }}/>
          <span className="topbar-title" style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {topic.title}
          </span>
          <span className={`badge ${approveStatus === 'done' && !isDirty ? 'badge-green' : isDirty && approveStatus === 'done' ? 'badge-amber' : 'badge-amber'}`} style={{ flexShrink:0 }}>
            {approveStatus === 'done' && !isDirty ? 'Approved' : isDirty ? 'Edited' : 'Review'}
          </span>
          {/* Task 3.1: Show "🤖 Suggested" chip on pre-selected tab */}
          {topic.suggestedFormat && (
            <span style={{
              fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:10,
              background: hasUserOverridden ? 'var(--bg-hover)' : 'var(--accent-dim)',
              color: hasUserOverridden ? 'var(--text-muted)' : 'var(--accent)',
              border: `1px solid ${hasUserOverridden ? 'var(--border)' : 'var(--accent)'}`,
              flexShrink:0,
            }}>
              {hasUserOverridden ? `✏️ ${FORMAT_LABELS[previewTab]}` : `🤖 ${FORMAT_LABELS[topic.suggestedFormat]}`}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="topbar-right">
          <button className="btn btn-surface btn-sm" onClick={handleSaveDraft}
            disabled={!draftId || saveStatus === 'saving'}>
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? '✓ Saved' : 'Save Draft'}
          </button>
          {approveStatus === 'done' && !isDirty ? (
            <button className="btn btn-sm" disabled style={{
              background: 'var(--green, #22c55e)', color: '#fff',
              border: '1px solid var(--green, #22c55e)', opacity: 1,
              cursor: 'default',
            }}>
              ✓ Approved
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={handleApprove}
              disabled={!draftId || approveStatus === 'approving'}>
              <Icon name="check" size={11}/>
              {approveStatus === 'approving' ? 'Approving…' : 'Approve'}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex:1, display:'grid', gridTemplateColumns:'1fr 420px', overflow:'hidden', minHeight:0 }}>

        {/* LEFT: Editor — Task 3.2: panel adapts to selected format */}
        <div className="editor-sidebar" style={{ overflowY:'auto' }}>

          {/* Draft status banner */}
          {draftLoading && (
            <div style={{
              display:'flex', alignItems:'center', gap:8,
              padding:'8px 12px', marginBottom:12,
              background:'var(--bg-elevated)', border:'1px solid var(--border)',
              borderRadius:'var(--radius-sm)', fontSize:11, color:'var(--text-muted)',
            }}>
              <span style={{ animation:'spin 1s linear infinite', display:'inline-block' }}>⏳</span>
              Initialising draft… image paste will be ready in a moment.
            </div>
          )}
          {draftError && (
            <div style={{
              display:'flex', alignItems:'center', gap:10,
              padding:'8px 12px', marginBottom:12,
              background:'color-mix(in srgb, var(--red, #ef4444) 10%, transparent)',
              border:'1px solid var(--red, #ef4444)',
              borderRadius:'var(--radius-sm)', fontSize:11,
            }}>
              <span style={{ color:'var(--red, #ef4444)', flex:1 }}>
                ⚠ Draft init failed: {draftError}
              </span>
              <button onClick={loadDraft}
                style={{ background:'none', border:'none', cursor:'pointer',
                  fontSize:11, color:'var(--accent)', fontWeight:700, padding:0, flexShrink:0 }}>
                ↺ Retry
              </button>
            </div>
          )}

          {/* Source reference banner */}
          {topic.sourceUrl && (
            <div style={{
              display:'flex', alignItems:'center', gap:10,
              padding:'10px 14px', marginBottom:16,
              background:'var(--bg-elevated)', border:'1px solid var(--border)',
              borderRadius:'var(--radius-sm)', borderLeft:'3px solid var(--accent)',
            }}>
              <span style={{ fontSize:14, flexShrink:0 }}>📖</span>
              <div style={{ minWidth:0, flex:1 }}>
                <div style={{ fontSize:10, color:'var(--text-muted)', fontWeight:600,
                  textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>
                  Source Article
                </div>
                <a
                  href={topic.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize:11, color:'var(--accent)', textDecoration:'none',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                    display:'block',
                  }}
                >
                  {topic.sourceUrl}
                </a>
              </div>
              <a
                href={topic.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize:10, fontWeight:700, padding:'4px 10px', borderRadius:6,
                  background:'var(--accent)', color:'#000', textDecoration:'none', flexShrink:0,
                }}
              >
                Open ↗
              </a>
            </div>
          )}

          {/* Hook — always visible */}
          <div>
            <div className="editor-section-title">Hook</div>
            <textarea className="editor-textarea" value={hook}
              onChange={e => { setHook(e.target.value); setIsDirty(true); }} rows={3} style={{ marginTop:8 }}/>
          </div>

          {/* Caption — visible for Post and Reel */}
          {(previewTab === 'post' || previewTab === 'reel') && (
            <div>
              <div className="editor-section-title">Caption</div>
              <textarea className="editor-textarea" value={caption}
                onChange={e => { setCaption(e.target.value); setIsDirty(true); }} rows={4} style={{ marginTop:8 }}/>
            </div>
          )}

          {/* Image Generator — Post format gets a single image */}
          {previewTab === 'post' && (
            <ContentImageGenerator
              contentId={draftId}
              slideIndex={0}
              label="Post image"
              defaultPrompt={buildContentImagePrompt({
                topic: topic.title,
                brandAccent: brand.accent,
                brandFont:   brand.font,
                niche:       page.niche,
              })}
              initialUrl={savedImages[0]}
              onSaved={handleSavedImage(0)}
            />
          )}

          {/* Carousel Slides — Task 3.2: only visible on Carousel tab */}
          {previewTab === 'carousel' && (
            <>
              <div>
                <div className="editor-section-title"
                  style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span>Carousel Slides</span>
                  <button className="btn btn-sm btn-surface" onClick={addSlide}>
                    <Icon name="plus" size={10}/> Add
                  </button>
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:8 }}>
                  {slides.map((slide, i) => (
                    <div key={slide.id}>
                      <div className="slide-item">
                        <div className="slide-num">{i+1}</div>
                        <input type="text" value={slide.text}
                          onChange={e => updateSlide(slide.id, e.target.value)}
                          style={{ flex:1, background:'transparent', border:'none', outline:'none',
                            fontSize:12, color:'var(--text-primary)', fontFamily:'var(--font)', padding:'2px 0' }}/>
                        <button onClick={() => removeSlide(slide.id)}
                          style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:'0 2px' }}>
                          <Icon name="x" size={10}/>
                        </button>
                      </div>
                      <ContentImageGenerator
                        contentId={draftId}
                        slideIndex={i}
                        label={`Slide ${i + 1} image`}
                        defaultPrompt={buildContentImagePrompt({
                          topic:       topic.title,
                          slideText:   slide.text,
                          brandAccent: brand.accent,
                          brandFont:   brand.font,
                          niche:       page.niche,
                        })}
                        initialUrl={savedImages[i]}
                        onSaved={handleSavedImage(i)}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="editor-section-title">CTA</div>
                <input type="text" defaultValue="Follow for daily breakdowns →" style={{ marginTop:8 }}/>
              </div>
            </>
          )}

          {/* Reel Script — only visible on Reel tab */}
          {previewTab === 'reel' && (
            <div>
              <div className="editor-section-title">Reel Script</div>

              <ReelScriptGenerator
                topic={topic.title}
                niche={page.name}
                handle={page.niche ?? page.name}
                onScript={setReelScript}
              />

              <textarea className="editor-textarea" value={reelScript}
                onChange={e => { setReelScript(e.target.value); setIsDirty(true); }}
                rows={8} style={{ fontFamily:'var(--mono)', fontSize:11 }}
                placeholder="Hook: [attention-grabbing opener]&#10;&#10;Body: [3 punchy points]&#10;&#10;CTA: [follow/save/comment ask]"
              />
              {/* Per-slide background images — shown after script is written */}
              {parseReelScript(reelScript).filter(s => s !== 'No script yet').map((slideText, i) => (
                <ContentImageGenerator
                  key={i}
                  contentId={draftId}
                  slideIndex={100 + i}
                  label={`Slide ${i + 1} background`}
                  defaultPrompt={buildContentImagePrompt({
                    topic:       topic.title,
                    slideText,
                    brandAccent: brand.accent,
                    brandFont:   brand.font,
                    niche:       page.niche,
                    aspectRatio: '9:16',
                  })}
                  initialUrl={reelSavedImages[i]}
                  onSaved={handleReelSavedImage(i)}
                />
              ))}

              {/* Platform selector for Reel */}
              <div style={{ display:'flex', gap:6, marginTop:10, flexWrap:'wrap' }}>
                <span style={{ fontSize:11, color:'var(--text-muted)', alignSelf:'center' }}>Publish to:</span>
                {REEL_TARGETS.map(({ key, label, icon }) => (
                  <button key={key}
                    onClick={() => setReelTarget(key)}
                    style={{
                      display:'flex', alignItems:'center', gap:5,
                      padding:'4px 10px', borderRadius:'var(--radius-sm)',
                      fontSize:11, fontWeight:600, cursor:'pointer',
                      border: reelTarget === key ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
                      background: reelTarget === key ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--bg-base)',
                      color: reelTarget === key ? 'var(--accent)' : 'var(--text-secondary)',
                      transition:'all 0.15s',
                    }}>
                    <span style={{ fontSize:13 }}>{icon}</span> {label}
                  </button>
                ))}
              </div>

              {/* Render to MP4 */}
              <div style={{ marginTop:16, padding:14,
                border:'1px solid var(--border)', borderRadius:'var(--radius-sm)',
                background:'var(--bg-elevated)' }}>
                <div style={{ fontSize:11, fontWeight:700, marginBottom:8, color:'var(--text-primary)' }}>
                  🎬 Export Reel
                </div>
                <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:10, lineHeight:1.5 }}>
                  Renders an MP4 (1080×1920, H.264) using your script and brand colors.
                  Takes ~30–60s on first render.
                </div>
                <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={!draftId || renderStatus === 'rendering'}
                    onClick={handleRenderReel}
                    style={{ fontSize:11 }}>
                    {renderStatus === 'rendering' ? '⏳ Rendering…' :
                     renderStatus === 'done'      ? '✓ Re-render'  : '🎬 Render to MP4'}
                  </button>
                  {reelVideoUrl && renderStatus !== 'rendering' && (
                    <a href={reelVideoUrl} download
                      style={{ fontSize:11, fontWeight:600, color:'var(--accent)',
                        padding:'4px 12px', borderRadius:'var(--radius-sm)',
                        border:'1px solid var(--accent)', textDecoration:'none' }}>
                      ↓ Download MP4
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Branding — always visible */}
          <div>
            <div className="editor-section-title">Branding</div>
            <div style={{ display:'flex', gap:8, marginTop:8, alignItems:'center' }}>
              <div style={{ width:28, height:28, borderRadius:6, background:'var(--accent)', border:'2px solid var(--accent)' }}/>
              <div style={{ width:28, height:28, borderRadius:6, background:'var(--bg-hover)', border:'1px solid var(--border)' }}/>
              <div style={{ width:28, height:28, borderRadius:6, background:'var(--bg-elevated)', border:'1px dashed var(--border)',
                display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
                <Icon name="plus" size={10}/>
              </div>
              <div style={{ marginLeft:'auto', display:'flex', gap:6, alignItems:'center', fontSize:12, color:'var(--text-secondary)' }}>
                <input type="checkbox" defaultChecked id="use-theme"/>
                <label htmlFor="use-theme">Use default branding</label>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: Preview */}
        <div className="preview-panel">
          {/* Content type tabs — Task 3.3: clicking a tab is the override */}
          <div className="preview-tabs">
            {(['post','carousel','reel'] as const).map(t => {
              const isActive = previewTab === t;
              const isSuggested = topic.suggestedFormat === t && !hasUserOverridden;
              return (
                <button key={t}
                  className={`preview-tab ${isActive ? 'active' : ''}`}
                  onClick={() => handleTabChange(t)}
                  style={{ position:'relative' }}>
                  {FORMAT_LABELS[t]}
                  {isSuggested && (
                    <span style={{
                      position:'absolute', top:-4, right:-4,
                      width:6, height:6, borderRadius:'50%',
                      background:'var(--accent)',
                    }} title="AI-suggested format"/>
                  )}
                </button>
              );
            })}
          </div>

          <div className="preview-phone" style={{ height: previewH }}>
            <div className="preview-phone-notch"/>
            <div style={{ paddingTop:24, height:'100%', background:'var(--bg-base)', display:'flex', flexDirection:'column' }}>

              {/* Platform-aware header */}
              <div style={{ padding:'10px 14px', display:'flex', alignItems:'center', gap:8, borderBottom:'0.5px solid var(--border)' }}>
                <div style={{ width:32, height:32, borderRadius: previewTab === 'reel' && reelTarget === 'youtube_shorts' ? 6 : '50%',
                  background:'var(--accent)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700 }}>
                  {previewTab === 'reel' && reelTarget === 'youtube_shorts' ? '▶' : page.name.substring(0,2).toUpperCase()}
                </div>
                <div>
                  <div style={{ fontSize:12, fontWeight:600, color:'var(--text-primary)' }}>
                    {page.name}
                  </div>
                  {previewTab === 'reel' && (
                    <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:1 }}>
                      {reelTarget === 'instagram'      && '📸 Instagram Reels'}
                      {reelTarget === 'youtube_shorts' && '▶️ YouTube Shorts'}
                      {reelTarget === 'both'           && '📸 Instagram + ▶️ YouTube'}
                    </div>
                  )}
                </div>
              </div>

              {previewTab === 'carousel' && (
                <div style={{ flex:1, background:'var(--bg-elevated)', display:'flex',
                  alignItems:'center', justifyContent:'center', position:'relative', padding:10,
                  overflow:'hidden' }}>

                  {/* Background image — contain keeps the square image uncropped */}
                  {savedImages[currentSlide] && (
                    <img src={savedImages[currentSlide]} alt={`Slide ${currentSlide + 1}`}
                      style={{ position:'absolute', inset:0, width:'100%', height:'100%',
                        objectFit:'contain', background:'#000', zIndex:0 }} />
                  )}
                  {/* Subtle gradient for legibility when image is present */}
                  {savedImages[currentSlide] && (
                    <div style={{ position:'absolute', inset:0,
                      background:'linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 50%, transparent 100%)',
                      zIndex:0 }} />
                  )}

                  <div style={{ textAlign:'center', padding:'0 28px', zIndex:1 }}>
                    <div style={{ fontSize:10,
                      color: savedImages[currentSlide] ? '#fff' : 'var(--accent)',
                      fontWeight:700, textTransform:'uppercase', letterSpacing:2, marginBottom:8,
                      textShadow: savedImages[currentSlide] ? '0 1px 2px rgba(0,0,0,0.5)' : 'none' }}>
                      Slide {currentSlide + 1} of {slides.length}
                    </div>
                    <div style={{ fontSize:14, fontWeight:700,
                      color: savedImages[currentSlide] ? '#fff' : 'var(--text-primary)',
                      lineHeight:1.5, minHeight:60,
                      textShadow: savedImages[currentSlide] ? '0 1px 4px rgba(0,0,0,0.6)' : 'none' }}>
                      {currentSlide === 0
                        ? hook.substring(0, 100)
                        : slides[currentSlide]?.text}
                    </div>
                  </div>

                  {currentSlide > 0 && (
                    <div onClick={prevSlide} style={{
                      position:'absolute', left:0, top:0, bottom:24, width:'40%',
                      cursor:'w-resize', display:'flex', alignItems:'center', paddingLeft:6,
                    }}>
                      <div style={{
                        width:22, height:22, borderRadius:'50%',
                        background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.15)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:10, color:'var(--text-muted)',
                      }}>‹</div>
                    </div>
                  )}

                  {currentSlide < slides.length - 1 && (
                    <div onClick={nextSlide} style={{
                      position:'absolute', right:0, top:0, bottom:24, width:'40%',
                      cursor:'e-resize', display:'flex', alignItems:'center',
                      justifyContent:'flex-end', paddingRight:6,
                    }}>
                      <div style={{
                        width:22, height:22, borderRadius:'50%',
                        background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.15)',
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontSize:10, color:'var(--text-muted)',
                      }}>›</div>
                    </div>
                  )}

                  <div style={{ position:'absolute', bottom:8, left:0, right:0,
                    display:'flex', gap:4, justifyContent:'center' }}>
                    {slides.map((_, i) => (
                      <div key={i}
                        onClick={() => setCurrentSlide(i)}
                        style={{
                          width: i === currentSlide ? 14 : 4, height:4, borderRadius:2,
                          background: i === currentSlide ? 'var(--accent)' : 'rgba(128,128,128,0.35)',
                          cursor:'pointer', transition:'width 0.2s, background 0.2s',
                        }}/>
                    ))}
                  </div>
                </div>
              )}

              {previewTab === 'post' && (
                <div style={{ flex:1, background:'#000', display:'flex',
                  alignItems:'center', justifyContent:'center', padding: savedImages[0] ? 0 : 20,
                  position:'relative', overflow:'hidden' }}>
                  {savedImages[0] ? (
                    <img src={savedImages[0]} alt="Post"
                      style={{ width:'100%', height:'100%', objectFit:'contain' }} />
                  ) : (
                    <div style={{ textAlign:'center', fontSize:14, fontWeight:700,
                      color:'var(--text-primary)', lineHeight:1.6 }}>
                      {hook.substring(0,100)}…
                    </div>
                  )}
                </div>
              )}

              {previewTab === 'reel' && (() => {
                const reelSlides = parseReelScript(reelScript);
                const totalFrames = reelDurationFrames(reelSlides.length);
                return (
                  <div style={{ flex:1, position:'relative', overflow:'hidden', background:'#000',
                    display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <Player
                      component={ReelComposition}
                      inputProps={{
                        slides:           reelSlides,
                        handle:           page.niche ?? page.name,
                        accent:           brand.accent,
                        font:             brand.font,
                        target:           reelTarget,
                        backgroundImages: reelSlides.map((_, i) => reelSavedImages[i] ?? '').filter(Boolean),
                      }}
                      durationInFrames={totalFrames}
                      compositionWidth={REEL_WIDTH}
                      compositionHeight={REEL_HEIGHT}
                      fps={REEL_FPS}
                      style={{ width:'100%', height:'100%' }}
                      controls
                      loop
                    />
                  </div>
                );
              })()}

              <div style={{ padding:'10px 14px', display:'flex', gap:10, borderTop:'0.5px solid var(--border)' }}>
                {(previewTab === 'reel' && reelTarget !== 'instagram'
                  ? ['👍','👎','💬','↗️'] : ['♥','💬','↗']).map(icon =>
                  <span key={icon} style={{ fontSize:16, cursor:'pointer' }}>{icon}</span>
                )}
              </div>
              <div style={{ padding:'0 14px 10px', fontSize:11, color:'var(--text-secondary)', lineHeight:1.5 }}>
                {caption.substring(0,100)}…
              </div>
            </div>
          </div>

          {/* Canva — live integration */}
          <CanvaPanel
            pageId={page.id}
            hook={hook}
            slides={slides.map(s => s.text)}
          />

          {/* Publish panel — Phase 2 */}
          <PublishPanel
            contentId={draftId}
            pageId={page.id}
            approved={approveStatus === 'done' && !isDirty}
          />
        </div>
      </div>
    </div>
  );
};
