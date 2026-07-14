import { llmConfigStore } from "../config/llmConfigStore.js";
import type { Niche, Topic } from "../domain/types.js";

/** Embedding providers. ONLY real gemini vectors are ever persisted or used
 *  for scoring decisions; the fallback exists so the cosine/blend machinery
 *  stays unit-testable offline (spec §2 safety rule). */

export interface EmbeddingProvider {
  readonly name: "gemini" | "fallback";
  /** Unit-length vectors, one per input text, or null on failure. */
  embedBatch(texts: string[]): Promise<number[][] | null>;
}

export function composeTopicText(topic: Pick<Topic, "title" | "keywords">): string {
  return `${topic.title}. ${topic.keywords.join(", ")}`;
}

export function composeNicheText(niche: Pick<Niche, "name" | "targetPersona" | "keywords">): string {
  return `${niche.name}. ${niche.targetPersona}. ${niche.keywords.join(", ")}`;
}

export function unitNormalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

interface GeminiBatchResponse {
  embeddings?: Array<{ values?: number[] }>;
}

export function parseGeminiBatchResponse(json: GeminiBatchResponse): number[][] | null {
  if (!Array.isArray(json.embeddings)) return null;
  const out: number[][] = [];
  for (const e of json.embeddings) {
    if (!Array.isArray(e.values) || e.values.length === 0) return null;
    out.push(unitNormalize(e.values));
  }
  return out;
}

const GEMINI_MODEL = "gemini-embedding-001";
const GEMINI_BATCH_LIMIT = 100;

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "gemini" as const;
  constructor(private readonly apiKey: string) {}

  async embedBatch(texts: string[]): Promise<number[][] | null> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += GEMINI_BATCH_LIMIT) {
      const chunk = texts.slice(i, i + GEMINI_BATCH_LIMIT);
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:batchEmbedContents?key=${this.apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requests: chunk.map((text) => ({
                model: `models/${GEMINI_MODEL}`,
                content: { parts: [{ text }] },
              })),
            }),
          }
        );
        if (!res.ok) {
          console.warn(`[embed] gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
          return null;
        }
        const parsed = parseGeminiBatchResponse(await res.json());
        if (!parsed || parsed.length !== chunk.length) return null;
        out.push(...parsed);
      } catch (err: any) {
        console.warn(`[embed] gemini fetch error: ${err?.message}`);
        return null;
      }
    }
    return out;
  }
}

/** Deterministic token-hash embedding (128-dim). Tests only — never persisted. */
export class FallbackHashEmbedder implements EmbeddingProvider {
  readonly name = "fallback" as const;

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vec = new Array(128).fill(0);
      const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      for (const token of tokens) {
        let h = 0x811c9dc5;
        for (let i = 0; i < token.length; i++) {
          h ^= token.charCodeAt(i);
          h = Math.imul(h, 0x01000193);
        }
        vec[(h >>> 0) % 128] += 1;
      }
      return unitNormalize(vec);
    });
  }
}

/** Gemini when an enabled gemini config with a key exists, else fallback. */
export function selectEmbeddingProvider(): EmbeddingProvider {
  const gemini = llmConfigStore.list().find(
    (c) => c.provider === "gemini" && c.enabled && c.apiKey
  );
  if (gemini) return new GeminiEmbeddingProvider(gemini.apiKey);
  return new FallbackHashEmbedder();
}
