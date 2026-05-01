/** Task 2.5.3 — Pinterest Trends signal.
 *
 * Pinterest Trends surfaces what's visually trending on the platform —
 * critical for fashion, food, travel, home decor, and beauty niches.
 *
 * Strategy: fetch Pinterest's public autocomplete/suggestions endpoint which
 * reflects real-time search trends without requiring OAuth. Results are used
 * as a trend SIGNAL (score boost) rather than standalone content topics.
 *
 * source: "pinterest_trends"
 * engagementHint = 75 — visual trend signal, not content depth
 * Format bias: reel (visual trending content = reel gold)
 */

import type { NicheCategory } from "../../domain/niche-taxonomy.js";
import type { RawTrend } from "../../domain/types.js";

const ENGAGEMENT_HINT = 75;

// Pinterest category IDs that map to niche categories
const CATEGORY_SEEDS: Partial<Record<NicheCategory, string[]>> = {
  food:          ["recipes", "healthy eating", "meal prep", "cooking", "food ideas"],
  travel:        ["travel destinations", "travel photography", "adventure travel", "vacation ideas"],
  creative:      ["fashion trends", "outfit ideas", "beauty tips", "nail art", "home decor"],
  health:        ["fitness motivation", "workout routine", "healthy lifestyle", "yoga", "wellness"],
  lifestyle:     ["self care", "morning routine", "minimalism", "productivity", "motivation"],
  education:     ["study tips", "learning hacks", "skill development"],
  sustainability:["sustainable living", "eco friendly", "zero waste", "green living"],
};

/** Fetch Pinterest trending searches via their public suggestion API */
async function fetchPinterestSuggestions(query: string): Promise<string[]> {
  const url = `https://www.pinterest.com/typeahead/?q=${encodeURIComponent(query)}&scope=boards_and_pins&type=search`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(6000),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; TPCE/1.0; trend-research)",
      "Accept":     "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  if (!res.ok) throw new Error(`Pinterest suggestions ${res.status}`);

  const data: any = await res.json();
  const items: any[] = data?.data?.guides?.results ?? data?.results ?? [];
  return items.map((item: any) => String(item.name ?? item.term ?? item.query ?? "")).filter(s => s.length > 3);
}

/** Fallback: search Pinterest RSS feed for trending topics */
async function fetchPinterestRssFallback(keywords: string[]): Promise<string[]> {
  const kw = keywords[0] ?? "trending";
  const res = await fetch(`https://www.pinterest.com/search/pins/?q=${encodeURIComponent(kw)}&rs=typed`, {
    signal: AbortSignal.timeout(6000),
    headers: { "User-Agent": "TPCE/1.0 trend-research" },
  });
  if (!res.ok) return [];
  const html = await res.text();

  // Extract pin titles from meta tags / JSON-LD in the page
  const titles: string[] = [];
  const titleRegex = /"title"\s*:\s*"([^"]{10,80})"/g;
  let m: RegExpExecArray | null;
  while ((m = titleRegex.exec(html)) !== null) {
    const t = m[1].trim();
    if (!titles.includes(t)) titles.push(t);
  }
  return titles.slice(0, 10);
}

/**
 * Fetch Pinterest trend signals for visual niches.
 * Activates for: food, travel, creative, health, lifestyle, sustainability, education.
 */
export async function fetchPinterestTrends(
  nicheCategory: NicheCategory,
  keywords:      string[]
): Promise<RawTrend[]> {
  const seeds = CATEGORY_SEEDS[nicheCategory];
  if (!seeds) {
    // Not a visual niche — Pinterest trends not relevant
    return [];
  }

  const querySeeds = [...seeds.slice(0, 2), ...keywords.slice(0, 2)];
  console.log(`[pinterest-trends] Fetching for category=${nicheCategory}, seeds=${querySeeds.slice(0,2).join(",")}`);

  let termList: string[] = [];

  for (const seed of querySeeds.slice(0, 2)) {
    try {
      const results = await fetchPinterestSuggestions(seed);
      termList.push(...results.slice(0, 5));
    } catch (err: any) {
      console.warn(`[pinterest-trends] Suggestion fetch failed for "${seed}": ${err?.message}`);
    }
  }

  // Fallback if API blocked
  if (termList.length === 0) {
    try {
      termList = await fetchPinterestRssFallback(keywords);
    } catch {
      // silent
    }
  }

  if (termList.length === 0) {
    console.log(`[pinterest-trends] No trends found for ${nicheCategory}`);
    return [];
  }

  // De-duplicate
  const seen = new Set<string>();
  const unique = termList.filter(t => {
    const k = t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const trends: RawTrend[] = unique.slice(0, 10).map(term => ({
    source:            "pinterest_trends" as const,
    title:             term,
    url:               `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(term)}`,
    keywords:          keywords.slice(0, 5),
    sourcePublishedAt: new Date(),
    observedAt:        new Date(),
    engagementHint:    ENGAGEMENT_HINT,
  }));

  console.log(`[pinterest-trends] ✓ ${trends.length} visual trend signals fetched`);
  return trends;
}
