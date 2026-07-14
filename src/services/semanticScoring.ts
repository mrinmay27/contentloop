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
  listRecentTopicEmbeddings,
  saveNicheEmbedding,
  saveTopicEmbedding,
} from "./embeddingRepo.js";

/** Builds per-topic semantic signals for one score run.
 *
 *  Safety rule (spec §2): only real gemini vectors are persisted or used for
 *  scoring. With no gemini key (or on API failure) this returns an empty map
 *  and scoring stays keyword-only. */
export async function buildSemanticContext(
  topics: Topic[],
  niches: Map<string, Niche>
): Promise<Map<string, SemanticSignals>> {
  const signals = new Map<string, SemanticSignals>();
  const provider = selectEmbeddingProvider();
  if (provider.name !== "gemini" || topics.length === 0) return signals;

  // 1. Ensure niche embeddings.
  const nicheVecs = new Map<string, number[]>();
  for (const [nicheId, niche] of niches) {
    let vec = await getNicheEmbedding(nicheId);
    if (!vec) {
      const embedded = await provider.embedBatch([composeNicheText(niche)]);
      if (!embedded) continue;
      vec = embedded[0];
      await saveNicheEmbedding(nicheId, vec);
    }
    nicheVecs.set(nicheId, vec);
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

  // 3. Per-topic signals from cached vectors only.
  for (const topic of topics) {
    const topicVec = cached.get(topic.id);
    const nicheVec = nicheVecs.get(topic.nicheId);
    if (!topicVec || !nicheVec) continue; // keyword-only for this topic
    const recent = await listRecentTopicEmbeddings(topic.nicheId, topic.id);
    const maxRecentSimilarity = recent.reduce(
      (best, vec) => Math.max(best, cosineSimilarity(topicVec, vec)),
      0
    );
    signals.set(topic.id, {
      nicheSimilarity: cosineSimilarity(topicVec, nicheVec),
      maxRecentSimilarity,
    });
  }
  return signals;
}
