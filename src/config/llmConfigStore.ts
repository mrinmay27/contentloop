/**
 * Multi-LLM Config Store
 *
 * Stores an ordered list of LLM provider configurations.
 * Each entry targets a specific task (scoring | generation | fallback | all).
 * The router picks the best available provider for each task in priority order.
 *
 * Saved to: ./data/llm_configs.json  (no restart needed)
 */
import fs   from "fs";
import path from "path";

// ─── Provider catalog ─────────────────────────────────────────────────────────

export const LLM_PROVIDERS = {
  groq:        { name: 'Groq',            emoji: '⚡', baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile','llama-3.1-8b-instant','llama-3.1-70b-versatile','mixtral-8x7b-32768','gemma2-9b-it','llama3-70b-8192'] },

  openai:      { name: 'OpenAI',          emoji: '🟢', baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o','gpt-4o-mini','gpt-4-turbo','gpt-4','gpt-3.5-turbo'] },

  anthropic:   { name: 'Anthropic Claude',emoji: '🟠', baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-3-5-sonnet-20241022','claude-3-5-haiku-20241022','claude-3-opus-20240229','claude-3-sonnet-20240229','claude-3-haiku-20240307'] },

  gemini:      { name: 'Google Gemini',   emoji: '🔵', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.0-flash','gemini-2.0-flash-lite','gemini-1.5-pro','gemini-1.5-flash','gemini-1.5-flash-8b'] },

  deepseek:    { name: 'DeepSeek',        emoji: '🐋', baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat','deepseek-reasoner'] },

  mistral:     { name: 'Mistral AI',      emoji: '🌬️', baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest','mistral-small-latest','open-mixtral-8x22b','open-mixtral-8x7b','open-mistral-7b'] },

  openrouter:  { name: 'OpenRouter',      emoji: '🔀', baseUrl: 'https://openrouter.ai/api/v1',
    models: ['meta-llama/llama-3.3-70b-instruct:free','google/gemini-flash-1.5:free','mistralai/mixtral-8x7b-instruct:free',
             'anthropic/claude-3.5-sonnet','openai/gpt-4o','deepseek/deepseek-chat'] },

  together:    { name: 'Together AI',     emoji: '🤝', baseUrl: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo','Qwen/Qwen2.5-72B-Instruct-Turbo','deepseek-ai/DeepSeek-V3',
             'mistralai/Mixtral-8x7B-Instruct-v0.1','google/gemma-2-27b-it'] },

  qwen:        { name: 'Qwen (Alibaba)',  emoji: '🟣', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-max','qwen-plus','qwen-turbo','qwen2.5-72b-instruct','qwen2.5-coder-32b-instruct'] },

  minimax:     { name: 'MiniMax',         emoji: '🟡', baseUrl: 'https://api.minimax.chat/v1',
    models: ['abab6.5s-chat','abab5.5-chat','abab6.5g-chat'] },

  huggingface: { name: 'Hugging Face',    emoji: '🤗', baseUrl: 'https://api-inference.huggingface.co/v1',
    models: ['microsoft/Phi-3-mini-4k-instruct','HuggingFaceH4/zephyr-7b-beta','mistralai/Mistral-7B-Instruct-v0.3'] },

  custom:      { name: 'Custom (OpenAI-compat)', emoji: '🔧', baseUrl: '',
    models: [] },
} as const;

export type ProviderKey = keyof typeof LLM_PROVIDERS;

// ─── Task types ───────────────────────────────────────────────────────────────

export type LLMTask = 'scoring' | 'generation' | 'all' | 'fallback';

export const TASK_LABELS: Record<LLMTask, string> = {
  scoring:    'Topic Scoring',
  generation: 'Content Generation',
  all:        'All Tasks',
  fallback:   'Fallback',
};

export const TASK_COLORS: Record<LLMTask, string> = {
  scoring:    'var(--blue)',
  generation: 'var(--green)',
  all:        'var(--accent)',
  fallback:   'var(--text-muted)',
};

// ─── LLM entry type ───────────────────────────────────────────────────────────

export type LLMConfig = {
  id:        string;
  provider:  ProviderKey;
  model:     string;
  apiKey:    string;
  baseUrl?:  string;   // override (used for custom)
  task:      LLMTask;
  priority:  number;   // 1 = highest
  enabled:   boolean;
  label?:    string;   // optional human-readable name
};

// ─── Persistence ──────────────────────────────────────────────────────────────

const CONFIG_PATH = path.resolve(process.cwd(), "data/llm_configs.json");

function load(): LLMConfig[] {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    }
  } catch { /* ignore */ }
  return [];
}

function persist(configs: LLMConfig[]) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(configs, null, 2), "utf-8");
}

// ─── Env seed helper ──────────────────────────────────────────────────────────

/**
 * Build initial entries from .env when data/llm_configs.json doesn't exist yet.
 * Maps LLM_PROVIDER → provider key, reads key + model. Also picks up OPENAI_API_KEY
 * if present. Called only once on first boot (before any user-added configs).
 */
function seedFromEnv(): LLMConfig[] {
  const seed: LLMConfig[] = [];

  // Map env provider names to our catalog keys
  const providerMap: Record<string, ProviderKey> = {
    groq:       'groq',
    openai:     'openai',
    openrouter: 'openrouter',
    anthropic:  'anthropic',
    gemini:     'gemini',
    deepseek:   'deepseek',
    mistral:    'mistral',
    together:   'together',
    qwen:       'qwen',
    minimax:    'minimax',
    huggingface:'huggingface',
    custom:     'custom',
  };

  // Primary from LLM_PROVIDER / LLM_API_KEY / LLM_MODEL
  const provider  = process.env['LLM_PROVIDER'];
  const apiKey    = process.env['LLM_API_KEY']  ?? '';
  const model     = process.env['LLM_MODEL']    ?? '';
  const baseUrl   = process.env['LLM_BASE_URL'];

  const provKey = providerMap[provider ?? ''] ?? null;

  if (provKey && (apiKey || model)) {
    const catalog = LLM_PROVIDERS[provKey];
    seed.push({
      id:       crypto.randomUUID(),
      provider: provKey,
      model:    model || (catalog.models[0] ?? ''),
      apiKey,
      baseUrl:  baseUrl || undefined,
      task:     'all',
      priority: 1,
      enabled:  true,
      label:    `${catalog.name} (from .env)`,
    });
  }

  // Legacy OPENAI_API_KEY — add as second entry only if different from primary
  const oaiKey   = process.env['OPENAI_API_KEY'];
  const oaiModel = process.env['OPENAI_MODEL'] ?? 'gpt-4o-mini';
  if (oaiKey && provKey !== 'openai') {
    seed.push({
      id:       crypto.randomUUID(),
      provider: 'openai',
      model:    oaiModel,
      apiKey:   oaiKey,
      task:     'fallback',
      priority: 2,
      enabled:  true,
      label:    'OpenAI (from .env)',
    });
  }

  return seed;
}

// ─── Store class ──────────────────────────────────────────────────────────────

class LLMConfigStore {
  private configs: LLMConfig[];

  constructor() {
    const saved = load();
    if (saved.length > 0) {
      // Already have user-configured entries
      this.configs = saved;
    } else {
      // First boot — auto-import from .env and persist immediately
      const seeded = seedFromEnv();
      this.configs = seeded;
      if (seeded.length > 0) {
        persist(seeded);
        console.log(`[LLMConfigStore] Auto-seeded ${seeded.length} provider(s) from .env`);
      }
    }
  }

  list(): LLMConfig[] {
    return [...this.configs].sort((a, b) => a.priority - b.priority);
  }

  /** Get the best enabled config for a task */
  forTask(task: LLMTask): LLMConfig | null {
    const ordered = this.list().filter(c => c.enabled);
    // exact task match first, then 'all', then 'fallback'
    return (
      ordered.find(c => c.task === task) ??
      ordered.find(c => c.task === 'all')  ??
      ordered.find(c => c.task === 'fallback') ??
      null
    );
  }

  add(config: Omit<LLMConfig, 'id' | 'priority'>): LLMConfig {
    const maxPriority = this.configs.reduce((m, c) => Math.max(m, c.priority), 0);
    const entry: LLMConfig = { ...config, id: crypto.randomUUID(), priority: maxPriority + 1 };
    this.configs.push(entry);
    persist(this.configs);
    return entry;
  }

  update(id: string, updates: Partial<LLMConfig>): LLMConfig | null {
    const idx = this.configs.findIndex(c => c.id === id);
    if (idx === -1) return null;
    this.configs[idx] = { ...this.configs[idx], ...updates, id };
    persist(this.configs);
    return this.configs[idx];
  }

  remove(id: string): boolean {
    const before = this.configs.length;
    this.configs = this.configs.filter(c => c.id !== id);
    if (this.configs.length !== before) { persist(this.configs); return true; }
    return false;
  }

  reorder(ids: string[]): void {
    ids.forEach((id, i) => {
      const c = this.configs.find(x => x.id === id);
      if (c) c.priority = i + 1;
    });
    persist(this.configs);
  }

  /** Mask API keys for safe API response */
  toApiList(): (Omit<LLMConfig, 'apiKey'> & { apiKeyMasked: string; hasKey: boolean })[] {
    return this.list().map(c => {
      const { apiKey, ...rest } = c;
      return {
        ...rest,
        hasKey:      apiKey.length > 0,
        apiKeyMasked: apiKey.length > 4
          ? `${'•'.repeat(Math.max(0, apiKey.length - 4))}${apiKey.slice(-4)}`
          : apiKey.length > 0 ? '••••' : '',
      };
    });
  }
}

export const llmConfigStore = new LLMConfigStore();
