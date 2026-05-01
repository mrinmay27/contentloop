/** Task 2.3 — Dev.to ingestion source.
 *  Free public API, no auth. Best for tech, developer tools, web development.
 *  Quality gate: positive_reactions_count > 100.
 */

import type { RawTrend } from "../../domain/types.js";

const DEVTO_API = "https://dev.to/api/articles";
const QUALITY_THRESHOLD = 100; // minimum reactions

export async function fetchDevToTrends(tags: string[], keywords: string[]): Promise<RawTrend[]> {
  if (tags.length === 0) return [];

  const trends: RawTrend[] = [];
  const keywordLower = keywords.map((k) => k.toLowerCase());

  for (const tag of tags.slice(0, 5)) {
    try {
      const url = `${DEVTO_API}?tag=${encodeURIComponent(tag)}&top=7&per_page=20`;
      const res = await fetch(url, {
        headers: { "User-Agent": "TPCE/1.0 content-research-bot" },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        console.warn(`[devto] HTTP ${res.status} for tag "${tag}"`);
        continue;
      }

      const articles: any[] = await res.json();

      for (const article of articles) {
        if ((article.positive_reactions_count ?? 0) < QUALITY_THRESHOLD) continue;

        const title: string = article.title ?? "";
        const tagList: string[] = article.tag_list ?? [];
        const allKeywords = [...tagList, ...keywords];

        // Relevance check — must overlap with at least one niche keyword
        const titleLower = title.toLowerCase();
        const hasOverlap = keywordLower.some(
          (kw) => titleLower.includes(kw) || tagList.some((t) => t.toLowerCase().includes(kw))
        );
        if (!hasOverlap) continue;

        trends.push({
          source: "devto",
          title,
          url: article.url,
          keywords: allKeywords.slice(0, 10),
          sourcePublishedAt: article.published_at ? new Date(article.published_at) : undefined,
          observedAt: new Date(),
          engagementHint: Math.min(100, Math.round(article.positive_reactions_count / 5)),
        } as RawTrend & { source: "devto" } as any);
      }
    } catch (err: any) {
      console.error(`[devto] Failed to fetch tag "${tag}": ${err?.message}`);
    }
  }

  console.log(`[devto] Fetched ${trends.length} qualifying articles for tags: [${tags.join(", ")}]`);
  return trends;
}
