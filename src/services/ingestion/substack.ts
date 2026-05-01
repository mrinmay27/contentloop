/** Task 2.5 — Substack newsletter RSS ingestion.
 *  Free, no auth. Newsletter slugs come from dynamic niche mapping (config).
 *  Freshness: < 14 days (newsletters are weekly).
 *  Quality weight: engagementHint = 85.
 */

import type { RawTrend } from "../../domain/types.js";

const FRESHNESS_DAYS = 14;

export async function fetchSubstackTrends(
  newsletterSlugs: string[],
  keywords: string[]
): Promise<RawTrend[]> {
  if (newsletterSlugs.length === 0) return [];

  const trends: RawTrend[] = [];
  const keywordLower = keywords.map((k) => k.toLowerCase());

  for (const slug of newsletterSlugs.slice(0, 8)) {
    const feedUrl = `https://${slug}.substack.com/feed`;
    try {
      const res = await fetch(feedUrl, {
        headers: { "User-Agent": "TPCE/1.0 content-research-bot" },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        console.warn(`[substack] HTTP ${res.status} for "${slug}"`);
        continue;
      }

      const xml = await res.text();
      const items = parseRssItems(xml);

      for (const item of items) {
        // Freshness check
        const ageDays = (Date.now() - item.pubDate.getTime()) / 864e5;
        if (ageDays > FRESHNESS_DAYS) continue;

        // Relevance: must match at least one niche keyword in title/description
        const titleLower = item.title.toLowerCase();
        const descLower = item.description.toLowerCase();
        const hasOverlap = keywordLower.some(
          (kw) => titleLower.includes(kw) || descLower.includes(kw)
        );
        if (!hasOverlap && keywordLower.length > 0) continue;

        trends.push({
          source: "substack",
          title: item.title,
          url: item.link,
          keywords: [...keywords.slice(0, 5), slug],
          sourcePublishedAt: item.pubDate,
          observedAt: new Date(),
          engagementHint: 85,
        } as RawTrend & { source: "substack" } as any);
      }
    } catch (err: any) {
      console.error(`[substack] Failed to fetch "${slug}": ${err?.message}`);
    }
  }

  console.log(`[substack] Fetched ${trends.length} articles from ${newsletterSlugs.length} newsletters`);
  return trends;
}

interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: Date;
}

function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = stripCdata(/<title>([\s\S]*?)<\/title>/.exec(block)?.[1] ?? "");
    const link = stripCdata(/<link>([\s\S]*?)<\/link>/.exec(block)?.[1] ?? "");
    const description = stripCdata(/<description>([\s\S]*?)<\/description>/.exec(block)?.[1] ?? "");
    const pubDateStr = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(block)?.[1]?.trim() ?? "";
    const pubDate = pubDateStr ? new Date(pubDateStr) : new Date();

    if (title && (link || pubDateStr)) {
      items.push({ title: title.trim(), link: link.trim(), description: description.trim(), pubDate });
    }
  }

  return items;
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}
