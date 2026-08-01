/**
 * Centralized source-query maps per niche category.
 *
 * Every source that accepts free-form queries (Google News, HackerNews, Reddit)
 * must use intent-specific phrases from this file — NOT raw niche keywords.
 *
 * WHY: Raw keywords are semantically ambiguous in a news/search context.
 *   "budget"  → Google News returns government budget bills, airline budget news, etc.
 *   "personal finance tips" → returns budgeting guides, saving advice, investing how-tos.
 * The distinction is search INTENT, not the keyword itself.
 */

import type { NicheCategory } from "../../domain/niche-taxonomy.js";

// ─── Google News ──────────────────────────────────────────────────────────────
// Compound, intent-specific phrases. Top 3 are used (google-news.ts limit).
// Designed so every phrase unambiguously resolves to the niche's content type.

export const GOOGLE_NEWS_QUERIES: Record<NicheCategory, string[]> = {
  finance: [
    "personal finance tips saving",
    "how to invest for beginners",
    "passive income ideas 2025",
    "debt payoff strategies budgeting",
    "retirement planning personal savings",
  ],
  tech: [
    "AI tools developer productivity",
    "machine learning open source tutorial",
    "software engineering best practices",
    "developer tools new release",
    "tech startup founder advice",
  ],
  health: [
    "fitness workout tips beginners",
    "mental health self care advice",
    "nutrition healthy eating guide",
    "sleep improvement wellness habits",
    "home exercise routine results",
  ],
  food: [
    "easy healthy dinner recipes home",
    "meal prep ideas week beginners",
    "cooking tips techniques kitchen",
    "quick budget friendly recipes",
    "baking guide for beginners",
  ],
  travel: [
    "budget travel tips destinations",
    "solo travel guide safety advice",
    "travel hacks save money packing",
    "digital nomad remote work lifestyle",
    "hidden gem travel destinations 2025",
  ],
  business: [
    "startup growth strategies founders",
    "digital marketing tips small business",
    "content marketing guide ROI",
    "entrepreneurship lessons success",
    "leadership skills management guide",
  ],
  creative: [
    "graphic design tips tutorial beginners",
    "photography techniques composition guide",
    "fashion style inspiration outfit ideas",
    "illustration digital art workflow",
    "UX design principles product",
  ],
  education: [
    "online learning tips study techniques",
    "career skill development guide",
    "how to learn faster retention",
    "free online courses certification",
    "self study discipline strategies",
  ],
  lifestyle: [
    "morning routine productivity habits",
    "self improvement mindset daily habits",
    "minimalism simple living benefits",
    "work life balance tips remote",
    "personal development book lessons",
  ],
  entertainment: [
    "best new games releases 2025",
    "streaming shows worth watching",
    "movie reviews must watch list",
    "music album reviews new releases",
    "sports highlights analysis",
  ],
  sustainability: [
    "sustainable living tips home guide",
    "renewable energy solar home setup",
    "zero waste eco friendly lifestyle",
    "climate action individual impact",
    "green products sustainable alternatives",
  ],
  other: [],
};

// ─── Medium ───────────────────────────────────────────────────────────────────
// Medium tag slugs — author-curated so tag search is high-precision.
// Slug format: lowercase, hyphen-separated (matches medium.com/tag/<slug>).

export const MEDIUM_TAGS: Record<NicheCategory, string[]> = {
  finance:       ["personal-finance", "investing", "money", "financial-independence", "budgeting", "side-hustle"],
  tech:          ["software-engineering", "programming", "machine-learning", "artificial-intelligence", "developer-tools"],
  health:        ["health", "mental-health", "fitness", "wellness", "nutrition"],
  food:          ["food", "cooking", "recipes", "healthy-eating", "meal-prep"],
  travel:        ["travel", "digital-nomad", "travel-tips", "adventure", "backpacking"],
  business:      ["entrepreneurship", "startup", "marketing", "business", "leadership"],
  creative:      ["design", "photography", "art", "fashion", "ux-design"],
  education:     ["education", "learning", "productivity", "career-development", "self-improvement"],
  lifestyle:     ["self-improvement", "productivity", "mindset", "habits", "personal-development"],
  entertainment: ["gaming", "movies", "music", "pop-culture", "sports"],
  sustainability:["sustainability", "climate-change", "environment", "renewable-energy", "eco-friendly"],
  other:         ["technology", "culture", "society"],
};

// ─── HackerNews ───────────────────────────────────────────────────────────────
// HN has a specific audience (technical founders, engineers, researchers).
// These are terms that ACTUALLY appear in HN story titles for each niche —
// more precise than raw niche keywords which cause false positives.

export const HN_KEYWORDS: Record<NicheCategory, string[]> = {
  finance:       ["investing", "financial independence", "index fund", "fintech", "retirement", "tax", "401k", "frugal"],
  tech:          ["open source", "machine learning", "llm", "programming", "developer", "software", "ai", "github", "startup"],
  health:        ["longevity", "sleep", "nutrition", "mental health", "medicine", "research", "exercise", "microbiome"],
  food:          ["fermentation", "food science", "nutrition", "recipe", "cooking"],
  travel:        ["remote work", "digital nomad", "relocation", "visa", "geography"],
  business:      ["startup", "saas", "entrepreneur", "marketing", "growth", "fundraising", "product"],
  creative:      ["design", "typography", "ux", "photography", "illustration", "open source design"],
  education:     ["education", "learning", "curriculum", "teaching", "university", "course"],
  lifestyle:     ["productivity", "habits", "focus", "minimalism", "stoicism", "routine"],
  entertainment: ["game", "indie game", "gaming", "film", "animation"],
  sustainability:["climate", "renewable energy", "solar", "electric vehicle", "carbon", "sustainability"],
  other:         [],
};

// ─── Reddit subreddits ────────────────────────────────────────────────────────
// Category-first mapping — more reliable than keyword heuristics in index.ts.
// All subreddits verified as active communities.

export const SUBREDDITS: Record<NicheCategory, string[]> = {
  finance:       ["personalfinance", "financialindependence", "investing", "Frugal", "povertyfinance"],
  tech:          ["programming", "webdev", "MachineLearning", "learnprogramming", "devops"],
  health:        ["fitness", "nutrition", "loseit", "bodyweightfitness", "mentalhealth"],
  food:          ["recipes", "Cooking", "MealPrepSunday", "EatCheapAndHealthy", "AskCulinary"],
  travel:        ["travel", "solotravel", "digitalnomad", "backpacking", "TravelHacks"],
  business:      ["entrepreneur", "startups", "marketing", "smallbusiness", "growthhacking"],
  creative:      ["graphic_design", "photography", "ArtFundamentals", "illustration", "web_design"],
  education:     ["GetStudying", "AskAcademia", "OnlineLearning", "selfimprovement", "learnprogramming"],
  lifestyle:     ["selfimprovement", "minimalism", "getdisciplined", "productivity", "habits"],
  entertainment: ["gaming", "movies", "television", "Music", "sports"],
  sustainability:["ZeroWaste", "Sustainability", "RenewableEnergy", "environment", "ClimateActionPlan"],
  other:         [],
};

// ─── RSS feeds ────────────────────────────────────────────────────────────────
// Niche-specific RSS feeds — replaced the old heuristic which mapped
// finance → CNBC Markets (news-event feed, wrong intent for personal finance).
// Finance now maps to personal-finance blogs and tools (Investopedia, NerdWallet).

// All URLs verified live on 2026-05-03. 403/404 sources removed and replaced.
export const RSS_FEEDS: Record<NicheCategory, string[]> = {
  finance: [
    "https://www.nerdwallet.com/blog/feed/",
    "https://www.wisebread.com/feed",                  // personal finance blog
    "https://www.cnbc.com/id/10001147/device/rss/rss.html", // CNBC Personal Finance
    // removed: mrmoneymustache.com (403), investopedia personal-finance page (403)
  ],
  tech: [
    "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    "https://techcrunch.com/category/artificial-intelligence/feed/",
    "https://hnrss.org/frontpage",
  ],
  health: [
    "https://feeds.npr.org/1128/rss.xml",              // NPR Health
    // removed: healthline.com (403), medicalnewstoday.com (403)
  ],
  food: [
    "https://www.budgetbytes.com/feed/",
    "https://cookieandkate.com/feed/",
    "https://pinchofyum.com/feed",
    // removed: seriouseats.com (connection refused)
  ],
  travel: [
    "https://www.adventurouskate.com/feed/",
    "https://www.adventurouskate.com/feed/",         // travel blog
    // removed: nomadicmatt feedburner (404)
  ],
  business: [
    "https://feeds.feedburner.com/entrepreneur/latest",
    "https://www.fastcompany.com/latest/rss",
    // removed: hbr.org (403)
  ],
  creative: [
    "https://feeds.feedburner.com/CreativeBloq",
    "https://www.smashingmagazine.com/feed/",
  ],
  education: [
    "https://feeds.feedburner.com/TedTalksHD",
    "https://www.edsurge.com/articles_rss",
  ],
  lifestyle: [
    "https://jamesclear.com/feed",
    "https://www.becomingminimalist.com/feed/",
    // removed: zenhabits.net (404)
  ],
  entertainment: [
    "https://www.polygon.com/rss/index.xml",
    "https://kotaku.com/rss",
    "https://www.rockpapershotgun.com/feed",
    // removed: ign.com (403)
  ],
  sustainability: [
    "https://e360.yale.edu/feed.xml",
    "https://www.theguardian.com/environment/rss",
  ],
  other: [],
};

// ─── Substack newsletters ─────────────────────────────────────────────────────
// Slugs are verified against known active Substack publications.
// Format: slug only — URL is constructed as https://{slug}.substack.com/feed

export const SUBSTACK_SLUGS: Record<NicheCategory, string[]> = {
  finance:       ["chartr", "financebrief", "milkroad"],
  tech:          ["importai", "thesequence", "aiweekly"],
  health:        ["hubermanlab", "themetabolicminute"],
  food:          [],
  travel:        [],
  business:      ["thehustle", "growthhackers"],
  creative:      [],
  education:     ["thedownloadmit"],
  lifestyle:     ["thecoachinglab"],
  entertainment: [],
  sustainability:["climatetownhall"],
  other:         [],
};

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Word-boundary-aware keyword matching.
 * Short keywords (≤3 chars, e.g. "ai", "ml") use \b word boundaries so
 * "ai" doesn't match "airline" or "air". Longer keywords use substring match
 * since they're specific enough not to generate false positives.
 */
export function matchesKeyword(text: string, keyword: string): boolean {
  if (keyword.length <= 3) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  }
  return text.toLowerCase().includes(keyword.toLowerCase());
}
