import Parser from "rss-parser";
import type { RawTrend } from "../../domain/types.js";

/**
 * Medium tag feeds — pulls trending articles from Medium by topic tag.
 * Medium exposes RSS feeds at: https://medium.com/feed/tag/TAGNAME
 * These give high-quality, long-form content ideas perfect for carousels.
 */

const parser = new Parser();

/** Map niche names to relevant Medium tags */
const NICHE_MEDIUM_TAGS: Record<string, string[]> = {
  "AI Productivity": [
    "artificial-intelligence",
    "chatgpt",
    "productivity",
    "automation",
    "ai-tools"
  ],
  "Personal Finance": [
    "personal-finance",
    "investing",
    "money",
    "budgeting",
    "side-hustle"
  ]
};

export async function fetchMediumTrends(nicheName: string, nicheKeywords: string[]): Promise<RawTrend[]> {
  const tags = NICHE_MEDIUM_TAGS[nicheName] ?? nicheKeywords.slice(0, 3).map((k) => k.toLowerCase().replace(/\s+/g, "-"));
  const trends: RawTrend[] = [];

  for (const tag of tags.slice(0, 4)) {
    try {
      const url = `https://medium.com/feed/tag/${tag}`;
      const feed = await parser.parseURL(url);

      for (const item of feed.items.slice(0, 6)) {
        if (!item.title) continue;
        const title = item.title.trim();
        if (title.length < 15) continue;

        // Extract snippet from content if available
        const snippet = item.contentSnippet?.slice(0, 200) ?? "";

        trends.push({
          source: "medium",
          title,
          url: item.link,
          keywords: keywordize(`${tag} ${title} ${snippet}`),
          sourcePublishedAt: item.isoDate ? new Date(item.isoDate) : undefined,
          observedAt: new Date(),
          engagementHint: 50 // Medium articles are well-written, content-worthy topics
        });
      }
    } catch {
      // Source failures should not block the whole ingestion cycle.
    }
  }
  return deduplicateByTitle(trends);
}

function keywordize(input: string): string[] {
  return [
    ...new Set(
      input
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 3)
    )
  ].slice(0, 10);
}

function deduplicateByTitle(trends: RawTrend[]): RawTrend[] {
  const seen = new Set<string>();
  return trends.filter((trend) => {
    const key = trend.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
