import Parser from "rss-parser";
import type { RawTrend } from "../../domain/types.js";
import { classifyNiche } from "../../domain/niche-taxonomy.js";
import { keywordize } from "./keywordize.js";
import { MEDIUM_TAGS } from "./niche-queries.js";

/**
 * Medium tag feeds — pulls trending articles from Medium by topic tag.
 * Medium exposes RSS feeds at: https://medium.com/feed/tag/TAGNAME
 * Tags are author-curated, so tag-based search is high-precision for niches.
 * All 11 niche categories are mapped via MEDIUM_TAGS in niche-queries.ts.
 */

const parser = new Parser();

export async function fetchMediumTrends(nicheName: string, nicheKeywords: string[]): Promise<RawTrend[]> {
  const category = classifyNiche(nicheName, nicheKeywords);
  const tags = MEDIUM_TAGS[category] ?? nicheKeywords.slice(0, 3).map((k) => k.toLowerCase().replace(/\s+/g, "-"));
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

function deduplicateByTitle(trends: RawTrend[]): RawTrend[] {
  const seen = new Set<string>();
  return trends.filter((trend) => {
    const key = trend.title.toLowerCase().slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
