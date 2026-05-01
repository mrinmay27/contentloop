import type { Stats, Topic, ContentItem, Post } from './types';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, opts);
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
  getPosts: (state?: string)           => req<Post[]>(`/posts${state ? `?state=${state}` : ''}`),
  getNiches: ()                        => req<any[]>('/niches'),
  getPages: (nicheId?: string)         => req<any[]>(`/pages${nicheId ? `?nicheId=${nicheId}` : ''}`),
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

  // ── Task 2.0: Source map management ──────────────────────────────────────
  getPageSources:     (pageId: string) => req<{ map: any | null }>(`/pages/${pageId}/sources`),
  refreshPageSources: (pageId: string) => req<{ ok: boolean; map: any }>(`/pages/${pageId}/sources/refresh`, { method: 'POST' }),
  clearPageSources:   (pageId: string) => req<{ ok: boolean }>(`/pages/${pageId}/sources`, { method: 'DELETE' }),
};
