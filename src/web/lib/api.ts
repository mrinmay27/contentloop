import type { Stats, Topic, ContentItem } from './types';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  // Sprint U1 Task 7: attach the optional self-host API token (set in
  // Settings → Advanced, persisted client-side only). No-op when unset —
  // matches the server's API_TOKEN middleware, which is open when unset.
  const token = localStorage.getItem('tpce_token');
  const headers: Record<string, string> = { ...(opts?.headers as Record<string, string> | undefined) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { ...opts, headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export const api = {
  getStats: (nicheId?: string, pageId?: string) => {
    const qs = new URLSearchParams();
    if (nicheId) qs.set('nicheId', nicheId);
    if (pageId)  qs.set('pageId', pageId);
    const q = qs.toString();
    return req<Stats>(`/stats${q ? `?${q}` : ''}`);
  },
  getTopics: (nicheId?: string) =>
    req<Topic[]>(`/topics${nicheId ? `?nicheId=${nicheId}` : ''}`),
  getContent: (status?: string)        => req<ContentItem[]>(`/content${status ? `?status=${status}` : ''}`),
  getNiches: ()                        => req<any[]>('/niches'),
  createNiche: (body: any) => req<any>('/niches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  getPages: (nicheId?: string)         => req<any[]>(`/pages${nicheId ? `?nicheId=${nicheId}` : ''}`),
  createPage: (body: any) => req<any>('/pages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  getHealth: ()                        => req<any>('/health'),
  getSettings: ()                      => req<any>('/settings'),
  getConfig: ()                        => req<any>('/config'),
  patchConfig: (body: Record<string, string>) =>
    req<{ ok: boolean; saved: string[] }>('/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  getBranding: (pageId: string)        => req<{ brand: Record<string, any> }>(`/pages/${pageId}/branding`),
  patchBranding: (pageId: string, body: Record<string, unknown>) =>
    req<{ ok: boolean }>(`/pages/${pageId}/branding`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  getSchedule: (pageId: string, year: number, month: number) =>
    req<any[]>(`/pages/${pageId}/schedule?year=${year}&month=${month}`),
  getAnalytics: (pageId: string)       => req<any>(`/pages/${pageId}/analytics`),
  getLearning: (pageId: string)        => req<any>(`/pages/${pageId}/learning`),

  // ── Growth automation: alerts / activity feed ────────────────────────────
  getAlerts:       ()   => req<{ events: any[]; unseen: number }>(`/alerts`),
  markAlertsSeen:  ()   => req<{ ok: boolean }>(`/alerts/seen`, { method: 'POST' }),
  getInbox:        ()   => req<any>(`/inbox`),

  approveContent: (id: string)         => req<{ ok: boolean }>(`/content/${id}/approve`, { method: 'POST' }),
  rejectContent: (id: string)          => req<{ ok: boolean }>(`/content/${id}/reject`, { method: 'POST' }),
  scheduleApproved: ()                 => req<{ scheduled: any[] }>('/schedule/approved', { method: 'POST' }),
  runJob: (name: string)               => req<{ ok: boolean }>(`/jobs/${name}`, { method: 'POST' }),

  patchContent: (id: string, body: Record<string, unknown>) =>
    req<{ ok: boolean }>(`/content/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  // ── Canva ──────────────────────────────────────────────────────
  canvaStatus:    (pageId: string)               => req<{ connected: boolean }>(`/pages/${pageId}/canva/status`),
  canvaDesigns:   (pageId: string)               => req<{ designs: any[] }>(`/pages/${pageId}/canva/designs`),
  canvaTemplates: (pageId: string)               => req<{ templates: any[] }>(`/pages/${pageId}/canva/templates`),
  canvaDataset:   (pageId: string, tplId: string)=> req<{ fields: any[] }>(`/pages/${pageId}/canva/templates/${tplId}/dataset`),
  canvaAutofill:  (pageId: string, body: Record<string, unknown>) =>
    req<{ ok: boolean; designId: string; editUrl: string }>(`/pages/${pageId}/canva/autofill`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  canvaExport:    (pageId: string, body: Record<string, unknown>) =>
    req<{ ok: boolean; urls: string[] }>(`/pages/${pageId}/canva/export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  canvaDisconnect:(pageId: string) => req<{ ok: boolean }>(`/pages/${pageId}/canva`, { method: 'DELETE' }),
  // OAuth redirect (not a fetch — navigates the browser)
  canvaConnectUrl:(pageId: string) => `/auth/canva?pageId=${pageId}`,

  // ── Multi-LLM config ───────────────────────────────────────────
  getLLMConfigs: ()                          => req<any>('/llm-configs'),
  addLLMConfig:  (body: Record<string, unknown>) =>
    req<any>('/llm-configs', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }),
  updateLLMConfig: (id: string, body: Record<string, unknown>) =>
    req<any>(`/llm-configs/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }),
  deleteLLMConfig: (id: string) =>
    req<any>(`/llm-configs/${id}`, { method:'DELETE' }),
  reorderLLMConfigs: (ids: string[]) =>
    req<any>('/llm-configs/reorder', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ids }) }),

  // ── Generic PATCH helper (used by format override) ─────────────
  patch: (path: string, body: Record<string, unknown>) =>
    req<{ ok: boolean }>(path.replace(/^\/api/, ''), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  // Task 1.5 / 3.3: Persist user-chosen format for a topic
  patchTopicFormat: (topicId: string, format: string, confidence = 'user') =>
    req<{ ok: boolean }>(`/topics/${topicId}/format`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suggested_format: format, format_confidence: confidence }),
    }),

  // ── Sprint U1: Sources API — registry-driven GET, validated PUT, regenerate ──
  getSources:        (pageId: string) => req<any>(`/pages/${pageId}/sources`),
  updateSources:     (pageId: string, patch: any) => req<any>(`/pages/${pageId}/sources`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }),
  regenerateSources: (pageId: string) => req<any>(`/pages/${pageId}/sources/regenerate`, { method: 'POST' }),

  // ── Provider capabilities ─────────────────────────────────────────────────────
  getProviderCapabilities: () =>
    req<{ capabilities: Record<string, any> }>('/providers/capabilities'),

  probeImageProvider: (providerId: string) =>
    req<{ ok: boolean; capabilities: any }>(`/providers/${providerId}/probe`, { method: 'POST' }),

  probeLLMConfig: (id: string) =>
    req<{ ok: boolean; capabilities: any }>(`/llm-configs/${id}/probe`, { method: 'POST' }),

  // ── AI Generation ────────────────────────────────────────────────────────
  generateImage: (body: { prompt: string; provider?: string; model?: string; contentId?: string }) =>
    req<{ ok: boolean; url: string; provider: string; model: string }>(
      '/generate/image',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    ),

  // ── Image storage (file-based, replaces stuffing data URLs into JSONB) ────────
  uploadBrandLogo: (pageId: string, dataUrl: string) =>
    req<{ ok: boolean; url: string; bytes: number }>(`/pages/${pageId}/branding/logo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl }),
    }),

  // Find-or-create a draft content_item for a (topic, page, type) tuple — idempotent
  ensureDraftContent: (body: { topicId: string; pageId: string; type: 'post' | 'carousel' | 'reel' }) =>
    req<{ ok: boolean; content: { id: string; payload: any; type: string; status: string } }>(
      '/content/draft',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    ),

  uploadContentImage: (
    contentId: string,
    body: { dataUrl: string; slideIndex?: number; source?: string; prompt?: string },
  ) =>
    req<{ ok: boolean; url: string; slideIndex: number; bytes: number }>(`/content/${contentId}/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  // ── Reel script generation ────────────────────────────────────────────────
  generateReelScript: (body: { topic: string; niche?: string; handle?: string; tone?: string; slideCount?: number }) =>
    req<{ ok: boolean; script: string; provider: string; model: string }>('/generate/reel-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  // ── Reel render ───────────────────────────────────────────────────────────
  renderReel: (contentId: string, body: {
    slides: string[]; handle: string; accent: string; font: string; reelTarget: string;
    backgroundImages?: string[];
  }) =>
    req<{ ok: boolean; url: string }>(`/content/${contentId}/render-reel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  // ── Phase 2: Multi-platform publishing ───────────────────────────────────
  getPublishPlatforms: (pageId: string) =>
    req<{ platforms: Record<string, import('./types').PublishPlatformInfo> }>(`/pages/${pageId}/publish-platforms`),

  getPublishJobs: (contentId: string) =>
    req<{ jobs: import('./types').PublishJob[] }>(`/content/${contentId}/publish-jobs`),

  publishContent: (contentId: string, body: { platforms: string[]; scheduledAt?: string }) =>
    req<{ ok: boolean; jobs: import('./types').PublishJob[] }>(`/content/${contentId}/publish`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),

  // ── Phase 1.5: Manual topic creation ─────────────────────────────────────
  extractUrl: (url: string) =>
    req<{ ok: boolean; article: { title: string; description: string; imageUrl: string | null; bodyText: string; canonicalUrl: string; keyPoints: string } }>(
      '/topics/extract-url',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }
    ),

  createManualTopic: (body: { nicheId: string; title: string; keyPoints?: string; sourceUrl?: string; suggestedFormat?: string }) =>
    req<{ ok: boolean; topic: import('./types').Topic }>('/topics/manual', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),

  // ── Topic preview (no editor needed) ─────────────────────────────────────────
  getTopicPreview: (topicId: string, pageId: string) =>
    req<{ preview: { id: string; status: string; type: string; payload: any } | null }>(
      `/topics/${topicId}/preview?pageId=${pageId}`
    ),

  scheduleBatch: (jobs: Array<{ contentItemId: string; pageId: string; platform: string; scheduledAt: string }>) =>
    req<{ ok: boolean; count: number }>('/content/schedule-batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobs }),
    }),

  // ── Publish job management ────────────────────────────────────────────────
  cancelPublishJob: (jobId: string) =>
    req<{ ok: boolean }>(`/publish-jobs/${jobId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    }),
  reschedulePublishJob: (jobId: string, scheduledAt: string) =>
    req<{ ok: boolean }>(`/publish-jobs/${jobId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reschedule', scheduledAt }),
    }),
  publishJobNow: (jobId: string) =>
    req<{ ok: boolean }>(`/publish-jobs/${jobId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'publish-now' }),
    }),
  // Inbox: retry a failed publish job reuses publishJobNow above (same
  // action) — no separate method needed. Dismiss is inbox-only.
  dismissPublishJob: (jobId: string) =>
    req<{ ok: boolean }>(`/publish-jobs/${jobId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dismiss' }),
    }),

  // ── Danger zone ───────────────────────────────────────────────────────────
  resetPipeline: () => req<{ ok: boolean }>('/reset/pipeline', { method: 'POST' }),
};
