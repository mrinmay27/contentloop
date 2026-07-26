#!/usr/bin/env node
/**
 * Model-staleness checker.
 *
 * Providers retire model IDs quietly, and a stale ID in our catalog only
 * surfaces as a 404 the first time a user actually generates something. This
 * compares every model we advertise against each provider's live /models
 * endpoint.
 *
 *   node scripts/check-models.mjs
 *
 * Uses whatever keys are already configured in data/llm_configs.json (read
 * only — it lists models, it never generates). OpenRouter's catalog is public,
 * so that one is always checked. Providers with no key are reported as skipped
 * rather than silently passing.
 *
 * Exits non-zero if anything is stale, so CI can gate on it.
 */
import { readFileSync, existsSync } from 'node:fs';

const CATALOG = '../dist/src/config/llmConfigStore.js';
const { LLM_PROVIDERS } = await import(CATALOG).catch(() => {
  console.error('Run `npm run build` first — this reads the compiled catalog.');
  process.exit(2);
});

const cfgPath = 'data/llm_configs.json';
const cfgs = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : [];
const keyFor = (p) => cfgs.find((c) => c.provider === p && c.apiKey)?.apiKey;

/** provider -> how to list its models. null key means "needs a key we lack". */
const LISTERS = {
  groq:       (k) => k && ['https://api.groq.com/openai/v1/models', { Authorization: `Bearer ${k}` }],
  openai:     (k) => k && ['https://api.openai.com/v1/models',      { Authorization: `Bearer ${k}` }],
  deepseek:   (k) => k && ['https://api.deepseek.com/models',       { Authorization: `Bearer ${k}` }],
  mistral:    (k) => k && ['https://api.mistral.ai/v1/models',      { Authorization: `Bearer ${k}` }],
  together:   (k) => k && ['https://api.together.xyz/v1/models',    { Authorization: `Bearer ${k}` }],
  gemini:     (k) => k && [`https://generativelanguage.googleapis.com/v1beta/models?key=${k}`, {}],
  anthropic:  (k) => k && ['https://api.anthropic.com/v1/models',   { 'x-api-key': k, 'anthropic-version': '2023-06-01' }],
  openrouter: ()  => ['https://openrouter.ai/api/v1/models', {}],   // public
};

async function liveIds(url, headers) {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  return new Set((d.data ?? d.models ?? []).map((m) => String(m.id ?? m.name ?? '').replace(/^models\//, '')));
}

let stale = 0, checked = 0;
const skipped = [];

for (const [provider, def] of Object.entries(LLM_PROVIDERS)) {
  const target = LISTERS[provider]?.(keyFor(provider));
  if (!target) { skipped.push(provider); continue; }
  let ids;
  try { ids = await liveIds(...target); }
  catch (err) { console.log(`\n${provider}: could not check (${err.message})`); continue; }

  checked++;
  const bad = def.models.filter((m) => !ids.has(m));
  if (bad.length === 0) {
    console.log(`\n✓ ${def.name}  — ${def.models.length}/${def.models.length} valid (${ids.size} live)`);
  } else {
    stale += bad.length;
    console.log(`\n✗ ${def.name}  — ${bad.length} STALE of ${def.models.length}`);
    for (const m of bad) console.log(`    ${m}`);
  }
}

if (skipped.length) console.log(`\nskipped (no API key configured): ${skipped.join(', ')}`);
console.log(`\n${checked} provider(s) checked, ${stale} stale model id(s).`);
if (stale > 0) {
  console.log('Update src/config/llmConfigStore.ts AND src/web/components/settings/LLMManager.tsx (the catalog is duplicated).');
  process.exit(1);
}
