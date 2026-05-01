import OpenAI from "openai";
import { env } from "./env.js";

/** Provider-specific defaults */
const PROVIDER_DEFAULTS: Record<string, { baseURL: string; model: string }> = {
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile"
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.3-70b-instruct:free"
  },
  openai: {
    baseURL: "https://api.openai.com/v1",
    model: env.OPENAI_MODEL
  }
};

function resolveLLMConfig() {
  const provider = env.LLM_PROVIDER;
  const defaults = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.groq;

  const apiKey = env.LLM_API_KEY || env.OPENAI_API_KEY || "";
  const baseURL = env.LLM_BASE_URL || defaults.baseURL;
  const model = env.LLM_MODEL || defaults.model;

  return { apiKey, baseURL, model, provider };
}

export const llmConfig = resolveLLMConfig();

export const llmClient = llmConfig.apiKey
  ? new OpenAI({ apiKey: llmConfig.apiKey, baseURL: llmConfig.baseURL })
  : null;
