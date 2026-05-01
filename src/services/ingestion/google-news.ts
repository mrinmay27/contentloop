import type { RawTrend } from "../../domain/types.js";

/**
 * Google News RSS feed — returns real article headlines per niche keyword.
 * Google News exposes RSS feeds at: https://news.google.com/rss/search?q=KEYWORD&hl=en-US&gl=US&ceid=US:en
 * These give much higher quality topics than Google Trends related queries.
 */

import Parser from "rss-parser";

const parser = new Parser();

export async function fetchGoogleNewsTrends(keywords: string[]): Promise<RawTrend[]> {
  const trends: RawTrend[] = [];
  // Use top 3 keywords to avoid rate-limiting
  for (const keyword of keywords.slice(0, 3)) {
    try {
      const query = encodeURIComponent(keyword);
      const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
      const feed = await parser.parseURL(url);

      for (const item of feed.items.slice(0, 8)) {
        if (!item.title) continue;
        // Google News titles often have " - Source" suffix, clean it
        const cleanTitle = item.title.replace(/\s*-\s*[^-]+$/, "").trim();
        if (cleanTitle.length < 15) continue; // Skip tiny fragments

        trends.push({
          source: "google_news",
          title: cleanTitle,
          url: item.link,
          keywords: keywordize(cleanTitle),
          sourcePublishedAt: item.isoDate ? new Date(item.isoDate) : undefined,
          observedAt: new Date(),
          engagementHint: 55 // Higher baseline than Google Trends — these are real articles
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
