import googleTrends from "google-trends-api";
import type { RawTrend } from "../../domain/types.js";

export async function fetchGoogleTrendSignals(keywords: string[]): Promise<RawTrend[]> {
  const trends: RawTrend[] = [];
  for (const keyword of keywords.slice(0, 5)) {
    try {
      const response = await googleTrends.relatedQueries({ keyword, geo: "US" });
      const parsed = JSON.parse(response);
      const ranked = parsed.default?.rankedList?.flatMap((list: any) => list.rankedKeyword ?? []) ?? [];
      for (const item of ranked.slice(0, 5)) {
        trends.push({
          source: "google_trends",
          title: item.query,
          keywords: keywordize(`${keyword} ${item.query}`),
          observedAt: new Date(),
          engagementHint: Math.min(100, Number(item.value ?? 25))
        });
      }
    } catch {
      trends.push({
        source: "google_trends",
        title: `${keyword} trend checklist`,
        keywords: keywordize(keyword),
        observedAt: new Date(),
        engagementHint: 25
      });
    }
  }
  return trends;
}

function keywordize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 8);
}
