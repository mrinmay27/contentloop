import { classifyNiche } from "../../domain/niche-taxonomy.js";
import {
  GOOGLE_NEWS_QUERIES, RSS_FEEDS, SUBREDDITS, SUBSTACK_SLUGS, MEDIUM_TAGS, HN_KEYWORDS,
} from "./niche-queries.js";

export interface EffectiveField { values: string[]; isDefault: boolean }

/** An empty/absent override means "use the built-in default" — the Sources UI
 *  shows that default dimmed so a user can see what is actually being used
 *  (U1 spec §2: everything a user can see, a user can edit). */
export function effectiveValue(override: string[] | undefined, fallback: string[]): EffectiveField {
  if (override && override.length > 0) return { values: override, isDefault: false };
  return { values: fallback, isDefault: true };
}

/** Per-mapField effective values for a niche, mirroring what ingestForNiche
 *  actually resolves. Keys match SOURCE_REGISTRY configFields' mapField. */
export function buildEffectiveSources(
  nicheName: string,
  nicheKeywords: string[],
  map: Record<string, any> | null,
  financeDefaults: string[],
  cryptoDefaults: string[]
): Record<string, EffectiveField> {
  const category = classifyNiche(nicheName, nicheKeywords);
  const rssOverride = (map?.rssFeeds ?? []).map((f: any) => f?.url ?? f).filter(Boolean);
  return {
    redditSubreddits: effectiveValue(map?.redditSubreddits, SUBREDDITS[category] ?? []),
    rssFeeds: effectiveValue(rssOverride, RSS_FEEDS[category] ?? []),
    googleNewsQueries: effectiveValue(map?.googleNewsQueries, GOOGLE_NEWS_QUERIES[category] ?? []),
    mediumTags: effectiveValue(map?.mediumTags, MEDIUM_TAGS[category] ?? []),
    hackernewsTerms: effectiveValue(map?.hackernewsTerms, HN_KEYWORDS[category] ?? []),
    substackSlugs: effectiveValue(map?.substackSlugs, SUBSTACK_SLUGS[category] ?? []),
    financeFeeds: effectiveValue(map?.financeFeeds, financeDefaults),
    cryptoFeeds: effectiveValue(map?.cryptoFeeds, cryptoDefaults),
  };
}
