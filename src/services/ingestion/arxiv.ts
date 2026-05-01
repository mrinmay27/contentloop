/** Task 2.4 — arXiv Abstracts ingestion.
 *  Free API, no auth. Best for AI/ML/Science/Finance niches.
 *  Each abstract → carousel topic: "What this research means for you"
 */

import type { RawTrend } from "../../domain/types.js";

const ARXIV_API = "https://export.arxiv.org/api/query";
const MAX_RESULTS = 10;

/** Map niche category → arXiv category codes. */
const ARXIV_CATEGORIES: Record<string, string[]> = {
  tech:    ["cs.AI", "cs.LG", "cs.SE", "cs.HC"],
  finance: ["q-fin.PM", "q-fin.TR", "econ.GN"],
  health:  ["q-bio.QM", "stat.AP"],
  education: ["cs.CY", "stat.AP"],
  sustainability: ["physics.ao-ph", "econ.GN"],
};

export async function fetchArxivTrends(
  nicheCategory: string,
  extraTerms: string[] = []
): Promise<RawTrend[]> {
  const categories = ARXIV_CATEGORIES[nicheCategory];
  if (!categories || categories.length === 0) return [];

  const trends: RawTrend[] = [];

  for (const category of categories.slice(0, 2)) {
    try {
      const query = extraTerms.length > 0
        ? `cat:${category}+AND+(${extraTerms.slice(0, 3).join("+OR+")})`
        : `cat:${category}`;

      const url = `${ARXIV_API}?search_query=${encodeURIComponent(query)}&start=0&max_results=${MAX_RESULTS}&sortBy=submittedDate&sortOrder=descending`;
      const res = await fetch(url, {
        headers: { "Accept": "application/atom+xml" },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        console.warn(`[arxiv] HTTP ${res.status} for category "${category}"`);
        continue;
      }

      const xml = await res.text();
      const entries = parseArxivXml(xml);

      for (const entry of entries) {
        const ageMs = Date.now() - entry.published.getTime();
        const ageDays = ageMs / 864e5;
        if (ageDays > 30) continue; // Skip papers older than 30 days

        trends.push({
          source: "arxiv",
          title: `Research: ${entry.title}`,
          url: entry.link,
          keywords: [...entry.categories, ...extraTerms.slice(0, 5)],
          sourcePublishedAt: entry.published,
          observedAt: new Date(),
          engagementHint: 85, // High authority source baseline
        } as RawTrend & { source: "arxiv" } as any);
      }
    } catch (err: any) {
      console.error(`[arxiv] Failed category "${category}": ${err?.message}`);
    }
  }

  console.log(`[arxiv] Fetched ${trends.length} papers for category "${nicheCategory}"`);
  return trends;
}

interface ArxivEntry {
  title: string;
  link: string;
  published: Date;
  categories: string[];
}

function parseArxivXml(xml: string): ArxivEntry[] {
  const entries: ArxivEntry[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (/<title>([\s\S]*?)<\/title>/.exec(block)?.[1] ?? "").trim().replace(/\s+/g, " ");
    const link = /<id>([\s\S]*?)<\/id>/.exec(block)?.[1]?.trim() ?? "";
    const publishedStr = /<published>([\s\S]*?)<\/published>/.exec(block)?.[1]?.trim() ?? "";
    const published = publishedStr ? new Date(publishedStr) : new Date();
    const categories: string[] = [];
    const catRegex = /<category term="([^"]+)"/g;
    let catMatch: RegExpExecArray | null;
    while ((catMatch = catRegex.exec(block)) !== null) {
      categories.push(catMatch[1]);
    }

    if (title && link) {
      entries.push({ title, link, published, categories });
    }
  }

  return entries;
}
