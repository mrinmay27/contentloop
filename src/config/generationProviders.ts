import { configStore } from "./configStore.js";
import type { ConfigKey } from "./configStore.js";

export type ImageProvider = 'openai' | 'google' | 'stability' | 'fal' | 'replicate' | 'pollinations';

export interface GenerationResult {
  url:      string;
  provider: string;
  model:    string;
}

// Providers that need an API key
const PROVIDER_KEY_MAP: Partial<Record<ImageProvider, ConfigKey>> = {
  openai:    'LLM_API_KEY',
  google:    'GOOGLE_AI_API_KEY',
  stability: 'STABILITY_API_KEY',
  fal:       'FAL_API_KEY',
  replicate: 'REPLICATE_API_TOKEN',
};

// Providers that work without any API key
const FREE_PROVIDERS = new Set<ImageProvider>(['pollinations']);

const DEFAULT_MODELS: Record<ImageProvider, string> = {
  openai:       'dall-e-3',
  google:       'gemini-3-pro-image',
  stability:    'stable-diffusion-3-5-large',
  fal:          'fal-ai/ideogram/v2',
  replicate:    'black-forest-labs/flux-1.1-pro',
  pollinations: 'flux',
};

export function getProviderChain(): Array<{ provider: ImageProvider; model: string }> {
  let priority: string[] = [];
  let modelPrefs: Record<string, string> = {};
  try { priority = JSON.parse(configStore.get('IMAGE_PROVIDER_PRIORITY') || '[]'); } catch {}
  try { modelPrefs = JSON.parse(configStore.get('IMAGE_MODEL_PREFS') || '{}'); } catch {}

  // Always append pollinations at the end if it's not already in the priority list
  if (!priority.includes('pollinations')) priority = [...priority, 'pollinations'];

  return priority
    .filter((p): p is ImageProvider => p in PROVIDER_KEY_MAP || FREE_PROVIDERS.has(p as ImageProvider))
    .filter(p => FREE_PROVIDERS.has(p) || (configStore.get(PROVIDER_KEY_MAP[p]!) ?? '').length > 0)
    .map(p => ({ provider: p, model: modelPrefs[p] || DEFAULT_MODELS[p] }));
}

async function generateOpenAI(prompt: string, model: string): Promise<string> {
  const apiKey = configStore.get('LLM_API_KEY');
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, prompt, n: 1, size: '1024x1024', response_format: 'url' }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`OpenAI image ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  return String(data.data[0].url);
}

async function generateGoogle(prompt: string, model: string): Promise<string> {
  const apiKey = configStore.get('GOOGLE_AI_API_KEY');
  const base   = 'https://generativelanguage.googleapis.com/v1beta/models';

  if (model.startsWith('imagen')) {
    const res = await fetch(`${base}/${model}:predict?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances:  [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio: '1:1' },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Google Imagen ${res.status}: ${await res.text()}`);
    const data: any = await res.json();
    const b64 = data.predictions?.[0]?.bytesBase64Encoded;
    if (!b64) throw new Error('Google Imagen returned no image data');
    return `data:image/png;base64,${b64}`;
  }

  const res = await fetch(`${base}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents:         [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Google Gemini image ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  const parts   = data.candidates?.[0]?.content?.parts ?? [];
  const imgPart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imgPart) throw new Error('Google Gemini returned no image');
  return `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`;
}

async function generateStability(prompt: string, _model: string): Promise<string> {
  const apiKey = configStore.get('STABILITY_API_KEY');
  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('output_format', 'png');
  const res = await fetch('https://api.stability.ai/v2beta/stable-image/generate/sd3', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'image/*' },
    body: formData,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Stability AI ${res.status}: ${await res.text()}`);
  const buffer = await res.arrayBuffer();
  return `data:image/png;base64,${Buffer.from(buffer).toString('base64')}`;
}

async function generateFal(prompt: string, model: string): Promise<string> {
  const apiKey = configStore.get('FAL_API_KEY');
  const res = await fetch(`https://fal.run/${model}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Key ${apiKey}` },
    body: JSON.stringify({ prompt, image_size: 'square_hd' }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`fal.ai ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  const url = data.images?.[0]?.url ?? data.image?.url;
  if (!url) throw new Error('fal.ai returned no image URL');
  return String(url);
}

async function generateReplicate(prompt: string, model: string): Promise<string> {
  const apiKey = configStore.get('REPLICATE_API_TOKEN');
  const createRes = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ input: { prompt } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!createRes.ok) throw new Error(`Replicate ${createRes.status}: ${await createRes.text()}`);
  const { id: predId }: any = await createRes.json();
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const poll: any = await (await fetch(`https://api.replicate.com/v1/predictions/${predId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })).json();
    if (poll.status === 'succeeded') return String(Array.isArray(poll.output) ? poll.output[0] : poll.output);
    if (poll.status === 'failed') throw new Error(`Replicate failed: ${poll.error}`);
  }
  throw new Error('Replicate timed out after 90s');
}

async function generatePollinations(prompt: string, model: string): Promise<string> {
  const seed = Math.floor(Math.random() * 999_999);
  const url  = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
               `?width=1024&height=1024&model=${model}&nologo=true&seed=${seed}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Pollinations ${res.status}`);
  const buffer = await res.arrayBuffer();
  const ct = res.headers.get('content-type') ?? 'image/jpeg';
  return `data:${ct};base64,${Buffer.from(buffer).toString('base64')}`;
}

async function callProvider(prompt: string, provider: ImageProvider, model: string): Promise<string> {
  switch (provider) {
    case 'openai':       return generateOpenAI(prompt, model);
    case 'google':       return generateGoogle(prompt, model);
    case 'stability':    return generateStability(prompt, model);
    case 'fal':          return generateFal(prompt, model);
    case 'replicate':    return generateReplicate(prompt, model);
    case 'pollinations': return generatePollinations(prompt, model);
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}

export async function generateImage(
  prompt:            string,
  providerOverride?: ImageProvider,
  modelOverride?:    string,
): Promise<GenerationResult> {
  if (providerOverride) {
    const model = modelOverride ?? DEFAULT_MODELS[providerOverride] ?? '';
    const url   = await callProvider(prompt, providerOverride, model);
    return { url, provider: providerOverride, model };
  }
  const chain = getProviderChain();
  if (chain.length === 0) {
    throw new Error('No image provider connected. Add an API key in Settings → Image Generation.');
  }
  let lastError: Error = new Error('No providers available');
  for (const { provider, model } of chain) {
    try {
      const url = await callProvider(prompt, provider, model);
      return { url, provider, model };
    } catch (err: any) {
      console.warn(`[generation] ${provider} failed: ${err?.message} — trying next`);
      lastError = err;
    }
  }
  throw lastError;
}
