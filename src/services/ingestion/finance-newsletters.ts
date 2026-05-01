/** Task 2.8 — Finance & Business Newsletter RSS sources.
 *
 * High-authority finance/business newsletters that publish RSS feeds.
 * These cover Morning Brew, The Hustle, CNBC Markets, Bloomberg,
 * Investopedia, and CoinDesk (crypto variant).
 *
 * All feeds are free public RSS — no auth needed.
 * engagementHint = 78 — curated, professional sources.
 */

import type { RawTrend } from "../../domain/types.js";
import { fetchRssTrends } from "./rss.js";

// Finance/business newsletter RSS feeds
const FINANCE_RSS_FEEDS = [
  "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",                  // WSJ Markets
  "https://www.cnbc.com/id/10000664/device/rss/rss.html",           // CNBC Finance
  "https://feeds.feedburner.com/entrepreneur/latest",                // Entrepreneur
  "https://hbr.org/resources/rss/hbr_topic_leadership_rss.xml",     // HBR Leadership
  "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",      // NYT Business
];

const CRYPTO_RSS_FEEDS = [
  "https://cointelegraph.com/rss",                                    // CoinTelegraph
  "https://coindesk.com/arc/outboundfeeds/rss/",                    // CoinDesk
  "https://www.theblock.co/rss.xml",                                 // The Block
];

const GENERAL_BUSINESS_RSS_FEEDS = [
  "https://feeds.feedburner.com/FastCompany",                        // Fast Company
  "https://www.inc.com/rss.xml",                                     // Inc.
];

/**
 * Fetch finance/business newsletter RSS trends.
 * @param nicheCategory The niche category (finance, business, tech, etc.)
 * @param keywords      The niche keywords for relevance filtering
 */
export async function fetchFinanceNewsletterTrends(
  nicheCategory: string,
  keywords:      string[]
): Promise<RawTrend[]> {
  const isFinance  = nicheCategory === "finance";
  const isCrypto   = keywords.some(k =>
    ["crypto", "bitcoin", "ethereum", "defi", "nft", "blockchain"].includes(k.toLowerCase())
  );
  const isBusiness = nicheCategory === "business";
  const isTech     = nicheCategory === "tech";

  // Select which feeds to use
  let feeds: string[] = [];

  if (isFinance) {
    feeds = [...FINANCE_RSS_FEEDS, ...(isCrypto ? CRYPTO_RSS_FEEDS : [])];
  } else if (isCrypto) {
    feeds = CRYPTO_RSS_FEEDS;
  } else if (isBusiness || isTech) {
    feeds = GENERAL_BUSINESS_RSS_FEEDS;
  } else {
    return [];  // Not relevant for other niches
  }

  console.log(`[finance-newsletters] Fetching ${feeds.length} RSS feeds for ${nicheCategory}`);

  try {
    const trends = await fetchRssTrends(feeds);
    // Boost engagement hint for newsletter content (curated = higher quality)
    const boosted = trends.map(t => ({ ...t, engagementHint: 78 }));
    console.log(`[finance-newsletters] ✓ ${boosted.length} newsletter articles fetched`);
    return boosted;
  } catch (err: any) {
    console.warn(`[finance-newsletters] RSS fetch failed: ${err?.message}`);
    return [];
  }
}
