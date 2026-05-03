/** Ingestion index — wires all sources.
 *  Task 2.0: Uses LLM-generated PageSourceMap (tag-generator) when available.
 *  Task 2.1: Medium  Task 2.2: HackerNews  Task 2.3: Dev.to  Task 2.5: Substack
 *  Task 2.5.2: PubMed  Task 2.5.4: YouTube Trending
 *  Task 2.5.7: Google News  Task 2.5.8: Crypto RSS
 *  Task 2.6: Exploding Topics  Task 2.7: Product Hunt  Task 2.8: Finance Newsletters
 *  Per-source enable/disable respected via PageSourceMap.sourceEnabled.
 *
 *  Source query strategy is centralised in niche-queries.ts.
 *  Sources receive intent-specific phrases, not raw niche keywords, to prevent
 *  ambiguous matches (e.g. "budget" → government bills instead of personal finance).
 */

import type { Niche, RawTrend } from "../../domain/types.js";
import { classifyNiche, usesCryptoSources } from "../../domain/niche-taxonomy.js";
import { getCachedSourceMap, generateSourceMap } from "./tag-generator.js";
import {
  GOOGLE_NEWS_QUERIES,
  HN_KEYWORDS,
  SUBREDDITS,
  RSS_FEEDS,
  SUBSTACK_SLUGS,
} from "./niche-queries.js";
import { fetchArxivTrends }            from "./arxiv.js";
import { fetchCryptoTrends }           from "./crypto-news.js";
import { fetchDevToTrends }            from "./devto.js";
import { fetchExplodingTopicsTrends }  from "./exploding-topics.js";
import { fetchFinanceNewsletterTrends } from "./finance-newsletters.js";
import { fetchGoogleNewsTrends }       from "./google-news.js";
import { fetchHackerNewsTrends }       from "./hackernews.js";
import { fetchMediumTrends }           from "./medium.js";
import { fetchProductHuntTrends }      from "./product-hunt.js";
import { fetchPubMedTrends }           from "./pubmed.js";
import { fetchRedditTrends }           from "./reddit.js";
import { fetchRssTrends }              from "./rss.js";
import { fetchSubstackTrends }         from "./substack.js";
import { fetchYouTubeTrends }          from "./youtube-trends.js";


export async function ingestForNiche(niche: Niche, pageId?: string): Promise<RawTrend[]> {
  const category = classifyNiche(niche.name, niche.keywords);

  // ── Try cached LLM source map first (Task 2.0) ──────────────────────────
  let cachedMap = pageId ? getCachedSourceMap(pageId) : null;

  if (!cachedMap && pageId) {
    // Fire-and-forget — will be ready for the next ingest run
    generateSourceMap(pageId, niche.name, niche.keywords, false).catch(() => {});
  }

  // ── Source query derivation ──────────────────────────────────────────────
  // Precedence: cached LLM map → centralized niche-queries maps → keyword fallback

  // Google News: use intent-specific compound phrases, never raw niche keywords
  const googleNewsQueries = GOOGLE_NEWS_QUERIES[category] ?? [];

  // HackerNews: merge niche-specific HN terms with user-defined keywords so
  // custom niches (e.g. "Crypto Trading") retain their specific signals
  const hnKeywords = [...new Set([...(HN_KEYWORDS[category] ?? []), ...niche.keywords])];

  // Reddit: category-first; LLM map overrides if available
  const subreddits = cachedMap?.redditSubreddits ?? SUBREDDITS[category] ?? [];

  // RSS: category-first; LLM map overrides if available
  const rssFeeds = cachedMap?.rssFeeds.map((f) => f.url) ?? RSS_FEEDS[category] ?? [];

  // Dev.to tags: tech-only by design
  const devtoTags = cachedMap?.devtoTags ?? deriveDevToTags(niche);

  // Substack: category-first; LLM map overrides if available
  const substackSlugs = cachedMap?.substackSlugs ?? SUBSTACK_SLUGS[category] ?? [];

  // arXiv categories: STEM niches only
  const arxivCategories = cachedMap?.arxivCategories ??
    (["tech", "health", "finance"].includes(category) ? deriveArxivCategories(category) : []);

  const isCrypto = usesCryptoSources(category) &&
    niche.keywords.some((k) => ["crypto", "bitcoin", "ethereum", "defi"].includes(k.toLowerCase()));
  const usePubMed = ["health", "food"].includes(category);

  const source  = cachedMap ? "cached-llm-map" : "niche-queries";
  const enabled = cachedMap?.sourceEnabled ?? {};
  const isEnabled = (src: string) => enabled[src] !== false;

  console.log(
    `[ingest] ${niche.name} | category=${category} | source=${source} | ` +
    `gnQueries=${googleNewsQueries.length} | subreddits=${subreddits.length} | rss=${rssFeeds.length}`
  );

  const results = await Promise.allSettled([
    isEnabled("reddit")             ? fetchRedditTrends(subreddits, niche.keywords)                      : Promise.resolve([]),
    isEnabled("rss")                ? fetchRssTrends(rssFeeds)                                           : Promise.resolve([]),
    isEnabled("google_news")        ? fetchGoogleNewsTrends(googleNewsQueries)                           : Promise.resolve([]),
    isEnabled("medium")             ? fetchMediumTrends(niche.name, niche.keywords)                      : Promise.resolve([]),
    isEnabled("hacker_news")        ? fetchHackerNewsTrends(hnKeywords)                                  : Promise.resolve([]),
    isEnabled("devto")              && devtoTags.length > 0
      ? fetchDevToTrends(devtoTags, niche.keywords)                                                      : Promise.resolve([]),
    isEnabled("substack")           && substackSlugs.length > 0
      ? fetchSubstackTrends(substackSlugs, niche.keywords)                                               : Promise.resolve([]),
    isEnabled("arxiv")              && arxivCategories.length > 0
      ? fetchArxivTrends(category, niche.keywords.slice(0, 3))                                           : Promise.resolve([]),
    isEnabled("crypto_news")        && isCrypto
      ? fetchCryptoTrends(niche.keywords)                                                                : Promise.resolve([]),
    isEnabled("pubmed")             && usePubMed
      ? fetchPubMedTrends(niche.keywords.slice(0, 3))                                                    : Promise.resolve([]),
    isEnabled("exploding_topics")   ? fetchExplodingTopicsTrends(category, niche.keywords.slice(0, 4))  : Promise.resolve([]),
    isEnabled("product_hunt")       ? fetchProductHuntTrends(category, niche.keywords)                  : Promise.resolve([]),
    isEnabled("finance_newsletter") ? fetchFinanceNewsletterTrends(category, niche.keywords)            : Promise.resolve([]),
    isEnabled("youtube_trends")     ? fetchYouTubeTrends(category as any, niche.keywords)               : Promise.resolve([]),
  ]);

  const all = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  // Source diversity cap — generous per source; scoring handles quality weighting
  const sourceCounts: Record<string, number> = {};
  const deduplicated: RawTrend[] = [];
  const MAX_PER_SOURCE = 8;

  for (const trend of all) {
    const src = trend.source;
    sourceCounts[src] = (sourceCounts[src] ?? 0) + 1;
    if (sourceCounts[src] <= MAX_PER_SOURCE) deduplicated.push(trend);
  }

  const finalCounts: Record<string, number> = {};
  for (const t of deduplicated) finalCounts[t.source] = (finalCounts[t.source] ?? 0) + 1;
  console.log(`[ingest] ${niche.name}: ${deduplicated.length} topics → ${JSON.stringify(finalCounts)}`);

  return deduplicated;
}

// ─── Remaining heuristic helpers ─────────────────────────────────────────────
// Reddit, RSS, and Substack are now driven by niche-queries.ts maps above.
// Only Dev.to and arXiv still use inline logic (they have non-trivial derivation).

function deriveDevToTags(niche: Niche): string[] {
  const kw = niche.keywords.map((k) => k.toLowerCase());
  const category = classifyNiche(niche.name, niche.keywords);
  if (category !== "tech") return [];
  const tagMap: Record<string, string> = {
    ai: "ai", "machine learning": "machinelearning", chatgpt: "chatgpt",
    python: "python", javascript: "javascript", webdev: "webdev",
    productivity: "productivity", software: "software", llm: "llm",
  };
  return [...new Set(kw.flatMap((k) => tagMap[k] ? [tagMap[k]] : []))].slice(0, 5);
}

function deriveArxivCategories(category: string): string[] {
  const MAP: Record<string, string[]> = {
    tech:    ["cs.AI", "cs.LG"],
    health:  ["q-bio.QM"],
    finance: ["q-fin.GN", "econ.GN"],
  };
  return MAP[category] ?? [];
}
