/**
 * ConfigStore — mutable, persistent config that overlays .env values.
 *
 * Priority: app.config.json (user-set via UI) > .env > defaults
 *
 * All services should call `configStore.get(key)` instead of `env.KEY`
 * for anything user-configurable via the Settings page.
 *
 * The file is saved to ./data/app.config.json relative to the project root.
 */
import fs   from "fs";
import path from "path";
import { env } from "./env.js";

// ─── Config schema ────────────────────────────────────────────────────────────

export type ConfigKey =
  // LLM
  | 'LLM_PROVIDER' | 'LLM_API_KEY' | 'LLM_MODEL' | 'LLM_BASE_URL'
  // Reddit
  | 'REDDIT_CLIENT_ID' | 'REDDIT_CLIENT_SECRET' | 'REDDIT_USER_AGENT'
  // Twitter / X
  | 'TWITTER_BEARER_TOKEN'
  // Instagram
  | 'INSTAGRAM_ACCESS_TOKEN'
  | 'INSTAGRAM_APP_ID' | 'INSTAGRAM_APP_SECRET' | 'INSTAGRAM_REDIRECT_URI'
  // YouTube
  | 'YOUTUBE_API_KEY' | 'YOUTUBE_CHANNEL_ID'
  | 'YOUTUBE_CLIENT_ID' | 'YOUTUBE_CLIENT_SECRET'
  | 'YOUTUBE_ACCESS_TOKEN' | 'YOUTUBE_REFRESH_TOKEN'
  // Product Hunt
  | 'PRODUCT_HUNT_TOKEN'
  // Exploding Topics
  | 'EXPLODING_TOPICS_API_KEY'
  // Canva
  | 'CANVA_CLIENT_ID' | 'CANVA_CLIENT_SECRET' | 'CANVA_REDIRECT_URI'
  // Pipeline
  | 'APPROVAL_REQUIRED' | 'POSTING_DRY_RUN'
  | 'MAX_POSTS_PER_PAGE_PER_DAY' | 'MIN_POST_GAP_HOURS' | 'DEFAULT_TIME_SLOTS'
  | 'DEFAULT_FORMAT';

/** Describes every editable config field */
export type ConfigMeta = {
  label:       string;
  group:       string;
  type:        'text' | 'secret' | 'boolean' | 'number' | 'select' | 'color';
  options?:    string[];
  placeholder?: string;
  required?:   boolean;
};

export const CONFIG_META: Record<ConfigKey, ConfigMeta> = {
  // ── LLM ──────────────────────────────────────────────────────────────────
  LLM_PROVIDER:    { label:'LLM Provider',     group:'AI / LLM', type:'select',
                     options:['groq','openai','openrouter','custom'] },
  LLM_API_KEY:     { label:'LLM API Key',       group:'AI / LLM', type:'secret',
                     placeholder:'sk-…', required:true },
  LLM_MODEL:       { label:'Model Name',        group:'AI / LLM', type:'text',
                     placeholder:'llama3-70b-8192' },
  LLM_BASE_URL:    { label:'Custom Base URL',   group:'AI / LLM', type:'text',
                     placeholder:'https://api.example.com/v1' },
  // ── Reddit ────────────────────────────────────────────────────────────────
  REDDIT_CLIENT_ID:     { label:'Client ID',     group:'Reddit',    type:'text'   },
  REDDIT_CLIENT_SECRET: { label:'Client Secret', group:'Reddit',    type:'secret' },
  REDDIT_USER_AGENT:    { label:'User Agent',    group:'Reddit',    type:'text',
                          placeholder:'MyApp/0.1 by u/yourname' },
  // ── Twitter / X ───────────────────────────────────────────────────────────
  TWITTER_BEARER_TOKEN: { label:'Bearer Token',  group:'Twitter / X', type:'secret' },
  // ── Product Hunt ──────────────────────────────────────────────────────────
  PRODUCT_HUNT_TOKEN: { label:'Developer Token', group:'Product Hunt', type:'secret',
                        placeholder:'ph_…' },
  // ── Exploding Topics ──────────────────────────────────────────────────────
  EXPLODING_TOPICS_API_KEY: { label:'API Key', group:'Exploding Topics', type:'secret',
                               placeholder:'et_…' },
  // ── Instagram ─────────────────────────────────────────────────────────────
  INSTAGRAM_APP_ID:       { label:'Meta App ID',       group:'Instagram', type:'text',
                            placeholder:'123456789012345' },
  INSTAGRAM_APP_SECRET:   { label:'Meta App Secret',   group:'Instagram', type:'secret' },
  INSTAGRAM_REDIRECT_URI: { label:'Redirect URI',      group:'Instagram', type:'text',
                            placeholder:'http://localhost:4000/auth/instagram/callback' },
  INSTAGRAM_ACCESS_TOKEN: { label:'Manual Access Token (optional)', group:'Instagram', type:'secret',
                            placeholder:'Leave empty if using OAuth Connect above' },
  // ── YouTube ───────────────────────────────────────────────────────────────
  YOUTUBE_API_KEY:       { label:'Data API Key',     group:'YouTube', type:'secret',
                           placeholder:'AIza…' },
  YOUTUBE_CHANNEL_ID:    { label:'Channel ID',        group:'YouTube', type:'text',
                           placeholder:'UCxxxxxxxxxxxxxxxxxxxxxxxx' },
  YOUTUBE_CLIENT_ID:     { label:'OAuth Client ID',   group:'YouTube', type:'text',
                           placeholder:'xxxxxx.apps.googleusercontent.com' },
  YOUTUBE_CLIENT_SECRET: { label:'OAuth Client Secret', group:'YouTube', type:'secret' },
  YOUTUBE_ACCESS_TOKEN:  { label:'Access Token',      group:'YouTube', type:'secret',
                           placeholder:'ya29.…' },
  YOUTUBE_REFRESH_TOKEN: { label:'Refresh Token',     group:'YouTube', type:'secret' },
  // ── Canva ─────────────────────────────────────────────────────────────────
  CANVA_CLIENT_ID:     { label:'Client ID',      group:'Canva',     type:'text'   },
  CANVA_CLIENT_SECRET: { label:'Client Secret',  group:'Canva',     type:'secret' },
  CANVA_REDIRECT_URI:  { label:'Redirect URI',   group:'Canva',     type:'text',
                         placeholder:'http://localhost:4000/auth/canva/callback' },
  // ── Pipeline ──────────────────────────────────────────────────────────────
  APPROVAL_REQUIRED:          { label:'Require manual approval', group:'Pipeline', type:'boolean' },
  POSTING_DRY_RUN:            { label:'Dry-run mode (no real posts)', group:'Pipeline', type:'boolean' },
  MAX_POSTS_PER_PAGE_PER_DAY: { label:'Max posts / page / day',  group:'Pipeline', type:'number'  },
  MIN_POST_GAP_HOURS:         { label:'Min gap between posts (h)', group:'Pipeline', type:'number'  },
  DEFAULT_TIME_SLOTS:         { label:'Post times (HH:MM, comma-sep)', group:'Pipeline', type:'text',
                                placeholder:'12:00,17:00,21:00' },
  DEFAULT_FORMAT:             { label:'Default content format',  group:'Pipeline', type:'select',
                                options:['auto', 'post', 'carousel', 'reel'],
                                placeholder:'auto' },
};

// ─── Defaults sourced from env ────────────────────────────────────────────────

const ENV_DEFAULTS: Partial<Record<ConfigKey, string>> = {
  LLM_PROVIDER:              env.LLM_PROVIDER,
  LLM_API_KEY:               env.LLM_API_KEY ?? env.OPENAI_API_KEY ?? '',
  LLM_MODEL:                 env.LLM_MODEL ?? env.OPENAI_MODEL ?? '',
  LLM_BASE_URL:              env.LLM_BASE_URL ?? '',
  REDDIT_CLIENT_ID:          env.REDDIT_CLIENT_ID ?? '',
  REDDIT_CLIENT_SECRET:      env.REDDIT_CLIENT_SECRET ?? '',
  REDDIT_USER_AGENT:         env.REDDIT_USER_AGENT,
  TWITTER_BEARER_TOKEN:      env.TWITTER_BEARER_TOKEN ?? '',
  PRODUCT_HUNT_TOKEN:        process.env.PRODUCT_HUNT_TOKEN ?? '',
  EXPLODING_TOPICS_API_KEY:  process.env.EXPLODING_TOPICS_API_KEY ?? '',
  INSTAGRAM_ACCESS_TOKEN:    env.INSTAGRAM_ACCESS_TOKEN ?? '',
  YOUTUBE_API_KEY:           (process.env.YOUTUBE_API_KEY) ?? '',
  YOUTUBE_CHANNEL_ID:        (process.env.YOUTUBE_CHANNEL_ID) ?? '',
  YOUTUBE_CLIENT_ID:         (process.env.YOUTUBE_CLIENT_ID) ?? '',
  YOUTUBE_CLIENT_SECRET:     (process.env.YOUTUBE_CLIENT_SECRET) ?? '',
  YOUTUBE_ACCESS_TOKEN:      (process.env.YOUTUBE_ACCESS_TOKEN) ?? '',
  YOUTUBE_REFRESH_TOKEN:     (process.env.YOUTUBE_REFRESH_TOKEN) ?? '',
  CANVA_CLIENT_ID:           env.CANVA_CLIENT_ID ?? '',
  CANVA_CLIENT_SECRET:       env.CANVA_CLIENT_SECRET ?? '',
  CANVA_REDIRECT_URI:        env.CANVA_REDIRECT_URI,
  APPROVAL_REQUIRED:         String(env.APPROVAL_REQUIRED),
  POSTING_DRY_RUN:           String(env.POSTING_DRY_RUN),
  MAX_POSTS_PER_PAGE_PER_DAY:String(env.MAX_POSTS_PER_PAGE_PER_DAY),
  MIN_POST_GAP_HOURS:        String(env.MIN_POST_GAP_HOURS),
  DEFAULT_TIME_SLOTS:        env.DEFAULT_TIME_SLOTS,
  DEFAULT_FORMAT:            'auto',
};

// ─── Store class ──────────────────────────────────────────────────────────────

const CONFIG_PATH = path.resolve(
  new URL(".", import.meta.url).pathname,
  "../../data/app.config.json"
);

class ConfigStore {
  private data: Partial<Record<ConfigKey, string>> = {};

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
        this.data = JSON.parse(raw);
      }
    } catch {
      this.data = {};
    }
  }

  private persist() {
    const dir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.data, null, 2), "utf-8");
  }

  /** Get a config value. Priority: user-set file → .env default */
  get(key: ConfigKey): string {
    return this.data[key] ?? ENV_DEFAULTS[key] ?? "";
  }

  getBoolean(key: ConfigKey): boolean {
    const v = this.get(key);
    return v === "true" || v === "1";
  }

  getNumber(key: ConfigKey): number {
    return Number(this.get(key)) || 0;
  }

  /** Set one or many config values and persist */
  set(updates: Partial<Record<ConfigKey, string>>) {
    Object.assign(this.data, updates);
    this.persist();
    // Also update process.env so modules that read env directly pick up changes
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) process.env[k] = v;
    }
  }

  /**
   * Returns the full config for the API response.
   * Secret values are masked — shows last 4 chars only.
   */
  toApiResponse(): Record<ConfigKey, { value: string; masked: boolean }> {
    const SECRETS: ConfigKey[] = [
      "LLM_API_KEY","REDDIT_CLIENT_SECRET","TWITTER_BEARER_TOKEN",
      "PRODUCT_HUNT_TOKEN","EXPLODING_TOPICS_API_KEY",
      "INSTAGRAM_ACCESS_TOKEN","CANVA_CLIENT_SECRET",
      "YOUTUBE_API_KEY","YOUTUBE_CLIENT_SECRET","YOUTUBE_ACCESS_TOKEN","YOUTUBE_REFRESH_TOKEN",
    ];
    const result: any = {};
    for (const key of Object.keys(CONFIG_META) as ConfigKey[]) {
      const raw = this.get(key);
      const isMasked = SECRETS.includes(key) && raw.length > 0;
      result[key] = {
        value:  isMasked ? `${"•".repeat(Math.max(0, raw.length - 4))}${raw.slice(-4)}` : raw,
        masked: isMasked,
      };
    }
    return result;
  }
}

export const configStore = new ConfigStore();
