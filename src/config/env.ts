import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default("postgres://theme:theme@localhost:55432/theme_engine"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  // LLM provider config — supports OpenAI, Groq, OpenRouter, or any OpenAI-compatible API
  LLM_PROVIDER: z.enum(["openai", "groq", "openrouter", "custom"]).default("groq"),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
  LLM_BASE_URL: z.string().optional(),
  // Legacy fallback
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  APPROVAL_REQUIRED: z.coerce.boolean().default(true),
  POSTING_DRY_RUN: z.coerce.boolean().default(true),
  DEFAULT_TIME_SLOTS: z.string().default("12:00,17:00,21:00"),
  MIN_POST_GAP_HOURS: z.coerce.number().default(3),
  MAX_POSTS_PER_PAGE_PER_DAY: z.coerce.number().default(3),
  REDDIT_CLIENT_ID: z.string().optional(),
  REDDIT_CLIENT_SECRET: z.string().optional(),
  REDDIT_USER_AGENT: z.string().default("theme-page-content-engine/0.1"),
  TWITTER_BEARER_TOKEN: z.string().optional(),
  INSTAGRAM_ACCESS_TOKEN: z.string().optional(),
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  CANVA_CLIENT_ID:     z.string().optional(),
  CANVA_CLIENT_SECRET: z.string().optional(),
  CANVA_REDIRECT_URI:  z.string().default('http://localhost:4000/auth/canva/callback'),
  // Media pipeline — TTS, stock footage, BGM
  TTS_VOICE:           z.string().default('en-US-AriaNeural'),
  TTS_RATE:            z.string().default('+5%'),
  PEXELS_API_KEY:      z.string().optional(),
  BGM_MODE:            z.enum(['random', 'none']).default('random'),
  BGM_VOLUME:          z.coerce.number().default(0.15),
});

export const env = envSchema.parse(process.env);

export const timeSlots = env.DEFAULT_TIME_SLOTS.split(",")
  .map((slot) => slot.trim())
  .filter(Boolean);
