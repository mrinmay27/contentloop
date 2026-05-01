/** Ingestion index — wires all sources.
 *  Task 2.0: Uses LLM-generated PageSourceMap (tag-generator) when available.
 *  Task 2.1: Medium (fully wired)
 *  Task 2.2: HackerNews (fully wired)
 *  Task 2.3: Dev.to (new)
 *  Task 2.5: Substack (new)
 *  Task 2.5.2: PubMed (health niches)
 *  Task 2.5.7: Google News with niche-specific queries
 *  Task 2.5.8: Crypto RSS (finance+crypto niches only)
 *  Task 2.6: Exploding Topics (all niches — reel-biased early signals)
 *  Task 2.7: Product Hunt (tech/business niches)
 *  Task 2.8: Finance Newsletter RSS (finance/business/tech)
 *  Falls back to heuristics when no cached source map exists.
 */

import type { Niche, RawTrend } from "../../domain/types.js";
import { classifyNiche, usesCryptoSources } from "../../domain/niche-taxonomy.js";
import { getCachedSourceMap, generateSourceMap } from "./tag-generator.js";
import { fetchArxivTrends } from "./arxiv.js";
import { fetchCryptoTrends } from "./crypto-news.js";
import { fetchDevToTrends } from "./devto.js";
import { fetchExplodingTopicsTrends } from "./exploding-topics.js";
import { fetchFinanceNewsletterTrends } from "./finance-newsletters.js";
import { fetchGoogleNewsTrends } from "./google-news.js";
import { fetchHackerNewsTrends } from "./hackernews.js";
import { fetchMediumTrends } from "./medium.js";
import { fetchProductHuntTrends } from "./product-hunt.js";
import { fetchPubMedTrends } from "./pubmed.js";
import { fetchRedditTrends } from "./reddit.js";
import { fetchRssTrends } from "./rss.js";
import { fetchSubstackTrends } from "./substack.js";


export async function ingestForNiche(niche: Niche, pageId?: string): Promise<RawTrend[]> {
  const category = classifyNiche(niche.name, niche.keywords);

  // ── Try cached LLM source map first (Task 2.0) ──────────────────────────
  // Use the page's cached map if a pageId is provided; else generate fresh.
  let cachedMap = pageId ? getCachedSourceMap(pageId) : null;

  // If no cached map but we have a pageId, kick off async generation (non-blocking)
  if (!cachedMap && pageId) {
    // Fire and forget — will be used on the next ingest run
    generateSourceMap(pageId, niche.name, niche.keywords, false).catch(() => {});
  }

  const subreddits     = cachedMap?.redditSubreddits   ?? deriveSubreddits(niche);
  const rssFeeds       = cachedMap?.rssFeeds.map((f) => f.url) ?? deriveRssFeeds(niche);
  const devtoTags      = cachedMap?.devtoTags          ?? deriveDevToTags(niche);
  const substackSlugs  = cachedMap?.substackSlugs      ?? deriveSubstackSlugs(niche);
  const arxivCategories= cachedMap?.arxivCategories    ?? (
    ["tech", "health", "finance"].includes(category) ? deriveArxivCategories(category) : []
  );

  const isCrypto   = usesCryptoSources(category) &&
    niche.keywords.some((k) => ["crypto", "bitcoin", "ethereum", "defi"].includes(k.toLowerCase()));
  const usePubMed  = ["health", "food"].includes(category);

  const source = cachedMap ? "cached-llm-map" : "heuristics";
  console.log(`[ingest] ${niche.name} | category=${category} | source=${source} | subreddits=${subreddits.length} | rss=${rssFeeds.length}`);

  const results = await Promise.allSettled([
    fetchRedditTrends(subreddits, niche.keywords),
    fetchRssTrends(rssFeeds),
    fetchGoogleNewsTrends(niche.keywords),
    fetchMediumTrends(niche.name, niche.keywords),
    fetchHackerNewsTrends(niche.keywords),
    devtoTags.length     > 0 ? fetchDevToTrends(devtoTags, niche.keywords)        : Promise.resolve([]),
    substackSlugs.length > 0 ? fetchSubstackTrends(substackSlugs, niche.keywords) : Promise.resolve([]),
    arxivCategories.length > 0 ? fetchArxivTrends(category, niche.keywords.slice(0, 3)) : Promise.resolve([]),
    isCrypto  ? fetchCryptoTrends(niche.keywords)                                  : Promise.resolve([]),
    usePubMed ? fetchPubMedTrends(niche.keywords.slice(0, 3))                      : Promise.resolve([]),
    // Task 2.6: Exploding Topics — early-signal reel-biased trends (all niches)
    fetchExplodingTopicsTrends(category, niche.keywords.slice(0, 4)),
    // Task 2.7: Product Hunt — product launches for tech/business niches
    fetchProductHuntTrends(category, niche.keywords),
    // Task 2.8: Finance newsletter RSS — finance/business/tech curated content
    fetchFinanceNewsletterTrends(category, niche.keywords),

  ]);

  const all = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));

  // Source diversity cap — generous, scoring handles quality weighting
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

// ─── Heuristic helpers (fallback when no cached PageSourceMap) ─────────────

function deriveSubreddits(niche: Niche): string[] {
  const kw = niche.keywords.map((k) => k.toLowerCase());

  if (kw.some((k) => ["ai", "chatgpt", "llm", "gpt", "machine learning"].includes(k)))
    return ["ChatGPT", "ArtificialIntelligence", "LocalLLaMA", "singularity", "MachineLearning"];
  if (kw.some((k) => ["crypto", "bitcoin", "ethereum", "defi", "nft"].includes(k)))
    return ["CryptoCurrency", "Bitcoin", "ethfinance", "CryptoMarkets"];
  if (kw.some((k) => ["finance", "investing", "stock", "money", "budget"].includes(k)))
    return ["personalfinance", "financialindependence", "sidehustle", "investing"];
  if (kw.some((k) => ["health", "fitness", "workout", "nutrition", "diet"].includes(k)))
    return ["fitness", "nutrition", "loseit", "running", "weightlifting"];
  if (kw.some((k) => ["marketing", "startup", "entrepreneur", "business"].includes(k)))
    return ["entrepreneur", "startups", "marketing", "smallbusiness"];
  if (kw.some((k) => ["education", "learning", "study", "student", "course"].includes(k)))
    return ["learnprogramming", "GetStudying", "Professors", "AskAcademia"];
  if (kw.some((k) => ["travel", "nomad", "destination", "adventure"].includes(k)))
    return ["travel", "solotravel", "digitalnomad", "backpacking"];
  if (kw.some((k) => ["food", "recipe", "cooking", "meal", "baking"].includes(k)))
    return ["recipes", "Cooking", "MealPrepSunday", "EatCheapAndHealthy"];

  return niche.keywords.filter((k) => k.length > 4).slice(0, 3).map((k) => k.replace(/\s+/g, ""));
}

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

function deriveSubstackSlugs(niche: Niche): string[] {
  const category = classifyNiche(niche.name, niche.keywords);
  const MAP: Record<string, string[]> = {
    tech:          ["importai", "thesequence", "thebatch", "aiweekly"],
    finance:       ["moringabriefing", "financebrief", "thehustle", "chartr"],
    health:        ["hubermanlab", "themetabolicminute"],
    business:      ["thehustle", "morningbrew"],
    lifestyle:     ["jamesclear", "thecoachinglab"],
    education:     ["thedownloadmit"],
    sustainability:["climatetownhall"],
    other:         [],
  };
  return MAP[category] ?? [];
}

function deriveRssFeeds(niche: Niche): string[] {
  const category = classifyNiche(niche.name, niche.keywords);
  const MAP: Record<string, string[]> = {
    tech:     ["https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
               "https://techcrunch.com/category/artificial-intelligence/feed/"],
    finance:  ["https://www.cnbc.com/id/100003114/device/rss/rss.html",
               "https://www.investopedia.com/feedbuilder/feed/getfeed?feedName=rss_headline"],
    health:   ["https://www.medicalnewstoday.com/rss/medical-news-today.xml",
               "https://www.healthline.com/health-news/rss.xml"],
    business: ["https://hbr.org/resources/rss/hbr_topic_leadership_rss.xml",
               "https://feeds.feedburner.com/entrepreneur/latest"],
    education:["https://feeds.feedburner.com/TedTalksHD", "https://edsurge.com/news.rss"],
    travel:   ["https://feeds.feedburner.com/nomadicmatt"],
    food:     ["https://feeds.seriouseats.com/seriouseats/recipes"],
    sustainability: ["https://e360.yale.edu/feed.xml"],
    other:    [],
  };
  return MAP[category] ?? [];
}

function deriveArxivCategories(category: string): string[] {
  const MAP: Record<string, string[]> = {
    tech:    ["cs.AI", "cs.LG"],
    health:  ["q-bio.QM"],
    finance: ["q-fin.GN", "econ.GN"],
  };
  return MAP[category] ?? [];
}

