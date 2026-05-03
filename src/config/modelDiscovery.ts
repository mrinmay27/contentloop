/**
 * modelDiscovery.ts — Universal AI provider capability registry
 *
 * Probes each AI provider's API to discover what models are available
 * for the specific subscription tier. Results are cached in
 * data/discovered_models.json and used to populate model selectors.
 *
 * This file is pure — it does NOT import configStore or llmConfigStore.
 * All API keys are received as parameters.
 */
import fs   from 'fs';
import path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiscoveredModel {
  id:           string;
  label:        string;
  description?: string;
  context?:     number;    // for text models
  recommended?: boolean;
}

export interface DiscoveredCapabilities {
  text:      DiscoveredModel[];
  image:     DiscoveredModel[];
  video:     DiscoveredModel[];
  probed_at: string;
  status:    'ok' | 'error';
  error?:    string;
}

export type CapabilitiesMap = Record<string, DiscoveredCapabilities>;

// ─── Cache path ───────────────────────────────────────────────────────────────

const CACHE_PATH = path.resolve(process.cwd(), 'data/discovered_models.json');

// ─── Cache helpers ────────────────────────────────────────────────────────────

export function loadCapabilities(): CapabilitiesMap {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {};
}

export function saveCapabilities(data: CapabilitiesMap): void {
  const dir = path.dirname(CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function updateCapability(providerId: string, caps: DiscoveredCapabilities): void {
  const all = loadCapabilities();
  all[providerId] = caps;
  saveCapabilities(all);
}

// ─── Probe helpers ────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function okCaps(text: DiscoveredModel[], image: DiscoveredModel[], video: DiscoveredModel[]): DiscoveredCapabilities {
  return { text, image, video, probed_at: now(), status: 'ok' };
}

// ─── Provider probes ──────────────────────────────────────────────────────────

async function probeOpenAI(apiKey: string): Promise<DiscoveredCapabilities> {
  const r = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`OpenAI models API ${r.status}: ${await r.text()}`);
  const data: any = await r.json();
  const models: any[] = data.data ?? [];

  const textModels = models
    .filter((m: any) => /^(gpt-|o1|o3)/i.test(m.id) && !/-instruct/.test(m.id))
    .sort((a: any, b: any) => b.id.localeCompare(a.id))
    .map((m: any): DiscoveredModel => ({
      id:          m.id,
      label:       m.id,
      recommended: m.id === 'gpt-4o',
    }));

  const imageModels = models
    .filter((m: any) => /^(dall-e|gpt-image)/i.test(m.id))
    .map((m: any): DiscoveredModel => ({
      id:          m.id,
      label:       m.id,
      recommended: m.id === 'dall-e-3',
    }));

  return okCaps(textModels, imageModels, []);
}

async function probeAnthropic(apiKey: string): Promise<DiscoveredCapabilities> {
  const r = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key':        apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`Anthropic models API ${r.status}: ${await r.text()}`);
  const data: any = await r.json();
  const models: any[] = data.data ?? [];

  const textModels = models
    .sort((a: any, b: any) => b.id.localeCompare(a.id))
    .map((m: any): DiscoveredModel => ({
      id:          m.id,
      label:       m.display_name ?? m.id,
      recommended: /claude-(sonnet|opus)-4|claude-3-5-sonnet/.test(m.id),
    }));

  return okCaps(textModels, [], []);
}

async function probeGoogle(apiKey: string): Promise<DiscoveredCapabilities> {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=200`,
    { signal: AbortSignal.timeout(12_000) }
  );
  if (!r.ok) throw new Error(`Google models API ${r.status}: ${await r.text()}`);
  const data: any = await r.json();
  const rawModels: any[] = data.models ?? [];

  const textModels:  DiscoveredModel[] = [];
  const imageModels: DiscoveredModel[] = [];
  const videoModels: DiscoveredModel[] = [];

  for (const m of rawModels) {
    const id    = (m.name as string).replace('models/', '');
    const label = m.displayName ?? id;
    const methods: string[] = m.supportedGenerationMethods ?? [];

    if (/veo/i.test(id)) {
      videoModels.push({ id, label, recommended: /veo-2/i.test(id) });
    } else if (
      /imagen|image-generation|flash.*image|image.*flash/i.test(id) &&
      methods.some((x) => x === 'generateContent' || x === 'predict')
    ) {
      imageModels.push({
        id,
        label,
        description: m.description ?? '',
        recommended: id === 'imagen-3.0-generate-001' || id === 'gemini-2.0-flash-preview-image-generation',
      });
    } else if (/gemini/i.test(id) && methods.includes('generateContent')) {
      textModels.push({
        id,
        label,
        recommended: id === 'gemini-2.0-flash',
      });
    }
  }

  // Sort image: imagen-3.0-generate first, then imagen-3.0-fast, then rest
  imageModels.sort((a, b) => {
    const rank = (id: string) => {
      if (/imagen-3\.0-generate/.test(id)) return 0;
      if (/imagen-3\.0-fast/.test(id))     return 1;
      if (/imagen/.test(id))               return 2;
      return 3;
    };
    return rank(a.id) - rank(b.id);
  });

  return okCaps(textModels, imageModels, videoModels);
}

function probeFal(apiKey: string): DiscoveredCapabilities {
  if (apiKey.length < 10) throw new Error('fal.ai API key appears invalid (too short)');
  const imageModels: DiscoveredModel[] = [
    { id: 'fal-ai/ideogram/v2',        label: 'Ideogram v2',        recommended: true  },
    { id: 'fal-ai/ideogram/v2/turbo',  label: 'Ideogram v2 Turbo',  recommended: false },
    { id: 'fal-ai/flux/pro',           label: 'Flux Pro',           recommended: false },
    { id: 'fal-ai/flux/dev',           label: 'Flux Dev',           recommended: false },
    { id: 'fal-ai/flux/schnell',       label: 'Flux Schnell',       recommended: false },
  ];
  const videoModels: DiscoveredModel[] = [
    { id: 'fal-ai/kling-video/v1.6/standard/text-to-video', label: 'Kling v1.6',      recommended: true  },
    { id: 'fal-ai/wan-t2v-1.3b',                            label: 'WAN T2V',         recommended: false },
    { id: 'fal-ai/hunyuan-video',                           label: 'HunyuanVideo',    recommended: false },
    { id: 'fal-ai/minimax/video-01',                        label: 'MiniMax Video',   recommended: false },
  ];
  return okCaps([], imageModels, videoModels);
}

async function probeStability(apiKey: string): Promise<DiscoveredCapabilities> {
  const r = await fetch('https://api.stability.ai/v1/user/account', {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (r.status === 401 || r.status === 403) throw new Error(`Stability AI: invalid API key (${r.status})`);
  if (!r.ok) throw new Error(`Stability AI account check failed: ${r.status}`);

  const imageModels: DiscoveredModel[] = [
    { id: 'stable-diffusion-3-5-large',     label: 'Stable Diffusion 3.5 Large', recommended: true  },
    { id: 'stable-diffusion-3-medium',      label: 'Stable Diffusion 3 Medium',  recommended: false },
    { id: 'stable-image/generate/ultra',    label: 'Stable Image Ultra',         recommended: false },
  ];
  return okCaps([], imageModels, []);
}

async function probeReplicate(apiKey: string): Promise<DiscoveredCapabilities> {
  const r = await fetch('https://api.replicate.com/v1/account', {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`Replicate account check failed: ${r.status}`);

  const imageModels: DiscoveredModel[] = [
    { id: 'black-forest-labs/flux-1.1-pro',       label: 'Flux 1.1 Pro',       recommended: true  },
    { id: 'black-forest-labs/flux-1.1-pro-ultra',  label: 'Flux 1.1 Pro Ultra', recommended: false },
    { id: 'ideogram-ai/ideogram-v2',               label: 'Ideogram v2',        recommended: false },
  ];
  const videoModels: DiscoveredModel[] = [
    { id: 'minimax/video-01',          label: 'MiniMax Video-01',      recommended: true  },
    { id: 'wan-video/wan2.1-t2v',      label: 'WAN 2.1 Text-to-Video', recommended: false },
  ];
  return okCaps([], imageModels, videoModels);
}

async function probeRunway(apiKey: string): Promise<DiscoveredCapabilities> {
  const r = await fetch('https://api.dev.runwayml.com/v1/organization', {
    headers: {
      Authorization:     `Bearer ${apiKey}`,
      'X-Runway-Version': '2024-11-06',
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`Runway API check failed: ${r.status}`);

  const videoModels: DiscoveredModel[] = [
    { id: 'gen4_turbo',   label: 'Gen-4 Turbo',        recommended: true  },
    { id: 'gen3a_turbo',  label: 'Gen-3 Alpha Turbo',  recommended: false },
  ];
  return okCaps([], [], videoModels);
}

function probeHeygen(apiKey: string): DiscoveredCapabilities {
  if (apiKey.length < 5) throw new Error('HeyGen API key appears invalid (too short)');
  const videoModels: DiscoveredModel[] = [
    { id: 'avatar_video',     label: 'HeyGen Avatar Video', recommended: true  },
    { id: 'screen_recording', label: 'Screen Recording',    recommended: false },
  ];
  return okCaps([], [], videoModels);
}

// ─── OpenAI-compat fallback ───────────────────────────────────────────────────

async function probeOpenAICompat(apiKey: string, baseUrl: string): Promise<DiscoveredCapabilities> {
  const r = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`${baseUrl}/models responded with ${r.status}`);
  const body: any = await r.json();
  const models: any[] = body.data ?? body.models ?? [];

  const textModels: DiscoveredModel[] = models.map((m: any, i: number): DiscoveredModel => ({
    id:          m.id ?? String(m),
    label:       m.id ?? String(m),
    recommended: i === 0,
  }));

  return okCaps(textModels, [], []);
}

// ─── Custom provider ──────────────────────────────────────────────────────────

async function probeCustom(apiKey: string, baseUrl?: string): Promise<DiscoveredCapabilities> {
  if (!baseUrl) return okCaps([], [], []);
  return probeOpenAICompat(apiKey, baseUrl);
}

// ─── OpenAI-compat provider base URLs ─────────────────────────────────────────

const COMPAT_BASE_URLS: Record<string, string> = {
  groq:       'https://api.groq.com/openai/v1',
  deepseek:   'https://api.deepseek.com/v1',
  mistral:    'https://api.mistral.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  together:   'https://api.together.xyz/v1',
  qwen:       'https://dashscope.aliyuncs.com/compatible-mode/v1',
};

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Probes the given provider's API with the supplied key to discover
 * available models. Results are cached to data/discovered_models.json.
 *
 * @param providerId - The provider identifier (e.g. 'openai', 'google', 'fal')
 * @param apiKey     - The raw (unmasked) API key
 * @param baseUrl    - Optional base URL override (used for custom/compat providers)
 */
export async function probeProvider(
  providerId: string,
  apiKey:     string,
  baseUrl?:   string,
): Promise<DiscoveredCapabilities> {
  try {
    let caps: DiscoveredCapabilities;

    switch (providerId) {
      case 'openai':
        caps = await probeOpenAI(apiKey);
        break;
      case 'anthropic':
        caps = await probeAnthropic(apiKey);
        break;
      case 'google':
      case 'gemini':
        caps = await probeGoogle(apiKey);
        break;
      case 'fal':
        caps = probeFal(apiKey);
        break;
      case 'stability':
        caps = await probeStability(apiKey);
        break;
      case 'replicate':
        caps = await probeReplicate(apiKey);
        break;
      case 'runway':
        caps = await probeRunway(apiKey);
        break;
      case 'heygen':
        caps = probeHeygen(apiKey);
        break;
      case 'custom':
        caps = await probeCustom(apiKey, baseUrl);
        break;
      default: {
        // OpenAI-compatible providers
        const compatUrl = baseUrl ?? COMPAT_BASE_URLS[providerId];
        if (compatUrl) {
          caps = await probeOpenAICompat(apiKey, compatUrl);
        } else {
          caps = okCaps([], [], []);
        }
        break;
      }
    }

    updateCapability(providerId, caps);
    return caps;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const errorCaps: DiscoveredCapabilities = {
      text:      [],
      image:     [],
      video:     [],
      probed_at: now(),
      status:    'error',
      error:     message,
    };
    return errorCaps;
  }
}
