/** Source diversity cap (roadmap Task 2.9).
 *
 *  Scoring is per-topic, so a single prolific feed having a good day could fill
 *  the entire selected queue and crowd out every other source. This runs as a
 *  pass over one scored batch and demotes the weakest excess picks from any
 *  over-represented source to backup — they stay available, they just stop
 *  monopolising the queue.
 *
 *  Only demotes, never promotes: a topic that scoring rejected must not be
 *  resurrected by a diversity rule.
 *
 *  Pure — no service or DB imports.
 */

import type { TopicDecision } from "./types.js";

/** Max topics one source may contribute to a single batch's selected queue. */
export const DEFAULT_MAX_PER_SOURCE = 2;

export interface DiversityCandidate {
  id: string;
  source: string | undefined;
  score: number;
  decision: TopicDecision;
}

export function applySourceDiversityCap<T extends DiversityCandidate>(
  topics: T[],
  maxPerSource: number = DEFAULT_MAX_PER_SOURCE
): T[] {
  // A cap of 0 would silently empty the queue — treat it as "disabled".
  if (!Number.isFinite(maxPerSource) || maxPerSource <= 0) return topics;

  // Rank selected topics per source by score, best first; anything past the
  // cap gets demoted. Non-selected topics are ignored entirely so they neither
  // consume cap slots nor get promoted.
  const demote = new Set<string>();
  const bySource = new Map<string, T[]>();

  for (const topic of topics) {
    if (topic.decision !== "selected") continue;
    const key = topic.source ?? "__unknown__";
    const bucket = bySource.get(key);
    if (bucket) bucket.push(topic);
    else bySource.set(key, [topic]);
  }

  for (const bucket of bySource.values()) {
    if (bucket.length <= maxPerSource) continue;
    [...bucket]
      .sort((a, b) => b.score - a.score)
      .slice(maxPerSource)
      .forEach((topic) => demote.add(topic.id));
  }

  if (demote.size === 0) return topics;
  return topics.map((topic) =>
    demote.has(topic.id) ? { ...topic, decision: "backup" as TopicDecision } : topic
  );
}
