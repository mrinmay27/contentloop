import type { Niche, Page, Topic } from "../domain/types.js";

export function mapNiche(row: any): Niche {
  return {
    id: row.id,
    name: row.name,
    keywords: row.keywords,
    monetizationKeywords: row.monetization_keywords,
    negativeKeywords: row.negative_keywords,
    targetPersona: row.target_persona
  };
}

export function mapPage(row: any): Page {
  return {
    id: row.id,
    nicheId: row.niche_id,
    name: row.name,
    platform: row.platform,
    handle: row.handle,
    brand: row.brand
  };
}

export function mapTopic(row: any): Topic {
  return {
    id: row.id,
    nicheId: row.niche_id,
    title: row.title,
    keywords: row.keywords,
    sources: row.sources,
    sourceCount: Number(row.source_count),
    firstSeenAt: new Date(row.first_seen_at),
    lastSeenAt: new Date(row.last_seen_at),
    velocity: Number(row.velocity),
    score: row.score === null ? null : Number(row.score),
    decision: row.decision,
    state: row.state,
    suggestedFormat: row.suggested_format ?? null,
    formatConfidence: row.format_confidence ?? null,
  };
}
