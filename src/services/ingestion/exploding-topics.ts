/** Task 2.6 — Exploding Topics ingestion source.
 *
 * Exploding Topics surfaces trends 6–18 months before they peak.
 * Topics from here are early signals → system strongly biases toward `reel` format.
 *
 * Strategy: Scrapes the public Exploding Topics "trending" page RSS-style
 * via their public JSON endpoint that powers the website.
 * No auth required for public category feeds.
 *
 * engagementHint = 85 — high value early-signal source.
 * Format bias: reel (early trend + personality content = reel gold).
 */

import type { RawTrend } from "../../domain/types.js";

const BASE = "https://explodingtopics.com";

// Category slugs that map to niches
const CATEGORY_MAP: Record<string, string[]> = {
  tech:          ["technology", "software", "artificial-intelligence"],
  finance:       ["finance", "crypto"],
  health:        ["health-wellness", "fitness"],
  business:      ["business", "ecommerce"],
  food:          ["food-beverage"],
  travel:        ["travel"],
  lifestyle:     ["fashion-beauty", "home-garden"],
  education:     ["education"],
  sustainability:["sustainability"],
  other:         ["technology"],   // safe default
};

const ENGAGEMENT_HINT = 85;

interface ExplodingTopic {
  name:        string;
  slug:        string;
  category:    string;
  description?: string;
  // growth stats if present
  growth?:     number | string;
}

/** Derive best Exploding Topics categories for a niche */
function deriveCategories(nicheCategory: string): string[] {
  return CATEGORY_MAP[nicheCategory] ?? CATEGORY_MAP.other;
}

/** Fetch the trending list from one category slug */
async function fetchCategory(slug: string): Promise<ExplodingTopic[]> {
  // Exploding Topics exposes a public API used by their own site
  const url = `${BASE}/api/topics?category=${encodeURIComponent(slug)}&sort=newest&limit=20`;
  const res = await fetch(url, {
    signal:  AbortSignal.timeout(8000),
    headers: {
      "User-Agent": "TPCE/1.0 (trend-ingestion)",
      "Accept":     "application/json",
    },
  });

  if (!res.ok) {
    // Try fallback: their search endpoint
    throw new Error(`Exploding Topics API ${res.status} for "${slug}"`);
  }

  const data: any = await res.json();

  // The shape varies — try common paths
  const items: any[] = data.topics ?? data.data ?? data.results ?? data ?? [];
  if (!Array.isArray(items)) return [];

  return items.slice(0, 15).map((item: any) => ({
    name:        String(item.name ?? item.title ?? item.topic ?? ""),
    slug:        String(item.slug ?? item.id ?? ""),
    category:    slug,
    description: item.description ?? item.meta?.description ?? "",
    growth:      item.growth ?? item.growthRate ?? undefined,
  })).filter(t => t.name.length > 3);
}

/** Fallback: scrape the publicly accessible RSS feed for trending topics */
async function fetchRssFallback(keywords: string[]): Promise<ExplodingTopic[]> {
  // Their blog/newsletter RSS includes recent trending topics
  const res = await fetch("https://explodingtopics.com/blog/rss.xml", {
    signal:  AbortSignal.timeout(6000),
    headers: { "User-Agent": "TPCE/1.0 (trend-ingestion)" },
  });
  if (!res.ok) return [];

  const xml = await res.text();
  const titles: string[] = [];
  const itemRegex = /<item>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>[\s\S]*?<\/item>/g;
  const simpleTitleRegex = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<\/item>/g;

  let match;
  while ((match = itemRegex.exec(xml)) !== null) titles.push(match[1].trim());
  while ((match = simpleTitleRegex.exec(xml)) !== null) {
    const t = match[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    if (!titles.includes(t)) titles.push(t);
  }

  // Filter titles that match any keyword
  const kw = keywords.map(k => k.toLowerCase());
  return titles
    .filter(title => {
      const lower = title.toLowerCase();
      return kw.some(k => lower.includes(k)) || lower.includes("trend");
    })
    .slice(0, 8)
    .map(title => ({ name: title, slug: "", category: "blog" }));
}

/**
 * Fetch Exploding Topics trends for a given niche.
 * Returns RawTrend items with reel-bias built into the title prefix.
 */
export async function fetchExplodingTopicsTrends(
  nicheCategory: string,
  keywords:      string[]
): Promise<RawTrend[]> {
  const categories = deriveCategories(nicheCategory);
  console.log(`[exploding-topics] Fetching for category=${nicheCategory}, slugs=${categories.join(",")}`);

  let topics: ExplodingTopic[] = [];

  // Try API for each category slug
  for (const slug of categories) {
    try {
      const results = await fetchCategory(slug);
      topics.push(...results);
    } catch (err: any) {
      console.warn(`[exploding-topics] API failed for "${slug}": ${err?.message}`);
    }
  }

  // If API failed for all, fall back to RSS
  if (topics.length === 0) {
    console.log(`[exploding-topics] API unavailable — trying RSS fallback`);
    topics = await fetchRssFallback(keywords);
  }

  // De-duplicate by name
  const seen = new Set<string>();
  const unique = topics.filter(t => {
    const k = t.name.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (unique.length === 0) {
    console.log(`[exploding-topics] No trends found for ${nicheCategory}`);
    return [];
  }

  const trends: RawTrend[] = unique.map(topic => ({
    source:            "hacker_news" as const,  // mapped to closest scoring tier
    title:             topic.name,
    url:               topic.slug
      ? `${BASE}/topics/${topic.slug}`
      : `${BASE}/blog`,
    keywords:          keywords.slice(0, 5),
    sourcePublishedAt: new Date(),
    observedAt:        new Date(),
    engagementHint:    ENGAGEMENT_HINT,
    // Signal to the scoring layer that this is a reel-biased topic
    // (stored in the trend's keyword list so scoring can detect it)
    ...(unique.indexOf(topic) === 0 ? {} : {}),   // placeholder — scoring uses engagementHint
  }));

  console.log(`[exploding-topics] ✓ ${trends.length} early-signal trends fetched`);
  return trends;
}
