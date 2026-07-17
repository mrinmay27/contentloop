/** Static manifest of every ingestion source — drives the Sources settings
 *  UI generically. Adding a source = adapter + one entry here (a test
 *  enforces registry/dispatch parity). `mapField` names refer to
 *  PageSourceMap keys (tag-generator.ts). */

export interface SourceConfigField {
  mapField: string;              // PageSourceMap key holding the config
  label: string;                 // UI label
  kind: "strings" | "feeds";     // chip list vs URL list (validated)
  placeholder?: string;
}

export interface SourceMeta {
  id: string;                    // must match isEnabled("<id>") in index.ts
  label: string;
  description: string;
  configFields: SourceConfigField[];
  needsKey?: { env: string; label: string };
}

export const SOURCE_REGISTRY: SourceMeta[] = [
  { id: "reddit", label: "Reddit", description: "Hot posts from niche subreddits.",
    configFields: [{ mapField: "redditSubreddits", label: "Subreddits", kind: "strings", placeholder: "MachineLearning" }] },
  { id: "rss", label: "Custom RSS", description: "Any RSS/Atom feeds you add.",
    configFields: [{ mapField: "rssFeeds", label: "Feeds", kind: "feeds", placeholder: "https://example.com/feed.xml" }] },
  { id: "google_news", label: "Google News", description: "News search phrases (intent-specific, not raw keywords).",
    configFields: [{ mapField: "googleNewsQueries", label: "Search phrases", kind: "strings", placeholder: "personal finance tips" }] },
  { id: "medium", label: "Medium", description: "Tag feeds on Medium.",
    configFields: [{ mapField: "mediumTags", label: "Tags", kind: "strings", placeholder: "machine-learning" }] },
  { id: "hacker_news", label: "Hacker News", description: "Front-page stories matching your terms.",
    configFields: [{ mapField: "hackernewsTerms", label: "Match terms", kind: "strings", placeholder: "LLM" }] },
  { id: "devto", label: "Dev.to", description: "Tag feeds on dev.to (tech niches).",
    configFields: [{ mapField: "devtoTags", label: "Tags", kind: "strings", placeholder: "ai" }] },
  { id: "substack", label: "Substack", description: "Public Substack publications.",
    configFields: [{ mapField: "substackSlugs", label: "Publication slugs", kind: "strings", placeholder: "importai" }] },
  { id: "arxiv", label: "arXiv", description: "Research papers by category (STEM niches).",
    configFields: [{ mapField: "arxivCategories", label: "Categories", kind: "strings", placeholder: "cs.AI" }] },
  { id: "crypto_news", label: "Crypto News", description: "Crypto RSS (CoinDesk, Decrypt, … or your own).",
    configFields: [{ mapField: "cryptoFeeds", label: "Feeds (empty = defaults)", kind: "feeds" }] },
  { id: "pubmed", label: "PubMed", description: "Medical research (health/food niches).", configFields: [] },
  { id: "exploding_topics", label: "Exploding Topics", description: "Early trend signals.",
    configFields: [], needsKey: { env: "EXPLODING_TOPICS_API_KEY", label: "Exploding Topics Pro API key" } },
  { id: "product_hunt", label: "Product Hunt", description: "Product launches.",
    configFields: [], needsKey: { env: "PRODUCT_HUNT_TOKEN", label: "Product Hunt token (optional, raises limits)" } },
  { id: "finance_newsletter", label: "Finance Newsletters", description: "Business/finance RSS (CNBC, … or your own).",
    configFields: [{ mapField: "financeFeeds", label: "Feeds (empty = defaults)", kind: "feeds" }] },
  { id: "youtube_trends", label: "YouTube Trends", description: "Trending videos.",
    configFields: [], needsKey: { env: "YOUTUBE_API_KEY", label: "YouTube Data API key" } },
];
