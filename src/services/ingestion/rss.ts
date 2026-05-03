import Parser from "rss-parser";
import type { RawTrend } from "../../domain/types.js";
import { keywordize } from "./keywordize.js";

const parser = new Parser();

export async function fetchRssTrends(feedUrls: string[]): Promise<RawTrend[]> {
  const trends: RawTrend[] = [];
  for (const feedUrl of feedUrls) {
    try {
      const feed = await parser.parseURL(feedUrl);
      for (const item of feed.items.slice(0, 8)) {
        if (!item.title) continue;
        trends.push({
          source: "rss",
          title: item.title,
          url: item.link,
          keywords: keywordize(item.title),
          sourcePublishedAt: item.isoDate ? new Date(item.isoDate) : undefined,
          observedAt: new Date(),
          engagementHint: 35
        });
      }
    } catch {
      // Source failures should not block the whole ingestion cycle.
    }
  }
  return trends;
}

