/** Task 2.0 — LLM Source Tag Generator.
 *
 * When a new Theme Page is created (or user clicks "Refresh Sources"),
 * this makes ONE LLM call to generate a complete source mapping for the
 * niche — making the engine work for ANY niche the user defines.
 *
 * Output is cached in data/page-sources.json keyed by page ID.
 * The ingestion index checks this cache before falling back to
 * heuristic-derived subreddits/feeds.
 */

import fs   from "fs";
import path from "path";
import { llmClient, llmConfig } from "../../config/llm.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PageSourceMap {
  pageId:             string;
  nicheName:          string;
  generatedAt:        string;
  mediumTags:         string[];   // e.g. ['machine-learning', 'chatgpt']
  hackernewsTerms:    string[];   // e.g. ['AI', 'LLM', 'GPT']
  substackSlugs:      string[];   // e.g. ['importai', 'thesequence']
  redditSubreddits:   string[];   // e.g. ['MachineLearning', 'ChatGPT']
  devtoTags:          string[];   // e.g. ['ai', 'machinelearning']
  arxivCategories:    string[];   // e.g. ['cs.AI', 'cs.LG'] — empty if N/A
  rssFeeds: Array<{ name: string; url: string; verified?: boolean }>;
  defaultFormat:      "post" | "carousel" | "reel";
  nicheCategory:      string;
  /** Per-source enable/disable toggles. Absent key = enabled (default on). */
  sourceEnabled?:     Record<string, boolean>;
}

// ─── Cache on disk ────────────────────────────────────────────────────────────

const CACHE_PATH = path.resolve(
  new URL(".", import.meta.url).pathname,
  "../../../data/page-sources.json"
);

function loadCache(): Record<string, PageSourceMap> {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
    }
  } catch {}
  return {};
}

function saveCache(cache: Record<string, PageSourceMap>): void {
  const dir = path.dirname(CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
}

/** Get the cached source map for a page (returns null if none). */
export function getCachedSourceMap(pageId: string): PageSourceMap | null {
  const cache = loadCache();
  return cache[pageId] ?? null;
}

/** Persist a source map for a page. */
export function setCachedSourceMap(pageId: string, map: PageSourceMap): void {
  const cache = loadCache();
  cache[pageId] = map;
  saveCache(cache);
}

/** Delete the cached source map (forces re-generation). */
export function clearSourceMap(pageId: string): void {
  const cache = loadCache();
  delete cache[pageId];
  saveCache(cache);
}

/** Get all cached page IDs. */
export function listCachedPageIds(): string[] {
  return Object.keys(loadCache());
}

// ─── LLM generation ───────────────────────────────────────────────────────────

const PROMPT_SYSTEM = `You are an expert social media content strategist. You will be given a niche name and keywords. Return a JSON source mapping object with no explanation or markdown — JSON only.`;

function buildTagPrompt(
  pageId: string,
  nicheName: string,
  keywords: string[]
): string {
  return JSON.stringify({
    task:     "Generate complete content source mapping for a social media theme page niche.",
    pageId,
    nicheName,
    keywords,
    instruction: [
      "Return the best source mapping for this niche.",
      "Be specific — pick subreddits, Substack newsletters, and RSS feeds that actually exist and are active.",
      "For arxivCategories: only return values if the niche is scientific/academic. Empty array otherwise.",
      "For rssFeeds: return 3-6 real, working RSS URLs relevant to this niche.",
      "For defaultFormat: 'carousel' for educational/how-to niches, 'reel' for trend/entertainment/lifestyle, 'post' for news/business.",
      "For nicheCategory: one of: tech, finance, health, food, travel, business, creative, education, lifestyle, entertainment, sustainability, other.",
    ].join(" "),
    outputShape: {
      mediumTags:       ["string — e.g. 'machine-learning'"],
      hackernewsTerms:  ["string — e.g. 'AI'"],
      substackSlugs:    ["string — newsletter slug from substack.com/[slug]"],
      redditSubreddits: ["string — subreddit name without r/"],
      devtoTags:        ["string — dev.to tag"],
      arxivCategories:  ["string — e.g. 'cs.AI' or empty []"],
      rssFeeds: [{ name: "string", url: "string — full RSS URL" }],
      defaultFormat:    "'post' | 'carousel' | 'reel'",
      nicheCategory:    "string",
    },
  });
}

/** Verify an RSS feed URL is reachable (HEAD request, 5s timeout). */
async function verifyFeed(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "TPCE/1.0 feed-verifier" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Generate (or regenerate) the source map for a page via one LLM call.
 * Verifies each RSS feed URL. Caches result to disk.
 * Falls back to heuristics if LLM is unavailable.
 */
export async function generateSourceMap(
  pageId:    string,
  nicheName: string,
  keywords:  string[],
  forceRefresh = false
): Promise<PageSourceMap> {
  // Return cached if fresh enough (< 7 days) and not forced
  if (!forceRefresh) {
    const cached = getCachedSourceMap(pageId);
    if (cached) {
      const age = Date.now() - new Date(cached.generatedAt).getTime();
      if (age < 7 * 24 * 60 * 60 * 1000) {
        console.log(`[tag-gen] Using cached source map for page ${pageId} (${nicheName})`);
        return cached;
      }
    }
  }

  console.log(`[tag-gen] Generating source map for "${nicheName}" (${pageId})…`);

  let map: PageSourceMap | null = null;

  // ── LLM path ──────────────────────────────────────────────────────────────
  if (llmClient) {
    try {
      const completion = await llmClient.chat.completions.create({
        model: llmConfig.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PROMPT_SYSTEM },
          { role: "user",   content: buildTagPrompt(pageId, nicheName, keywords) },
        ],
      });

      const raw = completion.choices[0]?.message.content ?? null;
      if (raw) {
        const parsed = JSON.parse(raw);

        // Verify RSS feeds concurrently
        const rssFeeds = (parsed.rssFeeds ?? []) as Array<{ name: string; url: string }>;
        const verified = await Promise.all(
          rssFeeds.map(async (feed) => ({
            ...feed,
            verified: await verifyFeed(feed.url),
          }))
        );
        const validFeeds = verified.filter((f) => f.verified !== false);

        map = {
          pageId,
          nicheName,
          generatedAt:      new Date().toISOString(),
          mediumTags:       (parsed.mediumTags        ?? []).map(String),
          hackernewsTerms:  (parsed.hackernewsTerms   ?? []).map(String),
          substackSlugs:    (parsed.substackSlugs     ?? []).map(String),
          redditSubreddits: (parsed.redditSubreddits  ?? []).map(String),
          devtoTags:        (parsed.devtoTags         ?? []).map(String),
          arxivCategories:  (parsed.arxivCategories   ?? []).map(String),
          rssFeeds:         validFeeds,
          defaultFormat:    ["post", "carousel", "reel"].includes(parsed.defaultFormat)
                              ? parsed.defaultFormat : "carousel",
          nicheCategory:    parsed.nicheCategory ?? "other",
        };

        console.log(`[tag-gen] ✓ LLM generated map for "${nicheName}": ${validFeeds.length}/${rssFeeds.length} feeds verified`);
      }
    } catch (err: any) {
      console.error(`[tag-gen] LLM call failed: ${err?.message} — using heuristic fallback`);
    }
  }

  // ── Heuristic fallback (no LLM or error) ──────────────────────────────────
  if (!map) {
    map = buildHeuristicMap(pageId, nicheName, keywords);
    console.log(`[tag-gen] Using heuristic fallback for "${nicheName}"`);
  }

  // Persist to cache
  setCachedSourceMap(pageId, map);
  return map;
}

// ─── Heuristic fallback ───────────────────────────────────────────────────────

function buildHeuristicMap(
  pageId:    string,
  nicheName: string,
  keywords:  string[]
): PageSourceMap {
  const kw = keywords.map((k) => k.toLowerCase());
  const name = nicheName.toLowerCase();
  const text = [name, ...kw].join(" ");

  // Detect category from keywords
  const isTech     = kw.some((k) => ["ai", "software", "code", "developer", "llm", "saas"].includes(k));
  const isFinance  = kw.some((k) => ["finance", "investing", "stock", "money", "crypto", "bitcoin"].includes(k));
  const isHealth   = kw.some((k) => ["health", "fitness", "wellness", "nutrition", "workout"].includes(k));
  const isFood     = kw.some((k) => ["food", "recipe", "cooking", "meal", "baking"].includes(k));
  const isTravel   = kw.some((k) => ["travel", "nomad", "destination", "adventure"].includes(k));
  const isBusiness = kw.some((k) => ["business", "marketing", "entrepreneur", "startup"].includes(k));

  const base: PageSourceMap = {
    pageId,
    nicheName,
    generatedAt:      new Date().toISOString(),
    mediumTags:       keywords.slice(0, 3).map((k) => k.toLowerCase().replace(/\s+/g, "-")),
    hackernewsTerms:  keywords.slice(0, 3),
    substackSlugs:    [],
    redditSubreddits: keywords.filter((k) => k.length > 4).slice(0, 3),
    devtoTags:        isTech ? keywords.slice(0, 3).map((k) => k.toLowerCase()) : [],
    arxivCategories:  [],
    rssFeeds:         [],
    defaultFormat:    "carousel",
    nicheCategory:    "other",
  };

  if (isTech) {
    base.hackernewsTerms  = ["AI", "LLM", "GPT", ...keywords.slice(0, 2)];
    base.substackSlugs    = ["importai", "thesequence", "thebatch"];
    base.redditSubreddits = ["ChatGPT", "ArtificialIntelligence", "MachineLearning", "LocalLLaMA"];
    base.arxivCategories  = ["cs.AI", "cs.LG"];
    base.rssFeeds         = [
      { name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/" },
      { name: "The Verge AI", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml" },
    ];
    base.defaultFormat    = "carousel";
    base.nicheCategory    = "tech";
  } else if (isFinance) {
    base.substackSlugs    = ["moringabriefing", "thehustle", "chartr"];
    base.redditSubreddits = ["personalfinance", "financialindependence", "investing", "sidehustle"];
    base.rssFeeds         = [
      { name: "Investopedia", url: "https://www.investopedia.com/feedbuilder/feed/getfeed?feedName=rss_headline" },
      { name: "CNBC Finance",  url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
    ];
    base.defaultFormat   = "carousel";
    base.nicheCategory   = "finance";
  } else if (isHealth) {
    base.substackSlugs    = ["hubermanlab"];
    base.redditSubreddits = ["fitness", "nutrition", "loseit", "running"];
    base.rssFeeds         = [
      { name: "Healthline", url: "https://www.healthline.com/health-news/rss.xml" },
      { name: "Medical News Today", url: "https://www.medicalnewstoday.com/rss/medical-news-today.xml" },
    ];
    base.arxivCategories  = ["q-bio.QM"];
    base.defaultFormat    = "carousel";
    base.nicheCategory    = "health";
  } else if (isFood) {
    base.redditSubreddits = ["recipes", "Cooking", "MealPrepSunday"];
    base.rssFeeds         = [
      { name: "Serious Eats", url: "https://feeds.seriouseats.com/seriouseats/recipes" },
    ];
    base.defaultFormat    = "carousel";
    base.nicheCategory    = "food";
  } else if (isTravel) {
    base.redditSubreddits = ["travel", "solotravel", "digitalnomad", "backpacking"];
    base.substackSlugs    = [];
    base.rssFeeds         = [
      { name: "Nomadic Matt", url: "https://feeds.feedburner.com/nomadicmatt" },
    ];
    base.defaultFormat    = "reel";
    base.nicheCategory    = "travel";
  } else if (isBusiness) {
    base.substackSlugs    = ["thehustle", "morningbrew"];
    base.redditSubreddits = ["entrepreneur", "startups", "marketing", "smallbusiness"];
    base.rssFeeds         = [
      { name: "HBR", url: "https://hbr.org/resources/rss/hbr_topic_leadership_rss.xml" },
    ];
    base.defaultFormat    = "carousel";
    base.nicheCategory    = "business";
  } else if (/lifestyle|mindset|productivity|self.?help/i.test(text)) {
    base.substackSlugs    = ["jamesclear"];
    base.redditSubreddits = ["selfimprovement", "productivity", "habits"];
    base.defaultFormat    = "reel";
    base.nicheCategory    = "lifestyle";
  }

  return base;
}
