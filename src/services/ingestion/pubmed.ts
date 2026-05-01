/** Task 2.5.2 — PubMed / NIH API Source.
 *
 * Pulls recent, relevant research abstracts from PubMed for health, food,
 * and nutrition niches. No auth required for basic usage.
 *
 * Quality weight: engagementHint = 95 (highest authority source in the system).
 * Content angle: "What this study means for you" → carousel format gold mine.
 */

import type { RawTrend } from "../../domain/types.js";

const PUBMED_SEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_FETCH_URL  = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const PUBMED_SUMMARY_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";

const RECENCY_DAYS = 90;      // only pull articles from the last 90 days
const MAX_RESULTS  = 10;
const ENGAGEMENT_HINT = 95;   // highest authority in the system

/** Build a PubMed date range filter for the last N days */
function dateFilter(days: number): string {
  const now   = new Date();
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const fmt   = (d: Date) =>
    `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  return `${fmt(start)}:${fmt(now)}[pdat]`;
}

/** Fetch PubMed IDs for a query string */
async function searchPubMed(query: string): Promise<string[]> {
  const params = new URLSearchParams({
    db:         "pubmed",
    term:       `${query} AND ${dateFilter(RECENCY_DAYS)}`,
    retmax:     String(MAX_RESULTS),
    retmode:    "json",
    sort:       "relevance",
    usehistory: "n",
  });

  const res = await fetch(`${PUBMED_SEARCH_URL}?${params}`, {
    signal:  AbortSignal.timeout(8000),
    headers: { "User-Agent": "TPCE/1.0 (research-ingestion)" },
  });
  if (!res.ok) throw new Error(`PubMed search ${res.status}`);

  const data: any = await res.json();
  return (data.esearchresult?.idlist ?? []) as string[];
}

/** Fetch article summaries (title + pub date) for a list of PubMed IDs */
async function fetchSummaries(ids: string[]): Promise<Array<{
  uid:   string;
  title: string;
  pubdate: string;
  source: string;
}>> {
  if (ids.length === 0) return [];

  const params = new URLSearchParams({
    db:      "pubmed",
    id:      ids.join(","),
    retmode: "json",
    rettype: "abstract",
  });

  const res = await fetch(`${PUBMED_SUMMARY_URL}?${params}`, {
    signal:  AbortSignal.timeout(8000),
    headers: { "User-Agent": "TPCE/1.0 (research-ingestion)" },
  });
  if (!res.ok) throw new Error(`PubMed summary ${res.status}`);

  const data: any = await res.json();
  const result = data.result ?? {};

  return ids
    .map((uid) => {
      const item = result[uid];
      if (!item) return null;
      return {
        uid,
        title:   String(item.title ?? "").replace(/<[^>]*>/g, "").trim(),
        pubdate: String(item.pubdate ?? item.epubdate ?? ""),
        source:  String(item.source ?? item.fulljournalname ?? "PubMed"),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && x.title.length > 10);
}

/** Build a carousel-ready title from a research paper title */
function carouselTitle(rawTitle: string, keywords: string[]): string {
  // Strip trailing punctuation from PubMed titles
  const clean = rawTitle.replace(/\.$/, "").trim();

  // If the title is a clinical/technical statement, reframe it
  if (clean.length > 80) {
    const kw = keywords[0] ?? "health";
    return `New research on ${kw}: What it means for you`;
  }
  return clean;
}

/**
 * Fetch recent PubMed research trends for health/nutrition keywords.
 * Returns RawTrend items formatted for the scoring pipeline.
 */
export async function fetchPubMedTrends(keywords: string[]): Promise<RawTrend[]> {
  if (keywords.length === 0) return [];

  const query = keywords.slice(0, 3).join(" OR ");
  console.log(`[pubmed] Searching: "${query}"`);

  let ids: string[];
  try {
    ids = await searchPubMed(query);
  } catch (err: any) {
    console.warn(`[pubmed] Search failed: ${err?.message}`);
    return [];
  }

  if (ids.length === 0) {
    console.log(`[pubmed] No results for "${query}"`);
    return [];
  }

  let summaries: Awaited<ReturnType<typeof fetchSummaries>>;
  try {
    summaries = await fetchSummaries(ids);
  } catch (err: any) {
    console.warn(`[pubmed] Summary fetch failed: ${err?.message}`);
    return [];
  }

  const trends: RawTrend[] = summaries.map((s) => {
    const pubDate = s.pubdate ? new Date(s.pubdate) : new Date();
    const validDate = isNaN(pubDate.getTime()) ? new Date() : pubDate;

    return {
      source:            "pubmed" as const,
      title:             carouselTitle(s.title, keywords),
      url:               `https://pubmed.ncbi.nlm.nih.gov/${s.uid}/`,
      keywords:          keywords.slice(0, 5),
      sourcePublishedAt: validDate,
      observedAt:        new Date(),
      engagementHint:    ENGAGEMENT_HINT,
    };
  });

  console.log(`[pubmed] ✓ ${trends.length} research articles fetched`);
  return trends;
}
