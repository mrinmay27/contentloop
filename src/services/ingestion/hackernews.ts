import type { RawTrend } from "../../domain/types.js";

/**
 * Hacker News — pulls top and best stories from the HN API.
 * API: https://hacker-news.firebaseio.com/v0/
 * 
 * HN is gold for AI Productivity topics — real tools, real launches,
 * real discussions. For other niches, we filter by keyword relevance.
 */

interface HNItem {
  id: number;
  title?: string;
  url?: string;
  score?: number;
  time?: number;
  type?: string;
}

export async function fetchHackerNewsTrends(nicheKeywords: string[]): Promise<RawTrend[]> {
  const trends: RawTrend[] = [];
  try {
    // Fetch top 30 story IDs
    const topRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
    if (!topRes.ok) return trends;
    const topIds: number[] = await topRes.json();

    // Fetch details for top 30 stories in parallel
    const storyPromises = topIds.slice(0, 30).map(async (id) => {
      try {
        const res = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        if (!res.ok) return null;
        return (await res.json()) as HNItem;
      } catch {
        return null;
      }
    });

    const stories = (await Promise.all(storyPromises)).filter(
      (item): item is HNItem => item !== null && item.type === "story" && !!item.title
    );

    // Filter stories: must match at least ONE niche keyword in the title
    const lowerKeywords = nicheKeywords.map((k) => k.toLowerCase());

    for (const story of stories) {
      const titleLower = (story.title ?? "").toLowerCase();
      // Strict niche-only filter — no generic AI/tech fallback that
      // was bleeding HN topics into every niche regardless of relevance.
      const isRelevant = lowerKeywords.some((keyword) => titleLower.includes(keyword));

      if (!isRelevant) continue;

      trends.push({
        source: "hacker_news",
        title: story.title!,
        url: story.url,
        keywords: keywordize(story.title!),
        sourcePublishedAt: story.time ? new Date(story.time * 1000) : undefined,
        observedAt: new Date(),
        engagementHint: Math.min(100, Math.floor((story.score ?? 10) / 5))
      });
    }
  } catch {
    // Source failures should not block the whole ingestion cycle.
  }
  return trends;
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
