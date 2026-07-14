import { cosineSimilarity } from "../domain/similarity.js";
import type { SemanticSignals } from "../domain/scoring.js";
import type { Niche, Topic } from "../domain/types.js";
import {
  composeNicheText,
  composeTopicText,
  selectEmbeddingProvider,
} from "./embeddings.js";
import {
  getNicheEmbedding,
  getTopicEmbeddings,
  listNicheRecentEmbeddings,
  saveNicheEmbedding,
  saveTopicEmbedding,
} from "./embeddingRepo.js";

/** Builds per-topic semantic signals for one score run.
 *
 *  Safety rule (spec §2): only real gemini vectors are persisted or used for
 *  scoring. With no gemini key, on API failure, OR on any DB error here,
 *  this returns whatever signals were built (possibly none) and scoring
 *  stays keyword-only for the rest — the score run itself must never fail
 *  because of the semantic layer. */
export async function buildSemanticContext(
  topics: Topic[],
  niches: Map<string, Niche>
): Promise<Map<string, SemanticSignals>> {
  const signals = new Map<string, SemanticSignals>();
  try {
    const provider = selectEmbeddingProvider();
    if (provider.name !== "gemini" || topics.length === 0) return signals;

    // 1. Ensure niche embeddings (batch the uncached ones in one call).
    //    Note: niche vectors are cached forever — niches are seed-only today.
    //    If a niche-edit path is ever added, it must NULL niches.embedding.
    const nicheVecs = new Map<string, number[]>();
    const uncachedNiches: Array<{ id: string; niche: Niche }> = [];
    for (const [nicheId, niche] of niches) {
      const vec = await getNicheEmbedding(nicheId);
      if (vec) nicheVecs.set(nicheId, vec);
      else uncachedNiches.push({ id: nicheId, niche });
    }
    if (uncachedNiches.length > 0) {
      const embedded = await provider.embedBatch(
        uncachedNiches.map((n) => composeNicheText(n.niche))
      );
      if (embedded) {
        for (let i = 0; i < uncachedNiches.length; i++) {
          nicheVecs.set(uncachedNiches[i].id, embedded[i]);
          await saveNicheEmbedding(uncachedNiches[i].id, embedded[i]);
        }
      }
    }

    // 2. Ensure topic embeddings (batch the uncached ones).
    const cached = await getTopicEmbeddings(topics.map((t) => t.id));
    const uncached = topics.filter((t) => !cached.has(t.id));
    if (uncached.length > 0) {
      const embedded = await provider.embedBatch(uncached.map(composeTopicText));
      if (embedded) {
        for (let i = 0; i < uncached.length; i++) {
          cached.set(uncached[i].id, embedded[i]);
          await saveTopicEmbedding(uncached[i].id, embedded[i]);
        }
      }
    }

    // 3. Recent-topic pools, fetched once per niche (not per topic).
    const recentPools = new Map<string, Array<{ id: string; embedding: number[] }>>();
    for (const nicheId of niches.keys()) {
      recentPools.set(nicheId, await listNicheRecentEmbeddings(nicheId));
    }

    // 4. Per-topic signals from cached vectors only.
    for (const topic of topics) {
      const topicVec = cached.get(topic.id);
      const nicheVec = nicheVecs.get(topic.nicheId);
      if (!topicVec || !nicheVec) continue; // keyword-only for this topic
      const pool = recentPools.get(topic.nicheId) ?? [];
      let maxRecentSimilarity = 0;
      for (const recent of pool) {
        if (recent.id === topic.id) continue; // exclude self in memory
        maxRecentSimilarity = Math.max(
          maxRecentSimilarity,
          cosineSimilarity(topicVec, recent.embedding)
        );
      }
      signals.set(topic.id, {
        nicheSimilarity: cosineSimilarity(topicVec, nicheVec),
        maxRecentSimilarity,
      });
    }
    return signals;
  } catch (err: any) {
    console.warn(`[semantic] context build failed, scoring keyword-only: ${err?.message ?? err}`);
    return signals;
  }
}
