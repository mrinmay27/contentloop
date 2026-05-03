# Multi-Provider AI Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a BYOK (Bring Your Own Key) AI generation layer — image and video — where users connect their own API keys, set global defaults, and override per content piece in the editor.

**Architecture:** A provider registry defines available image/video providers and their models. The backend routes generation requests to the active provider using `configStore` keys. The frontend has `ImageGenManager` and `VideoGenManager` settings components (mirroring `LLMManager`) plus a `GenerationPanel` in the content editor for per-piece overrides. Generated asset URLs are stored in the content item's `payload` JSONB field (no schema migration needed).

**Tech Stack:** TypeScript ESM, React, Express, PostgreSQL JSONB, fal.ai REST, OpenAI REST, Google Generative Language REST, Stability AI REST, Replicate REST, RunwayML REST, HeyGen REST

---

## Architecture Amendments (2026-05-03)

These decisions supersede parts of the original spec below. Apply them when executing each task.

### 1. Priority chain replaces single default

**Original spec:** `DEFAULT_IMAGE_PROVIDER` (string) + `DEFAULT_IMAGE_MODEL` (string).

**Actual implementation:**

```typescript
// ConfigStore keys — replace DEFAULT_IMAGE_PROVIDER / DEFAULT_IMAGE_MODEL with:
IMAGE_PROVIDER_PRIORITY  // JSON string: '["fal","google","openai","stability","replicate"]'
IMAGE_MODEL_PREFS        // JSON string: '{"fal":"fal-ai/ideogram/v2","google":"imagen-3.0-generate-001","openai":"dall-e-3"}'
LLM_PROVIDER_PRIORITY    // JSON string: '["google","openai","anthropic"]'
LLM_MODEL_PREFS          // JSON string: '{"google":"gemini-2.0-flash","openai":"gpt-4o"}'
```

`resolveImageProvider()` in `src/config/generationProviders.ts` becomes `resolveImageProviderChain()`:

```typescript
export function resolveImageProviderChain(): { provider: ImageProvider; model: string } {
  const priority: ImageProvider[] = JSON.parse(configStore.get('IMAGE_PROVIDER_PRIORITY') || '[]');
  const modelPrefs: Record<string, string> = JSON.parse(configStore.get('IMAGE_MODEL_PREFS') || '{}');
  for (const provider of priority) {
    const keyName = PROVIDER_KEY_MAP[provider]; // e.g. 'fal' → 'FAL_API_KEY'
    if (configStore.get(keyName as ConfigKey).length > 0) {
      const model = modelPrefs[provider] || defaultModelFor(provider, 'image');
      return { provider, model };
    }
  }
  throw new Error('No image provider connected. Add a key in Settings → Image Generation.');
}
```

The chain walks the priority list and returns the first provider whose API key is set. On API failure in the endpoint, catch and retry the next provider in the chain.

### 2. Settings UI — drag-and-drop priority list replaces "Set default" button

`ImageGenManager` and `VideoGenManager` (Tasks 6–7) should render an ordered, draggable list of providers instead of individual "Set default" buttons. Each row shows:
- Drag handle
- Provider name + icon
- Connected / No key status badge
- Model preference dropdown (only shown when connected)

Dragging reorders the `IMAGE_PROVIDER_PRIORITY` array. Saving persists the new order.

### 3. Auto-mode + Guided-mode workflow

The `GenerationPanel` (Task 9) and the future content pipeline support two modes (see Master Roadmap for full diagram). The panel itself renders in "Guided" context (user is at a specific step). Auto mode is a pipeline concern handled at the workflow orchestration layer (Phase 1.3 full plan).

### 4. Format-aware image generation

When generating images in Task 9 / GenerationPanel, the number and aspect ratio of images depends on `contentType`:
- `'post'` → 1 image, square (1:1) or portrait (4:5)
- `'carousel'` → N images (one per slide), square (1:1)
- `'reel'` → 3–5 key frame images, portrait (9:16)

Pass `contentType` to the generate endpoint so the backend can batch correctly.

### 5. Day-one provider

User has `GOOGLE_AI_API_KEY` (Gemini) already connected. Imagen 3 works immediately with no additional setup. Set `["google"]` as the bootstrap default for `IMAGE_PROVIDER_PRIORITY` when no priority has been set yet.

---

## File Map

### New files
| File | Responsibility |
|------|---------------|
| `src/config/generationProviders.ts` | Backend provider catalog + generation routing (all providers, all API calls) |
| `src/web/lib/generationProviders.ts` | Frontend-only provider catalog (UI metadata — models, icons, key names) |
| `src/web/components/settings/ImageGenManager.tsx` | Image provider settings card list + default picker |
| `src/web/components/settings/VideoGenManager.tsx` | Video provider settings card list + default picker |
| `src/web/components/editor/GenerationPanel.tsx` | Per-content provider/model override + generate button + preview |

### Modified files
| File | Change |
|------|--------|
| `src/config/configStore.ts` | Add 10 new ConfigKeys for provider API keys + defaults |
| `src/api/server.ts` | Add `POST /api/generate/image`, `POST /api/generate/video`, `GET /api/generate/video/:jobId` |
| `src/web/views/SettingsView.tsx` | Add "Generation" nav section with Image + Video sub-groups |
| `src/web/components/editor/ContentEditor.tsx` | Mount `GenerationPanel` in editor sidebar |
| `src/web/lib/api.ts` | Add `generateImage()`, `generateVideo()`, `pollVideoJob()` |

---

## Task 1: configStore — add provider keys and generation defaults

**Files:**
- Modify: `src/config/configStore.ts`

- [ ] **Step 1: Add new ConfigKeys to the union type**

In `src/config/configStore.ts`, extend `ConfigKey`:

```typescript
export type ConfigKey =
  // ... existing keys ...
  // Image generation providers
  | 'GOOGLE_AI_API_KEY'
  | 'STABILITY_API_KEY'
  | 'FAL_API_KEY'
  | 'REPLICATE_API_TOKEN'
  // Video generation providers
  | 'RUNWAY_API_KEY'
  | 'HEYGEN_API_KEY'
  // Generation defaults
  | 'DEFAULT_IMAGE_PROVIDER'
  | 'DEFAULT_IMAGE_MODEL'
  | 'DEFAULT_VIDEO_PROVIDER'
  | 'DEFAULT_VIDEO_MODEL';
```

- [ ] **Step 2: Add CONFIG_META entries for the new keys**

Add after the existing Exploding Topics entry in `CONFIG_META`:

```typescript
  // ── Image generation providers ────────────────────────────────────────────
  GOOGLE_AI_API_KEY:   { label:'Google AI API Key',    group:'Image Generation', type:'secret',
                         placeholder:'AIza…' },
  STABILITY_API_KEY:   { label:'Stability AI API Key', group:'Image Generation', type:'secret',
                         placeholder:'sk-…' },
  FAL_API_KEY:         { label:'fal.ai API Key',        group:'Image Generation', type:'secret',
                         placeholder:'…' },
  REPLICATE_API_TOKEN: { label:'Replicate API Token',  group:'Image Generation', type:'secret',
                         placeholder:'r8_…' },
  DEFAULT_IMAGE_PROVIDER: { label:'Default Image Provider', group:'Image Generation', type:'select',
                             options:['none','openai','google','stability','fal','replicate'] },
  DEFAULT_IMAGE_MODEL:    { label:'Default Image Model',    group:'Image Generation', type:'text',
                             placeholder:'dall-e-3' },
  // ── Video generation providers ────────────────────────────────────────────
  RUNWAY_API_KEY:   { label:'RunwayML API Key', group:'Video Generation', type:'secret',
                      placeholder:'…' },
  HEYGEN_API_KEY:   { label:'HeyGen API Key',   group:'Video Generation', type:'secret',
                      placeholder:'…' },
  DEFAULT_VIDEO_PROVIDER: { label:'Default Video Provider', group:'Video Generation', type:'select',
                             options:['none','runway','heygen','fal'] },
  DEFAULT_VIDEO_MODEL:    { label:'Default Video Model',    group:'Video Generation', type:'text',
                             placeholder:'gen3a_turbo' },
```

Note: `FAL_API_KEY` is shared between image (Flux, Ideogram) and video (Kling) — one key unlocks both.

- [ ] **Step 3: Add ENV_DEFAULTS for new keys**

```typescript
  GOOGLE_AI_API_KEY:       process.env.GOOGLE_AI_API_KEY       ?? '',
  STABILITY_API_KEY:       process.env.STABILITY_API_KEY       ?? '',
  FAL_API_KEY:             process.env.FAL_API_KEY             ?? '',
  REPLICATE_API_TOKEN:     process.env.REPLICATE_API_TOKEN     ?? '',
  RUNWAY_API_KEY:          process.env.RUNWAY_API_KEY          ?? '',
  HEYGEN_API_KEY:          process.env.HEYGEN_API_KEY          ?? '',
  DEFAULT_IMAGE_PROVIDER:  process.env.DEFAULT_IMAGE_PROVIDER  ?? 'none',
  DEFAULT_IMAGE_MODEL:     process.env.DEFAULT_IMAGE_MODEL     ?? '',
  DEFAULT_VIDEO_PROVIDER:  process.env.DEFAULT_VIDEO_PROVIDER  ?? 'none',
  DEFAULT_VIDEO_MODEL:     process.env.DEFAULT_VIDEO_MODEL     ?? '',
```

- [ ] **Step 4: Add new keys to the SECRETS mask list in `toApiResponse()`**

```typescript
const SECRETS: ConfigKey[] = [
  "LLM_API_KEY","REDDIT_CLIENT_SECRET","TWITTER_BEARER_TOKEN",
  "PRODUCT_HUNT_TOKEN","EXPLODING_TOPICS_API_KEY",
  "INSTAGRAM_ACCESS_TOKEN","CANVA_CLIENT_SECRET",
  "YOUTUBE_API_KEY","YOUTUBE_CLIENT_SECRET","YOUTUBE_ACCESS_TOKEN","YOUTUBE_REFRESH_TOKEN",
  // New:
  "GOOGLE_AI_API_KEY","STABILITY_API_KEY","FAL_API_KEY","REPLICATE_API_TOKEN",
  "RUNWAY_API_KEY","HEYGEN_API_KEY",
];
```

- [ ] **Step 5: Add env vars to `.env`**

```bash
# Image generation (BYOK — use whatever you already have)
GOOGLE_AI_API_KEY=        # Get from: aistudio.google.com/app/apikey
STABILITY_API_KEY=        # Get from: platform.stability.ai/account/keys
FAL_API_KEY=              # Get from: fal.ai/dashboard/keys (also unlocks Kling video)
REPLICATE_API_TOKEN=      # Get from: replicate.com/account/api-tokens

# Video generation
RUNWAY_API_KEY=           # Get from: dev.runwayml.com → API Keys
HEYGEN_API_KEY=           # Get from: app.heygen.com/settings/api

# Generation defaults (overridden per-user via Settings UI)
DEFAULT_IMAGE_PROVIDER=none
DEFAULT_IMAGE_MODEL=
DEFAULT_VIDEO_PROVIDER=none
DEFAULT_VIDEO_MODEL=
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/config/configStore.ts .env
git commit -m "feat: add image/video generation provider keys to configStore"
```

---

## Task 2: Backend provider catalog + image generation service

**Files:**
- Create: `src/config/generationProviders.ts`

- [ ] **Step 1: Create the file**

```typescript
/**
 * generationProviders.ts — server-side provider catalog + generation routing.
 *
 * Each provider implements a common interface so the API endpoint only calls
 * generateImage(prompt, provider, model) without caring which service is used.
 */

import { configStore } from "./configStore.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImageProvider = 'openai' | 'google' | 'stability' | 'fal' | 'replicate';
export type VideoProvider = 'runway' | 'heygen' | 'fal';

export interface GenerationResult {
  url:      string;   // public URL or data:image/png;base64,… for inline
  provider: string;
  model:    string;
}

export interface VideoJobResult {
  jobId:    string;
  provider: string;
  model:    string;
}

export interface VideoPollResult {
  status: 'processing' | 'succeeded' | 'failed';
  url?:   string;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function requireKey(key: string, providerName: string): string {
  if (!key) throw new Error(`${providerName} API key not configured — add it in Settings → Image Generation`);
  return key;
}

// ─── Image generation — per provider ─────────────────────────────────────────

async function generateOpenAI(prompt: string, model: string): Promise<string> {
  const apiKey = requireKey(configStore.get('LLM_API_KEY'), 'OpenAI');
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, prompt, n: 1, size: '1024x1024', response_format: 'url' }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI image generation ${res.status}: ${err}`);
  }
  const data: any = await res.json();
  return String(data.data[0].url);
}

async function generateGoogle(prompt: string, model: string): Promise<string> {
  const apiKey = requireKey(configStore.get('GOOGLE_AI_API_KEY'), 'Google Imagen');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateImages?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: { text: prompt },
        number_of_images: 1,
        aspect_ratio: 'IMAGE_ASPECT_RATIO_SQUARE',
      }),
      signal: AbortSignal.timeout(60_000),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Imagen ${res.status}: ${err}`);
  }
  const data: any = await res.json();
  const b64 = data.generatedImages?.[0]?.image?.imageBytes;
  if (!b64) throw new Error('Google Imagen returned no image data');
  return `data:image/png;base64,${b64}`;
}

async function generateStability(prompt: string, model: string): Promise<string> {
  const apiKey = requireKey(configStore.get('STABILITY_API_KEY'), 'Stability AI');
  // model is e.g. "stable-diffusion-3-5-large" — map to endpoint segment
  const endpoint = model.startsWith('stable-image/')
    ? model
    : `stable-image/generate/sd3`;
  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('output_format', 'png');
  const res = await fetch(`https://api.stability.ai/v2beta/${endpoint}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'image/*' },
    body: formData,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Stability AI ${res.status}: ${err}`);
  }
  const buffer = await res.arrayBuffer();
  const b64 = Buffer.from(buffer).toString('base64');
  return `data:image/png;base64,${b64}`;
}

async function generateFal(prompt: string, model: string): Promise<string> {
  const apiKey = requireKey(configStore.get('FAL_API_KEY'), 'fal.ai');
  const res = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Key ${apiKey}` },
    body: JSON.stringify({ prompt, image_size: 'square_hd' }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`fal.ai ${res.status}: ${err}`);
  }
  const data: any = await res.json();
  const url = data.images?.[0]?.url ?? data.image?.url;
  if (!url) throw new Error('fal.ai returned no image URL');
  return String(url);
}

async function generateReplicate(prompt: string, model: string): Promise<string> {
  const apiKey = requireKey(configStore.get('REPLICATE_API_TOKEN'), 'Replicate');
  // Step 1: create prediction
  const createRes = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ input: { prompt } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Replicate create ${createRes.status}: ${err}`);
  }
  const prediction: any = await createRes.json();
  const predId: string = prediction.id;

  // Step 2: poll until done (max 90s, 3s intervals)
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${predId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    const poll: any = await pollRes.json();
    if (poll.status === 'succeeded') {
      const out = Array.isArray(poll.output) ? poll.output[0] : poll.output;
      return String(out);
    }
    if (poll.status === 'failed') throw new Error(`Replicate failed: ${poll.error}`);
  }
  throw new Error('Replicate timed out after 90s');
}

// ─── Public image generation router ──────────────────────────────────────────

export async function generateImage(
  prompt:   string,
  provider: ImageProvider,
  model:    string
): Promise<GenerationResult> {
  let url: string;
  switch (provider) {
    case 'openai':    url = await generateOpenAI(prompt, model);    break;
    case 'google':    url = await generateGoogle(prompt, model);    break;
    case 'stability': url = await generateStability(prompt, model); break;
    case 'fal':       url = await generateFal(prompt, model);       break;
    case 'replicate': url = await generateReplicate(prompt, model); break;
    default: throw new Error(`Unknown image provider: ${provider}`);
  }
  return { url, provider, model };
}

// ─── Video generation — per provider ─────────────────────────────────────────

async function startRunway(prompt: string, model: string): Promise<string> {
  const apiKey = requireKey(configStore.get('RUNWAY_API_KEY'), 'RunwayML');
  const res = await fetch('https://api.dev.runwayml.com/v1/text_to_video', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-Runway-Version': '2024-11-06',
    },
    body: JSON.stringify({ model, promptText: prompt, duration: 5 }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`RunwayML ${res.status}: ${err}`);
  }
  const data: any = await res.json();
  return String(data.id);
}

async function pollRunway(jobId: string): Promise<VideoPollResult> {
  const apiKey = requireKey(configStore.get('RUNWAY_API_KEY'), 'RunwayML');
  const res = await fetch(`https://api.dev.runwayml.com/v1/tasks/${jobId}`, {
    headers: { 'Authorization': `Bearer ${apiKey}`, 'X-Runway-Version': '2024-11-06' },
  });
  if (!res.ok) throw new Error(`RunwayML poll ${res.status}`);
  const data: any = await res.json();
  const statusMap: Record<string, VideoPollResult['status']> = {
    SUCCEEDED: 'succeeded', FAILED: 'failed', RUNNING: 'processing', PENDING: 'processing',
  };
  return { status: statusMap[data.status] ?? 'processing', url: data.output?.[0] };
}

async function startHeyGen(prompt: string, model: string): Promise<string> {
  const apiKey = requireKey(configStore.get('HEYGEN_API_KEY'), 'HeyGen');
  const res = await fetch('https://api.heygen.com/v2/video/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify({
      video_inputs: [{ character: { type: 'avatar', avatar_id: 'default' },
        voice: { type: 'text', input_text: prompt, voice_id: 'default' } }],
      dimension: { width: 1280, height: 720 },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HeyGen ${res.status}: ${err}`);
  }
  const data: any = await res.json();
  return String(data.data?.video_id ?? data.video_id);
}

async function pollHeyGen(jobId: string): Promise<VideoPollResult> {
  const apiKey = requireKey(configStore.get('HEYGEN_API_KEY'), 'HeyGen');
  const res = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${jobId}`, {
    headers: { 'X-Api-Key': apiKey },
  });
  if (!res.ok) throw new Error(`HeyGen poll ${res.status}`);
  const data: any = await res.json();
  const s = data.data?.status ?? '';
  return {
    status: s === 'completed' ? 'succeeded' : s === 'failed' ? 'failed' : 'processing',
    url: data.data?.video_url,
  };
}

async function startKling(prompt: string, model: string): Promise<string> {
  const apiKey = requireKey(configStore.get('FAL_API_KEY'), 'fal.ai (Kling)');
  const res = await fetch(`https://queue.fal.run/${model}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Key ${apiKey}` },
    body: JSON.stringify({ prompt, duration: '5' }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Kling/fal.ai ${res.status}: ${err}`);
  }
  const data: any = await res.json();
  return String(data.request_id);
}

async function pollKling(jobId: string, model: string): Promise<VideoPollResult> {
  const apiKey = requireKey(configStore.get('FAL_API_KEY'), 'fal.ai (Kling)');
  const statusRes = await fetch(`https://queue.fal.run/${model}/requests/${jobId}/status`, {
    headers: { 'Authorization': `Key ${apiKey}` },
  });
  if (!statusRes.ok) throw new Error(`Kling poll status ${statusRes.status}`);
  const statusData: any = await statusRes.json();

  if (statusData.status !== 'COMPLETED') {
    return { status: statusData.status === 'FAILED' ? 'failed' : 'processing' };
  }
  // Fetch result
  const resultRes = await fetch(`https://queue.fal.run/${model}/requests/${jobId}`, {
    headers: { 'Authorization': `Key ${apiKey}` },
  });
  const result: any = await resultRes.json();
  return { status: 'succeeded', url: result.video?.url };
}

// ─── Public video generation router ──────────────────────────────────────────

export async function startVideoGeneration(
  prompt:   string,
  provider: VideoProvider,
  model:    string
): Promise<VideoJobResult> {
  let jobId: string;
  switch (provider) {
    case 'runway': jobId = await startRunway(prompt, model); break;
    case 'heygen': jobId = await startHeyGen(prompt, model); break;
    case 'fal':    jobId = await startKling(prompt, model);  break;
    default: throw new Error(`Unknown video provider: ${provider}`);
  }
  return { jobId, provider, model };
}

export async function pollVideoJob(
  jobId:    string,
  provider: VideoProvider,
  model:    string
): Promise<VideoPollResult> {
  switch (provider) {
    case 'runway': return pollRunway(jobId);
    case 'heygen': return pollHeyGen(jobId);
    case 'fal':    return pollKling(jobId, model);
    default: throw new Error(`Unknown video provider: ${provider}`);
  }
}

// ─── Resolve defaults ─────────────────────────────────────────────────────────

export function resolveImageProvider(override?: string): { provider: ImageProvider; model: string } {
  const provider = (override ?? configStore.get('DEFAULT_IMAGE_PROVIDER')) as ImageProvider;
  const model    = configStore.get('DEFAULT_IMAGE_MODEL') || defaultModelFor(provider, 'image');
  return { provider, model };
}

export function resolveVideoProvider(override?: string): { provider: VideoProvider; model: string } {
  const provider = (override ?? configStore.get('DEFAULT_VIDEO_PROVIDER')) as VideoProvider;
  const model    = configStore.get('DEFAULT_VIDEO_MODEL') || defaultModelFor(provider, 'video');
  return { provider, model };
}

function defaultModelFor(provider: string, type: 'image' | 'video'): string {
  const defaults: Record<string, string> = {
    openai:    'dall-e-3',
    google:    'imagen-3.0-generate-001',
    stability: 'stable-diffusion-3-5-large',
    fal:       type === 'image' ? 'fal-ai/flux/pro' : 'fal-ai/kling-video/v1.5/pro/text-to-video',
    replicate: 'black-forest-labs/flux-1.1-pro',
    runway:    'gen3a_turbo',
    heygen:    'avatar_v2',
  };
  return defaults[provider] ?? '';
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/config/generationProviders.ts
git commit -m "feat: backend generation provider catalog with image + video routing"
```

---

## Task 3: API endpoints for image and video generation

**Files:**
- Modify: `src/api/server.ts`

- [ ] **Step 1: Add import at top of server.ts**

Find the existing import block and add:

```typescript
import {
  generateImage,
  startVideoGeneration,
  pollVideoJob,
  resolveImageProvider,
  resolveVideoProvider,
  type ImageProvider,
  type VideoProvider,
} from "../config/generationProviders.js";
```

- [ ] **Step 2: Add image generation endpoint**

Add after the config patch endpoint (`app.patch("/api/config", ...)`):

```typescript
// ── AI generation endpoints ───────────────────────────────────────────────────

app.post("/api/generate/image", async (req, res, next) => {
  try {
    const { prompt, provider: providerOverride, model: modelOverride, contentId } = req.body as {
      prompt: string; provider?: string; model?: string; contentId?: string;
    };
    if (!prompt?.trim()) return void res.status(400).json({ error: 'prompt is required' });

    const { provider, model } = resolveImageProvider(providerOverride);
    if (provider === 'none' || !provider) {
      return void res.status(400).json({
        error: 'No image provider configured. Go to Settings → Image Generation and connect a provider.',
      });
    }

    const result = await generateImage(prompt.trim(), provider as ImageProvider, modelOverride ?? model);

    // Optionally persist generated URL to content item payload
    if (contentId) {
      await pool.query(
        `UPDATE content_items
         SET payload = jsonb_set(payload, '{generatedImageUrl}', $1::jsonb),
             updated_at = now()
         WHERE id = $2`,
        [JSON.stringify(result.url), contentId]
      );
    }

    res.json({ ok: true, url: result.url, provider: result.provider, model: result.model });
  } catch (err: any) {
    console.error('[generate/image]', err?.message);
    next(err);
  }
});
```

- [ ] **Step 3: Add video start endpoint**

```typescript
app.post("/api/generate/video", async (req, res, next) => {
  try {
    const { prompt, provider: providerOverride, model: modelOverride, contentId } = req.body as {
      prompt: string; provider?: string; model?: string; contentId?: string;
    };
    if (!prompt?.trim()) return void res.status(400).json({ error: 'prompt is required' });

    const { provider, model } = resolveVideoProvider(providerOverride);
    if (provider === 'none' || !provider) {
      return void res.status(400).json({
        error: 'No video provider configured. Go to Settings → Video Generation and connect a provider.',
      });
    }

    const result = await startVideoGeneration(
      prompt.trim(), provider as VideoProvider, modelOverride ?? model
    );
    res.json({ ok: true, jobId: result.jobId, provider: result.provider, model: result.model });
  } catch (err: any) {
    console.error('[generate/video]', err?.message);
    next(err);
  }
});
```

- [ ] **Step 4: Add video poll endpoint**

```typescript
app.get("/api/generate/video/:jobId", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { provider, model, contentId } = req.query as {
      provider: string; model: string; contentId?: string;
    };
    if (!provider || !model) {
      return void res.status(400).json({ error: 'provider and model query params required' });
    }

    const result = await pollVideoJob(jobId, provider as VideoProvider, model);

    // Persist URL when done
    if (result.status === 'succeeded' && result.url && contentId) {
      await pool.query(
        `UPDATE content_items
         SET payload = jsonb_set(payload, '{generatedVideoUrl}', $1::jsonb),
             updated_at = now()
         WHERE id = $2`,
        [JSON.stringify(result.url), contentId]
      );
    }

    res.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[generate/video/poll]', err?.message);
    next(err);
  }
});
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/api/server.ts
git commit -m "feat: add /api/generate/image and /api/generate/video endpoints"
```

---

## Task 4: Frontend provider catalog

**Files:**
- Create: `src/web/lib/generationProviders.ts`

- [ ] **Step 1: Create the frontend catalog file**

This is UI-only data — model labels, docs links, which configKey the provider needs. No fetch calls here.

```typescript
// src/web/lib/generationProviders.ts
// Frontend-only provider catalog — mirrors backend generationProviders.ts
// but contains only UI metadata (labels, docs URLs, key names for status checks).

export interface ModelOption {
  id:          string;
  label:       string;
  description: string;
}

export interface ProviderDef {
  id:       string;
  name:     string;
  icon:     string;
  keyName:  string;          // which configStore key holds the API key
  models:   ModelOption[];
  docsUrl:  string;
  docsLabel:string;
  note?:    string;          // e.g. "Shared with video (Kling)"
}

export const IMAGE_PROVIDER_DEFS: ProviderDef[] = [
  {
    id: 'openai', name: 'OpenAI DALL-E', icon: '🟢',
    keyName: 'LLM_API_KEY',
    models: [
      { id: 'dall-e-3', label: 'DALL-E 3',      description: 'Best quality · 1024×1024 · ~$0.04/image' },
      { id: 'dall-e-2', label: 'DALL-E 2',      description: 'Faster, cheaper · ~$0.02/image' },
    ],
    docsUrl: 'https://platform.openai.com/api-keys',
    docsLabel: 'OpenAI API Keys →',
    note: 'Uses your existing LLM_API_KEY',
  },
  {
    id: 'google', name: 'Google Imagen 3', icon: '🔵',
    keyName: 'GOOGLE_AI_API_KEY',
    models: [
      { id: 'imagen-3.0-generate-001',      label: 'Imagen 3',      description: 'Highest quality · photorealistic' },
      { id: 'imagen-3.0-fast-generate-001', label: 'Imagen 3 Fast', description: 'Faster, lower cost' },
    ],
    docsUrl: 'https://aistudio.google.com/app/apikey',
    docsLabel: 'Google AI Studio →',
  },
  {
    id: 'stability', name: 'Stability AI', icon: '🎨',
    keyName: 'STABILITY_API_KEY',
    models: [
      { id: 'stable-diffusion-3-5-large', label: 'SD 3.5 Large',    description: 'Best quality · 8B model' },
      { id: 'stable-diffusion-3-medium',  label: 'SD 3 Medium',     description: 'Balanced quality/speed' },
      { id: 'stable-image/generate/ultra',label: 'Stable Image Ultra', description: 'Ultra photorealism' },
    ],
    docsUrl: 'https://platform.stability.ai/account/keys',
    docsLabel: 'Stability AI Keys →',
  },
  {
    id: 'fal', name: 'fal.ai (Flux / Ideogram)', icon: '⚡',
    keyName: 'FAL_API_KEY',
    models: [
      { id: 'fal-ai/flux/pro',         label: 'Flux 1.1 Pro',  description: 'Best quality/cost ratio' },
      { id: 'fal-ai/flux/schnell',     label: 'Flux Schnell',  description: 'Very fast · ~$0.003/image' },
      { id: 'fal-ai/ideogram/v2',      label: 'Ideogram v2',   description: 'Best for text-in-images · infographics' },
      { id: 'fal-ai/ideogram/v2/turbo',label: 'Ideogram v2 Turbo', description: 'Faster Ideogram' },
    ],
    docsUrl: 'https://fal.ai/dashboard/keys',
    docsLabel: 'fal.ai Dashboard →',
    note: 'Same key unlocks Kling video generation',
  },
  {
    id: 'replicate', name: 'Replicate', icon: '🔄',
    keyName: 'REPLICATE_API_TOKEN',
    models: [
      { id: 'black-forest-labs/flux-1.1-pro', label: 'Flux 1.1 Pro',  description: 'Via Replicate · pay per run' },
      { id: 'stability-ai/sdxl',              label: 'SDXL',           description: 'Fast and customizable' },
      { id: 'ideogram-ai/ideogram-v2',        label: 'Ideogram v2',    description: 'Text-heavy designs' },
    ],
    docsUrl: 'https://replicate.com/account/api-tokens',
    docsLabel: 'Replicate Tokens →',
  },
];

export const VIDEO_PROVIDER_DEFS: ProviderDef[] = [
  {
    id: 'runway', name: 'RunwayML', icon: '🎬',
    keyName: 'RUNWAY_API_KEY',
    models: [
      { id: 'gen3a_turbo', label: 'Gen-3 Alpha Turbo', description: 'Fast · 5s clips · lower cost' },
      { id: 'gen3a',       label: 'Gen-3 Alpha',       description: 'Highest quality · 10s clips' },
    ],
    docsUrl: 'https://dev.runwayml.com',
    docsLabel: 'RunwayML Dev Portal →',
  },
  {
    id: 'heygen', name: 'HeyGen', icon: '🎙️',
    keyName: 'HEYGEN_API_KEY',
    models: [
      { id: 'avatar_v2', label: 'Avatar v2', description: 'AI presenter — talking head videos' },
    ],
    docsUrl: 'https://app.heygen.com/settings/api',
    docsLabel: 'HeyGen API Settings →',
    note: 'Best for presenter/spokesperson content',
  },
  {
    id: 'fal', name: 'Kling AI (via fal.ai)', icon: '⚡',
    keyName: 'FAL_API_KEY',
    models: [
      { id: 'fal-ai/kling-video/v1.5/pro/text-to-video',      label: 'Kling v1.5 Pro',      description: 'Best quality · 5s clip' },
      { id: 'fal-ai/kling-video/v1/standard/text-to-video',   label: 'Kling v1 Standard',   description: 'Balanced · 5s clip' },
    ],
    docsUrl: 'https://fal.ai/dashboard/keys',
    docsLabel: 'fal.ai Dashboard →',
    note: 'Same FAL_API_KEY as image generation',
  },
];
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/web/lib/generationProviders.ts
git commit -m "feat: frontend generation provider catalog"
```

---

## Task 5: Add generation API calls to api.ts

**Files:**
- Modify: `src/web/lib/api.ts`

- [ ] **Step 1: Add generation methods to the api object**

```typescript
// ── AI Generation ─────────────────────────────────────────────────────────────
generateImage: (body: {
  prompt: string; provider?: string; model?: string; contentId?: string;
}) => req<{ ok: boolean; url: string; provider: string; model: string }>(
  '/generate/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
),

generateVideo: (body: {
  prompt: string; provider?: string; model?: string; contentId?: string;
}) => req<{ ok: boolean; jobId: string; provider: string; model: string }>(
  '/generate/video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
),

pollVideoJob: (jobId: string, provider: string, model: string, contentId?: string) => {
  const qs = new URLSearchParams({ provider, model });
  if (contentId) qs.set('contentId', contentId);
  return req<{ ok: boolean; status: string; url?: string }>(`/generate/video/${jobId}?${qs}`);
},
```

- [ ] **Step 2: Commit**

```bash
git add src/web/lib/api.ts
git commit -m "feat: add generateImage, generateVideo, pollVideoJob to frontend api client"
```

---

## Task 6: ImageGenManager settings component

**Files:**
- Create: `src/web/components/settings/ImageGenManager.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/web/components/settings/ImageGenManager.tsx
import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { IMAGE_PROVIDER_DEFS, type ProviderDef } from '../../lib/generationProviders';

// ─── ProviderCard ─────────────────────────────────────────────────────────────

function ProviderCard({
  def, values, isDefault, onSetDefault, onChange,
}: {
  def:          ProviderDef;
  values:       Record<string, { value: string; masked: boolean }>;
  isDefault:    boolean;
  onSetDefault: () => void;
  onChange:     (key: string, value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const apiKeyValue = values[def.keyName]?.value ?? '';
  const isConnected = apiKeyValue.length > 0;

  return (
    <div style={{
      border: `1px solid ${isDefault ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 10,
      background: isDefault ? 'color-mix(in srgb, var(--accent) 4%, var(--bg-surface))' : 'var(--bg-surface)',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>{def.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{def.name}</div>
          {def.note && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{def.note}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {isConnected
            ? <span className="badge badge-green" style={{ fontSize: 10 }}>Connected</span>
            : <span className="badge badge-muted"  style={{ fontSize: 10 }}>No key</span>
          }
          {isConnected && (
            <button
              onClick={onSetDefault}
              className={`btn btn-sm ${isDefault ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 10 }}>
              {isDefault ? '★ Default' : 'Set default'}
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
            onClick={() => setExpanded(e => !e)}>
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Expanded: API key + model list */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 14px',
          background: 'var(--bg-elevated)' }}>
          {/* API key input */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
              API Key <span style={{ fontSize: 10 }}>({def.keyName})</span>
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="password"
                value={apiKeyValue}
                placeholder={`Paste your ${def.name} key…`}
                style={{ flex: 1, fontSize: 12 }}
                onChange={e => onChange(def.keyName, e.target.value)}
              />
              <a href={def.docsUrl} target="_blank" rel="noopener noreferrer"
                className="btn btn-ghost btn-sm" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                {def.docsLabel}
              </a>
            </div>
          </div>

          {/* Models */}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>
            Available models
          </div>
          {def.models.map(m => (
            <div key={m.id} style={{ display: 'flex', gap: 8, padding: '5px 0',
              borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-primary)',
                minWidth: 200, flexShrink: 0 }}>{m.label}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>{m.description}</span>
              <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--text-muted)',
                flexShrink: 0 }}>{m.id}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ImageGenManager ──────────────────────────────────────────────────────────

export const ImageGenManager: React.FC = () => {
  const [config,   setConfig]   = useState<Record<string, { value: string; masked: boolean }>>({});
  const [dirty,    setDirty]    = useState<Record<string, string>>({});
  const [saving,   setSaving]   = useState(false);
  const [saveMsg,  setSaveMsg]  = useState<string | null>(null);
  const [defaultProvider, setDefaultProvider] = useState('none');
  const [defaultModel,    setDefaultModel]    = useState('');

  useEffect(() => {
    api.getConfig().then((cfg: any) => {
      setConfig(cfg.values ?? {});
      setDefaultProvider(cfg.values?.DEFAULT_IMAGE_PROVIDER?.value ?? 'none');
      setDefaultModel(cfg.values?.DEFAULT_IMAGE_MODEL?.value ?? '');
    }).catch(() => {});
  }, []);

  const handleChange = (key: string, value: string) => {
    setDirty(d => ({ ...d, [key]: value }));
    setConfig(c => ({ ...c, [key]: { value, masked: false } }));
  };

  const handleSetDefault = (providerId: string) => {
    const def = IMAGE_PROVIDER_DEFS.find(d => d.id === providerId);
    const model = def?.models[0]?.id ?? '';
    setDefaultProvider(providerId);
    setDefaultModel(model);
    handleChange('DEFAULT_IMAGE_PROVIDER', providerId);
    handleChange('DEFAULT_IMAGE_MODEL', model);
  };

  const handleSave = async () => {
    if (!Object.keys(dirty).length) return;
    setSaving(true);
    try {
      await api.patchConfig(dirty);
      setDirty({});
      setSaveMsg('✓ Saved');
    } catch { setSaveMsg('✗ Save failed'); }
    finally { setSaving(false); setTimeout(() => setSaveMsg(null), 2500); }
  };

  const connectedProviders = IMAGE_PROVIDER_DEFS.filter(def => {
    const val = dirty[def.keyName] ?? config[def.keyName]?.value ?? '';
    return val.length > 0;
  });

  return (
    <div>
      {/* Section header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 18 }}>🖼️</span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Image Generation</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Connect your own API keys. The engine uses whichever provider you set as default.
          Override per content piece in the editor.
          {connectedProviders.length === 0 && (
            <span style={{ color: 'var(--accent)', marginLeft: 4 }}>
              No providers connected yet — expand a card below to add a key.
            </span>
          )}
        </div>
      </div>

      {/* Default summary */}
      {defaultProvider !== 'none' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', marginBottom: 16, fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)' }}>Default:</span>
          <strong style={{ color: 'var(--text-primary)' }}>
            {IMAGE_PROVIDER_DEFS.find(d => d.id === defaultProvider)?.name ?? defaultProvider}
          </strong>
          <span style={{ color: 'var(--text-muted)' }}>·</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
            {defaultModel}
          </span>
        </div>
      )}

      {/* Provider cards */}
      {IMAGE_PROVIDER_DEFS.map(def => (
        <ProviderCard
          key={def.id}
          def={def}
          values={{ ...config, ...Object.fromEntries(Object.entries(dirty).map(([k, v]) => [k, { value: v, masked: false }])) }}
          isDefault={defaultProvider === def.id}
          onSetDefault={() => handleSetDefault(def.id)}
          onChange={handleChange}
        />
      ))}

      {/* Save bar */}
      {Object.keys(dirty).length > 0 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
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
```

- [ ] **Step 2: Commit**

```bash
git add src/web/components/settings/ImageGenManager.tsx
git commit -m "feat: ImageGenManager settings component"
```

---

## Task 7: VideoGenManager settings component

**Files:**
- Create: `src/web/components/settings/VideoGenManager.tsx`

- [ ] **Step 1: Create the component**

Same structure as `ImageGenManager` but for video. Copy the pattern exactly, replacing:
- `IMAGE_PROVIDER_DEFS` → `VIDEO_PROVIDER_DEFS`
- `DEFAULT_IMAGE_PROVIDER` / `DEFAULT_IMAGE_MODEL` → `DEFAULT_VIDEO_PROVIDER` / `DEFAULT_VIDEO_MODEL`
- Section title: `🎬 Video Generation`
- Description: `"Connect video generation providers. Video jobs are async — the engine polls until complete. Override per content piece in the editor."`

```tsx
// src/web/components/settings/VideoGenManager.tsx
import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { VIDEO_PROVIDER_DEFS, type ProviderDef } from '../../lib/generationProviders';

// ProviderCard is identical to the one in ImageGenManager — copy it verbatim.
// (In a future refactor this could be extracted to a shared component, but
// duplication here is intentional: the two managers may diverge.)

function ProviderCard({
  def, values, isDefault, onSetDefault, onChange,
}: {
  def: ProviderDef; values: Record<string, { value: string; masked: boolean }>;
  isDefault: boolean; onSetDefault: () => void; onChange: (key: string, value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const apiKeyValue = values[def.keyName]?.value ?? '';
  const isConnected = apiKeyValue.length > 0;

  return (
    <div style={{
      border: `1px solid ${isDefault ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 10,
      background: isDefault ? 'color-mix(in srgb, var(--accent) 4%, var(--bg-surface))' : 'var(--bg-surface)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
        <span style={{ fontSize: 20, flexShrink: 0 }}>{def.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{def.name}</div>
          {def.note && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{def.note}</div>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          {isConnected
            ? <span className="badge badge-green" style={{ fontSize: 10 }}>Connected</span>
            : <span className="badge badge-muted"  style={{ fontSize: 10 }}>No key</span>}
          {isConnected && (
            <button onClick={onSetDefault}
              className={`btn btn-sm ${isDefault ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 10 }}>
              {isDefault ? '★ Default' : 'Set default'}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
            onClick={() => setExpanded(e => !e)}>
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 14px', background: 'var(--bg-elevated)' }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
              API Key <span style={{ fontSize: 10 }}>({def.keyName})</span>
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="password" value={apiKeyValue}
                placeholder={`Paste your ${def.name} key…`}
                style={{ flex: 1, fontSize: 12 }}
                onChange={e => onChange(def.keyName, e.target.value)} />
              <a href={def.docsUrl} target="_blank" rel="noopener noreferrer"
                className="btn btn-ghost btn-sm" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                {def.docsLabel}
              </a>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>
            Available models
          </div>
          {def.models.map(m => (
            <div key={m.id} style={{ display: 'flex', gap: 8, padding: '5px 0',
              borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-primary)',
                minWidth: 180, flexShrink: 0 }}>{m.label}</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>{m.description}</span>
              <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--text-muted)',
                flexShrink: 0 }}>{m.id}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const VideoGenManager: React.FC = () => {
  const [config,  setConfig]  = useState<Record<string, { value: string; masked: boolean }>>({});
  const [dirty,   setDirty]   = useState<Record<string, string>>({});
  const [saving,  setSaving]  = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [defaultProvider, setDefaultProvider] = useState('none');
  const [defaultModel,    setDefaultModel]    = useState('');

  useEffect(() => {
    api.getConfig().then((cfg: any) => {
      setConfig(cfg.values ?? {});
      setDefaultProvider(cfg.values?.DEFAULT_VIDEO_PROVIDER?.value ?? 'none');
      setDefaultModel(cfg.values?.DEFAULT_VIDEO_MODEL?.value ?? '');
    }).catch(() => {});
  }, []);

  const handleChange = (key: string, value: string) => {
    setDirty(d => ({ ...d, [key]: value }));
    setConfig(c => ({ ...c, [key]: { value, masked: false } }));
  };

  const handleSetDefault = (providerId: string) => {
    const def = VIDEO_PROVIDER_DEFS.find(d => d.id === providerId);
    const model = def?.models[0]?.id ?? '';
    setDefaultProvider(providerId);
    setDefaultModel(model);
    handleChange('DEFAULT_VIDEO_PROVIDER', providerId);
    handleChange('DEFAULT_VIDEO_MODEL', model);
  };

  const handleSave = async () => {
    if (!Object.keys(dirty).length) return;
    setSaving(true);
    try {
      await api.patchConfig(dirty);
      setDirty({});
      setSaveMsg('✓ Saved');
    } catch { setSaveMsg('✗ Save failed'); }
    finally { setSaving(false); setTimeout(() => setSaveMsg(null), 2500); }
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 18 }}>🎬</span>
          <span style={{ fontSize: 16, fontWeight: 700 }}>Video Generation</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Video generation is async — jobs are queued and polled. The editor shows a progress
          indicator until the video is ready. Override provider and model per content piece.
        </div>
      </div>

      {defaultProvider !== 'none' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)', marginBottom: 16, fontSize: 12 }}>
          <span style={{ color: 'var(--text-muted)' }}>Default:</span>
          <strong style={{ color: 'var(--text-primary)' }}>
            {VIDEO_PROVIDER_DEFS.find(d => d.id === defaultProvider)?.name ?? defaultProvider}
          </strong>
          <span style={{ color: 'var(--text-muted)' }}>·</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
            {defaultModel}
          </span>
        </div>
      )}

      {VIDEO_PROVIDER_DEFS.map(def => (
        <ProviderCard key={def.id} def={def}
          values={{ ...config, ...Object.fromEntries(Object.entries(dirty).map(([k, v]) => [k, { value: v, masked: false }])) }}
          isDefault={defaultProvider === def.id}
          onSetDefault={() => handleSetDefault(def.id)}
          onChange={handleChange} />
      ))}

      {Object.keys(dirty).length > 0 && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
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
```

- [ ] **Step 2: Commit**

```bash
git add src/web/components/settings/VideoGenManager.tsx
git commit -m "feat: VideoGenManager settings component"
```

---

## Task 8: Wire generation managers into SettingsView

**Files:**
- Modify: `src/web/views/SettingsView.tsx`

- [ ] **Step 1: Add imports**

```typescript
import { ImageGenManager } from '../components/settings/ImageGenManager';
import { VideoGenManager } from '../components/settings/VideoGenManager';
```

- [ ] **Step 2: Add groups to NAV_SECTIONS**

Change the System section to include Image Generation and Video Generation:

```typescript
const NAV_SECTIONS: { label: string; groups: string[] }[] = [
  { label: 'System',               groups: ['AI / LLM', 'Branding', 'Content Sources', 'Pipeline'] },
  { label: 'Generation',           groups: ['Image Generation', 'Video Generation'] },  // ← new
  { label: 'Ingestion — Free',     groups: ['Reddit', 'Product Hunt'] },
  { label: 'Ingestion — Premium',  groups: ['Twitter / X', 'Exploding Topics'] },
  { label: 'Publishing',           groups: ['Instagram', 'YouTube', 'Canva'] },
];
```

- [ ] **Step 3: Add group icons and descriptions**

```typescript
const GROUP_ICONS: Record<string, string> = {
  // ... existing ...
  'Image Generation': '🖼️',
  'Video Generation': '🎬',
};

const GROUP_DESC: Record<string, string> = {
  // ... existing ...
  'Image Generation': 'BYOK image generation — connect OpenAI, Google Imagen, Stability AI, fal.ai, or Replicate',
  'Video Generation': 'BYOK video generation — connect RunwayML, HeyGen, or Kling AI via fal.ai',
};
```

- [ ] **Step 4: Update GROUP_ORDER_WITH_BRANDING**

```typescript
const GROUP_ORDER_WITH_BRANDING = [
  'AI / LLM', 'Branding', 'Content Sources', 'Pipeline',
  'Image Generation', 'Video Generation',               // ← new
  'Reddit', 'Product Hunt',
  'Twitter / X', 'Exploding Topics',
  'Instagram', 'YouTube', 'Canva',
];
```

- [ ] **Step 5: Mount the managers in the content area**

Find the block that handles special group rendering and add the two new cases:

```typescript
} : activeGroup === 'Image Generation' ? (
  <ImageGenManager />
) : activeGroup === 'Video Generation' ? (
  <VideoGenManager />
) : loading ? (
```

This goes immediately after the `activeGroup === 'Content Sources'` branch.

- [ ] **Step 6: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/web/views/SettingsView.tsx
git commit -m "feat: add Image Generation and Video Generation to Settings nav"
```

---

## Task 9: GenerationPanel — per-content override in the editor

**Files:**
- Create: `src/web/components/editor/GenerationPanel.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/web/components/editor/GenerationPanel.tsx
//
// Inline generation panel inside the content editor.
// Shows available providers (from config) and lets user:
//  1. Pick provider + model (overrides the global default for this piece)
//  2. Write or auto-fill a generation prompt
//  3. Generate image (immediate) or video (async, polls until done)
//  4. Preview result inline
//
// Generated URLs are saved to the content item's payload via the API.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../lib/api';
import {
  IMAGE_PROVIDER_DEFS, VIDEO_PROVIDER_DEFS, type ProviderDef,
} from '../../lib/generationProviders';

type AssetType = 'image' | 'video';

interface ProviderOption {
  id:     string;
  name:   string;
  icon:   string;
  models: { id: string; label: string }[];
}

interface GenerationPanelProps {
  contentId:   string;
  topicTitle:  string;
  contentType: string;       // 'post' | 'carousel' | 'reel'
  initialImageUrl?: string;
  initialVideoUrl?: string;
  onImageGenerated: (url: string) => void;
  onVideoGenerated: (url: string) => void;
}

export const GenerationPanel: React.FC<GenerationPanelProps> = ({
  contentId, topicTitle, contentType,
  initialImageUrl, initialVideoUrl,
  onImageGenerated, onVideoGenerated,
}) => {
  const [config, setConfig] = useState<Record<string, { value: string }>>({});

  // Which type is active
  const [assetType, setAssetType] = useState<AssetType>(
    contentType === 'reel' ? 'video' : 'image'
  );

  // Provider/model selection (start empty — resolved from config after load)
  const [imageProvider, setImageProvider] = useState('');
  const [imageModel,    setImageModel]    = useState('');
  const [videoProvider, setVideoProvider] = useState('');
  const [videoModel,    setVideoModel]    = useState('');

  // Prompt
  const [prompt, setPrompt] = useState('');

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [imageUrl,   setImageUrl]   = useState(initialImageUrl ?? '');
  const [videoUrl,   setVideoUrl]   = useState(initialVideoUrl ?? '');
  const [videoJobId, setVideoJobId] = useState<string | null>(null);
  const [videoStatus, setVideoStatus] = useState<string>('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load config + set defaults
  useEffect(() => {
    api.getConfig().then((cfg: any) => {
      const vals = cfg.values ?? {};
      setConfig(vals);
      const defImgProv = vals.DEFAULT_IMAGE_PROVIDER?.value ?? 'none';
      const defImgMod  = vals.DEFAULT_IMAGE_MODEL?.value ?? '';
      const defVidProv = vals.DEFAULT_VIDEO_PROVIDER?.value ?? 'none';
      const defVidMod  = vals.DEFAULT_VIDEO_MODEL?.value ?? '';
      if (defImgProv !== 'none') { setImageProvider(defImgProv); setImageModel(defImgMod); }
      if (defVidProv !== 'none') { setVideoProvider(defVidProv); setVideoModel(defVidMod); }
    }).catch(() => {});
    // Auto-fill prompt from topic title
    setPrompt(topicTitle);
  }, [topicTitle]);

  // Stop poll on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Build connected provider lists
  const connectedImageProviders: ProviderOption[] = IMAGE_PROVIDER_DEFS
    .filter(def => (config[def.keyName]?.value ?? '').length > 0)
    .map(def => ({ id: def.id, name: def.name, icon: def.icon, models: def.models }));

  const connectedVideoProviders: ProviderOption[] = VIDEO_PROVIDER_DEFS
    .filter(def => (config[def.keyName]?.value ?? '').length > 0)
    .map(def => ({ id: def.id, name: def.name, icon: def.icon, models: def.models }));

  const activeProviders = assetType === 'image' ? connectedImageProviders : connectedVideoProviders;

  const activeProvider = assetType === 'image' ? imageProvider : videoProvider;
  const setActiveProvider = assetType === 'image' ? setImageProvider : setVideoProvider;
  const activeModel    = assetType === 'image' ? imageModel    : videoModel;
  const setActiveModel = assetType === 'image' ? setImageModel : setVideoModel;

  const handleProviderChange = (providerId: string) => {
    setActiveProvider(providerId);
    const def = (assetType === 'image' ? IMAGE_PROVIDER_DEFS : VIDEO_PROVIDER_DEFS)
      .find(d => d.id === providerId);
    setActiveModel(def?.models[0]?.id ?? '');
  };

  // ─── Image generation ────────────────────────────────────────────────────

  const handleGenerateImage = async () => {
    if (!prompt.trim() || !imageProvider) return;
    setGenerating(true); setError(null);
    try {
      const result = await api.generateImage({
        prompt: prompt.trim(),
        provider: imageProvider,
        model: imageModel,
        contentId,
      });
      setImageUrl(result.url);
      onImageGenerated(result.url);
    } catch (err: any) {
      setError(err?.message ?? 'Image generation failed');
    } finally { setGenerating(false); }
  };

  // ─── Video generation ────────────────────────────────────────────────────

  const startPoll = useCallback((jobId: string, provider: string, model: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const result = await api.pollVideoJob(jobId, provider, model, contentId);
        setVideoStatus(result.status);
        if (result.status === 'succeeded' && result.url) {
          clearInterval(pollRef.current!);
          setVideoUrl(result.url);
          onVideoGenerated(result.url);
          setGenerating(false);
          setVideoJobId(null);
        } else if (result.status === 'failed') {
          clearInterval(pollRef.current!);
          setError('Video generation failed — check provider logs');
          setGenerating(false);
          setVideoJobId(null);
        }
      } catch (err: any) {
        clearInterval(pollRef.current!);
        setError(err?.message ?? 'Polling failed');
        setGenerating(false);
      }
    }, 5000); // poll every 5s
  }, [contentId, onVideoGenerated]);

  const handleGenerateVideo = async () => {
    if (!prompt.trim() || !videoProvider) return;
    setGenerating(true); setError(null); setVideoStatus('queued');
    try {
      const result = await api.generateVideo({
        prompt: prompt.trim(),
        provider: videoProvider,
        model: videoModel,
        contentId,
      });
      setVideoJobId(result.jobId);
      startPoll(result.jobId, result.provider, result.model);
    } catch (err: any) {
      setError(err?.message ?? 'Video generation failed');
      setGenerating(false);
    }
  };

  const handleGenerate = () => {
    if (assetType === 'image') handleGenerateImage();
    else handleGenerateVideo();
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  const noProviders = activeProviders.length === 0;
  const canGenerate = !generating && !!prompt.trim() && !!activeProvider && !noProviders;

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
      {/* Panel header + type toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
          AI Generation
        </span>
        <div style={{ display: 'flex', gap: 2, background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-sm)', padding: 2, marginLeft: 'auto' }}>
          {(['image', 'video'] as AssetType[]).map(t => (
            <button key={t} onClick={() => setAssetType(t)}
              className={`btn btn-sm ${assetType === t ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 10, padding: '3px 10px' }}>
              {t === 'image' ? '🖼️ Image' : '🎬 Video'}
            </button>
          ))}
        </div>
      </div>

      {/* No provider warning */}
      {noProviders ? (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '10px 12px',
          background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border)', lineHeight: 1.6 }}>
          No {assetType} providers connected.{' '}
          <a href="#" onClick={e => { e.preventDefault(); }}
            style={{ color: 'var(--accent)', textDecoration: 'none' }}>
            Go to Settings → {assetType === 'image' ? 'Image' : 'Video'} Generation
          </a>{' '}to add a key.
        </div>
      ) : (
        <>
          {/* Provider + model row */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <select value={activeProvider} style={{ flex: 1, fontSize: 11 }}
              onChange={e => handleProviderChange(e.target.value)}>
              <option value="">Select provider…</option>
              {activeProviders.map(p => (
                <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
              ))}
            </select>
            <select value={activeModel} style={{ flex: 1, fontSize: 11 }}
              onChange={e => setActiveModel(e.target.value)}>
              {(activeProviders.find(p => p.id === activeProvider)?.models ?? []).map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Prompt */}
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Describe the image or video you want to generate…"
            rows={2}
            style={{ width: '100%', fontSize: 11, resize: 'vertical',
              marginBottom: 8, boxSizing: 'border-box' }}
          />

          {/* Generate button */}
          <button className="btn btn-primary btn-sm" style={{ width: '100%', fontSize: 11 }}
            disabled={!canGenerate} onClick={handleGenerate}>
            {generating
              ? assetType === 'video'
                ? `⏳ ${videoStatus || 'Generating…'} — polling every 5s`
                : '⏳ Generating image…'
              : `✨ Generate ${assetType}`}
          </button>
        </>
      )}

      {/* Error */}
      {error && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--red)', padding: '6px 10px',
          background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--radius-sm)',
          border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </div>
      )}

      {/* Image preview */}
      {imageUrl && assetType === 'image' && (
        <div style={{ marginTop: 10 }}>
          <img src={imageUrl} alt="Generated" style={{ width: '100%', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)', maxHeight: 300, objectFit: 'cover' }} />
          <a href={imageUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 10, color: 'var(--accent)', display: 'block', marginTop: 4 }}>
            Open full size ↗
          </a>
        </div>
      )}

      {/* Video preview */}
      {videoUrl && assetType === 'video' && (
        <div style={{ marginTop: 10 }}>
          <video src={videoUrl} controls style={{ width: '100%', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)', maxHeight: 300 }} />
        </div>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add src/web/components/editor/GenerationPanel.tsx
git commit -m "feat: GenerationPanel component with image + video generation and async polling"
```

---

## Task 10: Mount GenerationPanel in ContentEditor

**Files:**
- Modify: `src/web/components/editor/ContentEditor.tsx`

- [ ] **Step 1: Add import**

```typescript
import { GenerationPanel } from './GenerationPanel';
```

- [ ] **Step 2: Track generated asset URLs in local state**

Find the existing state declarations in `ContentEditor` and add:

```typescript
const [generatedImageUrl, setGeneratedImageUrl] = useState<string>(
  item?.payload?.generatedImageUrl ?? ''
);
const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string>(
  item?.payload?.generatedVideoUrl ?? ''
);
```

- [ ] **Step 3: Mount GenerationPanel in the editor sidebar**

Find the section in the editor layout where source article / metadata is shown (the right sidebar or bottom panel). Add `GenerationPanel` there:

```tsx
<GenerationPanel
  contentId={item.id}
  topicTitle={item.topic_title}
  contentType={item.type}
  initialImageUrl={generatedImageUrl}
  initialVideoUrl={generatedVideoUrl}
  onImageGenerated={(url) => {
    setGeneratedImageUrl(url);
    // Also reflect in the payload preview if it shows media
  }}
  onVideoGenerated={(url) => {
    setGeneratedVideoUrl(url);
  }}
/>
```

The exact placement depends on ContentEditor's layout — put it below the Source Article section and above the Save/Approve buttons.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Final integration commit**

```bash
git add src/web/components/editor/ContentEditor.tsx
git commit -m "feat: mount GenerationPanel in ContentEditor for per-content AI generation"
```

---

---

## Task 11: Brand Kit — Logo Generator with ranked BYOK providers

The Branding settings section already exists with palette and font tools. This task adds a logo generator that uses whatever image API the user already has connected, shows providers ranked from best-to-worst for logo creation, and nudges users toward Ideogram (via fal.ai) when it's not connected.

**Provider ranking for logo generation** (descending quality — text-in-image fidelity, graphic precision):
1. Ideogram v2 (fal.ai) — best text rendering, built for logos/infographics
2. DALL-E 3 (OpenAI) — strong composition, reliable text
3. Imagen 3 (Google) — photorealistic, good for brand imagery
4. Flux 1.1 Pro (fal.ai) — excellent quality/cost, same key as Ideogram
5. Stable Diffusion 3.5 (Stability AI) — versatile, graphic style support
6. Flux via Replicate — pay-per-run, good fallback

Note: items 1 and 4 both use `FAL_API_KEY` — if the user has it they get both automatically.

**Files:**
- Create: `src/web/components/settings/BrandKitLogoGenerator.tsx`
- Modify: `src/web/views/SettingsView.tsx` (mount in Branding section)

- [ ] **Step 1: Create `BrandKitLogoGenerator.tsx`**

```tsx
// src/web/components/settings/BrandKitLogoGenerator.tsx
//
// Logo generation panel inside the Branding settings section.
// Uses whatever image API keys the user already has connected.
// Providers are ranked by logo-generation quality (descending).
// Nudges users to get Ideogram (fal.ai) if not connected.

import React, { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { IMAGE_PROVIDER_DEFS } from '../../lib/generationProviders';

// Ranked order of provider+model pairs for logo generation.
// Each entry maps to an IMAGE_PROVIDER_DEFS id + a specific model.
// Ranking: text fidelity, graphic precision, logo/icon quality.
const LOGO_PROVIDER_RANKING: {
  providerId: string;
  modelId:    string;
  label:      string;
  note:       string;
  keyName:    string;
}[] = [
  {
    providerId: 'fal',
    modelId:    'fal-ai/ideogram/v2',
    label:      'Ideogram v2 (via fal.ai)',
    note:       'Best for logos — precise text, clean graphics',
    keyName:    'FAL_API_KEY',
  },
  {
    providerId: 'openai',
    modelId:    'dall-e-3',
    label:      'DALL-E 3 (OpenAI)',
    note:       'Strong composition, reliable text rendering',
    keyName:    'LLM_API_KEY',
  },
  {
    providerId: 'google',
    modelId:    'imagen-3.0-generate-001',
    label:      'Imagen 3 (Google)',
    note:       'Photorealistic quality, good for brand imagery',
    keyName:    'GOOGLE_AI_API_KEY',
  },
  {
    providerId: 'fal',
    modelId:    'fal-ai/flux/pro',
    label:      'Flux 1.1 Pro (fal.ai)',
    note:       'Excellent quality/cost — same fal.ai key as Ideogram',
    keyName:    'FAL_API_KEY',
  },
  {
    providerId: 'stability',
    modelId:    'stable-diffusion-3-5-large',
    label:      'SD 3.5 Large (Stability AI)',
    note:       'Versatile, graphic style support',
    keyName:    'STABILITY_API_KEY',
  },
  {
    providerId: 'replicate',
    modelId:    'black-forest-labs/flux-1.1-pro',
    label:      'Flux 1.1 Pro (Replicate)',
    note:       'Pay-per-run fallback',
    keyName:    'REPLICATE_API_TOKEN',
  },
];

const IDEOGRAM_KEY = 'FAL_API_KEY';

export const BrandKitLogoGenerator: React.FC = () => {
  const [config,    setConfig]    = useState<Record<string, { value: string }>>({});
  const [selected,  setSelected]  = useState<(typeof LOGO_PROVIDER_RANKING)[0] | null>(null);
  const [prompt,    setPrompt]    = useState('');
  const [generating, setGenerating] = useState(false);
  const [logoUrl,   setLogoUrl]   = useState('');
  const [error,     setError]     = useState<string | null>(null);

  useEffect(() => {
    api.getConfig().then((cfg: any) => {
      const vals = cfg.values ?? {};
      setConfig(vals);
      // Auto-select the highest-ranked connected provider
      const first = LOGO_PROVIDER_RANKING.find(p => (vals[p.keyName]?.value ?? '').length > 0);
      if (first) setSelected(first);
    }).catch(() => {});
  }, []);

  const isConnected = (keyName: string) =>
    (config[keyName]?.value ?? '').length > 0;

  const ideogramConnected = isConnected(IDEOGRAM_KEY);
  const anyConnected = LOGO_PROVIDER_RANKING.some(p => isConnected(p.keyName));

  const handleGenerate = async () => {
    if (!selected || !prompt.trim()) return;
    setGenerating(true); setError(null);
    try {
      const result = await api.generateImage({
        prompt: prompt.trim(),
        provider: selected.providerId,
        model:    selected.modelId,
      });
      setLogoUrl(result.url);
    } catch (err: any) {
      setError(err?.message ?? 'Logo generation failed');
    } finally { setGenerating(false); }
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: 'var(--text-primary)' }}>
        Logo Generator
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.6 }}>
        Generate logo concepts using your connected image APIs.
        Providers are ranked by logo quality — best first.
      </div>

      {/* Ideogram nudge (shown when fal.ai key is missing) */}
      {!ideogramConnected && (
        <div style={{
          padding: '10px 14px', marginBottom: 14,
          background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-elevated))',
          border: '1px solid color-mix(in srgb, var(--accent) 30%, var(--border))',
          borderRadius: 'var(--radius-sm)', fontSize: 11, lineHeight: 1.6,
        }}>
          <strong style={{ color: 'var(--accent)' }}>✨ Best for logos: Ideogram v2</strong>
          <br />
          Ideogram produces the sharpest text and cleanest graphic style for brand assets.
          It runs on fal.ai — the same key also unlocks Flux image generation and Kling video.
          {' '}
          <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noopener noreferrer"
            style={{ color: 'var(--accent)', fontWeight: 600 }}>
            Get your fal.ai key →
          </a>
          {' '}then add it in{' '}
          <strong>Settings → Image Generation → fal.ai</strong>.
        </div>
      )}

      {!anyConnected ? (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '10px 12px',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)' }}>
          No image providers connected. Add an API key in{' '}
          <strong>Settings → Image Generation</strong> to unlock logo generation.
        </div>
      ) : (
        <>
          {/* Ranked provider selector */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>
              Select provider (ranked best → good)
            </div>
            {LOGO_PROVIDER_RANKING.map((p, i) => {
              const connected = isConnected(p.keyName);
              const isActive  = selected?.modelId === p.modelId && selected?.providerId === p.providerId;
              return (
                <button
                  key={`${p.providerId}-${p.modelId}`}
                  disabled={!connected}
                  onClick={() => setSelected(p)}
                  style={{
                    display: 'flex', width: '100%', alignItems: 'center', gap: 10,
                    padding: '8px 12px', marginBottom: 4, textAlign: 'left', cursor: connected ? 'pointer' : 'default',
                    border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-sm)',
                    background: isActive
                      ? 'color-mix(in srgb, var(--accent) 8%, var(--bg-surface))'
                      : connected ? 'var(--bg-surface)' : 'var(--bg-elevated)',
                    opacity: connected ? 1 : 0.45,
                  }}
                >
                  {/* Rank badge */}
                  <span style={{ fontSize: 10, fontFamily: 'var(--mono)', fontWeight: 700,
                    color: i === 0 ? 'var(--accent)' : 'var(--text-muted)',
                    width: 18, flexShrink: 0, textAlign: 'center' }}>
                    #{i + 1}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {p.label}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                      {p.note}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, flexShrink: 0,
                    color: connected ? 'var(--green)' : 'var(--text-muted)' }}>
                    {connected ? '● Connected' : '○ No key'}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Prompt */}
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="e.g. Minimal logo for a fintech startup called Antigravity, dark theme, geometric lettermark, no gradients"
            rows={2}
            style={{ width: '100%', fontSize: 11, resize: 'vertical',
              marginBottom: 8, boxSizing: 'border-box' }}
          />

          {/* Generate */}
          <button
            className="btn btn-primary btn-sm"
            style={{ width: '100%', fontSize: 11 }}
            disabled={generating || !selected || !prompt.trim()}
            onClick={handleGenerate}
          >
            {generating ? '⏳ Generating logo…' : '✨ Generate Logo'}
          </button>

          {error && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--red)', padding: '6px 10px',
              background: 'rgba(239,68,68,0.08)', borderRadius: 'var(--radius-sm)',
              border: '1px solid rgba(239,68,68,0.2)' }}>
              {error}
            </div>
          )}

          {logoUrl && (
            <div style={{ marginTop: 12 }}>
              <img src={logoUrl} alt="Generated logo"
                style={{ width: '100%', maxHeight: 300, objectFit: 'contain',
                  borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
                  background: '#fff' /* white bg for logo transparency */ }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <a href={logoUrl} target="_blank" rel="noopener noreferrer"
                  className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}>
                  Open full size ↗
                </a>
                <button
                  className="btn btn-ghost btn-sm" style={{ fontSize: 10 }}
                  onClick={() => { setLogoUrl(''); setError(null); }}>
                  Clear
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Mount `BrandKitLogoGenerator` in `SettingsView.tsx` Branding section**

In `src/web/views/SettingsView.tsx`, add the import:

```typescript
import { BrandKitLogoGenerator } from '../components/settings/BrandKitLogoGenerator';
```

Find the block that renders the `'Branding'` group content (it currently renders palette and font fields from CONFIG_META). After the last field in the Branding form area, mount the logo generator:

```tsx
{activeGroup === 'Branding' && (
  // ... existing branding form fields (brand name, logo URL, colors, fonts) ...
  <BrandKitLogoGenerator />
)}
```

The exact JSX depends on current SettingsView structure. Find the `activeGroup === 'Branding'` branch and append `<BrandKitLogoGenerator />` at the bottom of that branch before the closing tag.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/web/components/settings/BrandKitLogoGenerator.tsx src/web/views/SettingsView.tsx
git commit -m "feat: brand kit logo generator with BYOK ranked providers and Ideogram nudge"
```

---

---

## Task 12: Remotion Reel Builder — programmatic short-form video from content

> **STUB — full plan in separate document: `docs/superpowers/plans/2026-05-xx-remotion-reel-builder.md`**
> Priority: Phase 1 (current sprint). Implement after Tasks 1–11.

**Goal:** Turn any content item (topic + copy + generated images) into a branded 15–60s animated MP4 reel using Remotion — no per-render API cost, full brand-kit integration, instant export.

**Approach:**
- Install `remotion` and `@remotion/renderer` as dev dependencies; render runs server-side via Node.
- Define 3–5 reel templates (Carousel Slide, Quote Card, Product Spotlight, Countdown, Logo Outro) as React components under `src/remotion/templates/`.
- Brand variables (colors, fonts, logo URL) injected from configStore at render time.
- Generated images from Task 2–3 used as per-slide background/hero visuals.
- Backend: `POST /api/render/reel` — accepts `contentId`, `templateId`, `slides[]` → enqueues render → returns job. `GET /api/render/reel/:jobId` — polls status, returns MP4 download URL when done.
- Frontend: `ReelBuilder` component in editor — pick template, preview slide order, kick off render, download MP4.

**Key files to create:**
- `src/remotion/Root.tsx` — Remotion composition registry
- `src/remotion/templates/CarouselSlide.tsx`
- `src/remotion/templates/QuoteCard.tsx`
- `src/remotion/templates/ProductSpotlight.tsx`
- `src/remotion/renderer.ts` — server-side render queue (Node child_process + `renderMedia`)
- `src/web/components/editor/ReelBuilder.tsx` — editor panel
- `src/api/server.ts` — add `/api/render/reel` endpoints

**Dependencies to add:**
```bash
npm install remotion @remotion/renderer @remotion/media-utils
```

**Open questions for the full plan:**
- Output storage: local `public/renders/` vs S3 presigned URL (local first, S3 later)
- Audio: background music track optional field per template
- Resolution: default 1080×1920 (portrait/Reels), 1080×1080 (square/Feed), configurable

---

## Task 13: Multi-platform Distribution — format + publish to LinkedIn, Twitter, Reddit, Instagram, Facebook, ProductHunt

> **STUB — full plan in separate document: `docs/superpowers/plans/2026-05-xx-multi-platform-distribution.md`**
> Priority: Phase 2 (after Generation Engine is complete).

**Goal:** One-click publish of a content item (copy + image + reel) to any combination of connected platforms, formatted to each platform's spec (character limits, aspect ratios, hashtag conventions).

**Platforms in scope:**
| Platform | Auth method | Content types |
|---|---|---|
| LinkedIn | OAuth 2.0 (UGC Posts API) | text post, image post, carousel PDF |
| Twitter / X | OAuth 2.0 (v2 API) | tweet, image tweet, thread |
| Reddit | OAuth 2.0 (submit API) | text post, link post, image post |
| Instagram | Meta Graph API (via existing token) | feed image, carousel, reel |
| Facebook | Meta Graph API | page post, image, reel |
| ProductHunt | GraphQL API | ship post (requires PH token) |

**Approach:**
- `src/services/publishing/` directory — one file per platform, each exports `publish(contentItem, platformConfig)`.
- Platform formatter: per-platform character truncation, hashtag injection, image resizing to platform spec.
- `POST /api/publish` — accepts `contentId` + `platforms[]` → fires all in parallel, returns per-platform status.
- Frontend: `PublishPanel` in editor — platform checkboxes, preview formatted output per platform, publish button, status badges.
- New `publish_jobs` DB table: `(id, content_id, platform, status, external_url, error, published_at)`.

**Key files to create:**
- `src/services/publishing/linkedin.ts`
- `src/services/publishing/twitter.ts`
- `src/services/publishing/reddit.ts`
- `src/services/publishing/instagram.ts`
- `src/services/publishing/facebook.ts`
- `src/services/publishing/product-hunt.ts`
- `src/services/publishing/formatter.ts` — platform-spec formatting
- `src/web/components/editor/PublishPanel.tsx`
- DB migration: `publish_jobs` table

**New configStore keys needed:**
- `LINKEDIN_ACCESS_TOKEN`, `LINKEDIN_PERSON_URN`
- `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET`
- `REDDIT_ACCESS_TOKEN`, `REDDIT_USERNAME`
- `FACEBOOK_PAGE_ACCESS_TOKEN`, `FACEBOOK_PAGE_ID`
- (Instagram already partially in Settings)

---

## Self-Review

### Spec coverage check

| Requirement | Covered by |
|---|---|
| Connect own API keys | Task 1 (configStore), Task 6/7 (UI) |
| Multiple image providers (OpenAI, Google, Stability, fal, Replicate) | Task 2, Task 4, Task 6 |
| Multiple video providers (Runway, HeyGen, Kling/fal) | Tasks 2, 4, 7 — deferred to Phase 3 |
| Set global default provider + model | Task 6/7 (Set default button), Task 8 |
| Override per content piece in editor | Task 9 (GenerationPanel) |
| Generated assets persisted to content | Task 3 (API endpoints write to payload JSONB) |
| Async video with polling | Task 2 (pollVideoJob), Task 9 (startPoll interval) |
| No build/auth required for unset providers | Task 2 (requireKey throws → 400 returned) |
| Logo generator uses any connected image API | Task 11 (BrandKitLogoGenerator) |
| Providers ranked by logo quality, descending | Task 11 (LOGO_PROVIDER_RANKING) |
| Ideogram nudge CTA when fal.ai not connected | Task 11 (nudge banner) |
| Remotion reel builder | Task 12 stub → Phase 1 full plan |
| Multi-platform distribution | Task 13 stub → Phase 2 full plan |

### Priority note (2026-05-03)

**Current sprint (Phase 1):** Tasks 11 (Brand Kit logo gen) + Tasks 1–10 (AI image gen for posts/carousels) + Task 12 (Remotion reel builder).

External API video generation (Tasks 6–7 — Runway, HeyGen, Kling) is fully specced but **deferred to Phase 3**. Plain text carousels without images have declining engagement across all major platforms; image generation + Remotion reels are the higher-impact investment for audience building. API video generation is the right "premium cinematic" tier for a future sprint.

### Gaps found and resolved

- **fal.ai is shared between image and video**: documented in provider catalog `note` field; both managers show same key status — users entering it once gets both.
- **OpenAI uses existing `LLM_API_KEY`**: documented in image provider catalog `note: 'Uses your existing LLM_API_KEY'` — no duplicate key entry needed.
- **Base64 images (Google, Stability)**: returned as `data:image/png;base64,...` — browser renders them fine in `<img src>`, but URLs won't survive beyond the session. Noted for future: add file storage (S3/local) to persist base64 images.
- **fal.ai covers both Ideogram and Flux**: in `LOGO_PROVIDER_RANKING`, both entries use `FAL_API_KEY` — connecting one key makes both rows show "Connected". The rank order (Ideogram #1, Flux #4) means users get the best option auto-selected.
