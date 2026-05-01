/** Task 2.5.8 — Crypto-specific RSS sources (Finance niche only).
 *  CoinDesk, Decrypt, The Block — only activated for pages with
 *  finance category + crypto keywords in niche tags.
 *  Freshness critical: crypto news older than 24 hrs is stale → heavy decay applied.
 */

import type { RawTrend } from "../../domain/types.js";

const CRYPTO_FEEDS = [
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", engagementHint: 80 },
  { name: "Decrypt",  url: "https://decrypt.co/feed",                         engagementHint: 75 },
  { name: "The Block", url: "https://www.theblock.co/rss.xml",               engagementHint: 78 },
];

const STALENESS_HOURS = 24; // crypto news older than this gets discarded

export async function fetchCryptoTrends(keywords: string[]): Promise<RawTrend[]> {
  const trends: RawTrend[] = [];
  const keywordLower = keywords.map((k) => k.toLowerCase());

  for (const feed of CRYPTO_FEEDS) {
    try {
      const res = await fetch(feed.url, {
        headers: { "User-Agent": "TPCE/1.0 content-research-bot" },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        console.warn(`[crypto] HTTP ${res.status} for feed "${feed.name}"`);
        continue;
      }

      const xml = await res.text();
      const items = parseCryptoRss(xml);

      for (const item of items) {
        // Staleness gate — crypto news ages fast
        const ageHours = (Date.now() - item.pubDate.getTime()) / 36e5;
        if (ageHours > STALENESS_HOURS) continue;

        // Relevance check against niche keywords
        const titleLower = item.title.toLowerCase();
        const hasOverlap =
          keywordLower.length === 0 ||
          keywordLower.some((kw) => titleLower.includes(kw));
        if (!hasOverlap) continue;

        // Apply freshness decay: >12h → 60% hint, ≤12h → full
        const decayedHint = ageHours > 12
          ? Math.round(feed.engagementHint * 0.6)
          : feed.engagementHint;

        trends.push({
          source: "crypto_news",
          title: item.title,
          url: item.link,
          keywords: [...keywords.slice(0, 5), "crypto", feed.name.toLowerCase()],
          sourcePublishedAt: item.pubDate,
          observedAt: new Date(),
          engagementHint: decayedHint,
        } as RawTrend);
      }
    } catch (err: any) {
      console.error(`[crypto] Failed "${feed.name}": ${err?.message}`);
    }
  }

  console.log(`[crypto] Fetched ${trends.length} items from ${CRYPTO_FEEDS.length} feeds`);
  return trends;
}

interface CryptoItem {
  title: string;
  link: string;
  pubDate: Date;
}

function parseCryptoRss(xml: string): CryptoItem[] {
  const items: CryptoItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (/<title><!\[CDATA\[([\s\S]*?)\]\]>|<title>([\s\S]*?)<\/title>/.exec(block) ?? [])[1]?.trim() ??
                  (/<title>([\s\S]*?)<\/title>/.exec(block)?.[1] ?? "").trim();
    const link = (/<link>([\s\S]*?)<\/link>/.exec(block)?.[1] ?? "").trim();
    const pubDateStr = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(block)?.[1]?.trim() ?? "";
    const pubDate = pubDateStr ? new Date(pubDateStr) : new Date();

    if (title) {
      items.push({ title, link, pubDate });
    }
  }

  return items;
}
