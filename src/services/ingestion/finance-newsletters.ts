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
  "https://www.cnbc.com/id/10000664/device/rss/rss.html",           // CNBC Finance
  "https://feeds.feedburner.com/entrepreneur/latest",                // Entrepreneur
  "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",      // NYT Business
  "https://www.nerdwallet.com/blog/feed/",                           // NerdWallet personal finance
  // removed: wsj.com (403), hbr.org (403)
];

const CRYPTO_RSS_FEEDS = [
  "https://cointelegraph.com/rss",                                    // CoinTelegraph
  "https://www.coindesk.com/arc/outboundfeeds/rss/",                // CoinDesk
  // removed: theblock.co (403 as of 2026-05-03)
];

const GENERAL_BUSINESS_RSS_FEEDS = [
  "https://feeds.feedburner.com/FastCompany",                        // Fast Company
  "https://www.inc.com/rss.xml",                                     // Inc.
];

/**
 * Fetch finance/business newsletter RSS trends.
 * @param nicheCategory The niche category (finance, business, tech, etc.)
 * @param keywords      The niche keywords for relevance filtering
 * @param overrideFeeds User-configured feed URLs (PageSourceMap.financeFeeds).
 *                      Non-empty = use these instead of the module defaults.
 */
export async function fetchFinanceNewsletterTrends(
  nicheCategory: string,
  keywords:      string[],
  overrideFeeds?: string[]
): Promise<RawTrend[]> {
  if (overrideFeeds && overrideFeeds.length > 0) {
    console.log(`[finance-newsletters] Using ${overrideFeeds.length} user-configured feeds for ${nicheCategory}`);
    try {
      const trends = await fetchRssTrends(overrideFeeds);
      const boosted = trends.map(t => ({ ...t, source: "finance_newsletter" as const, engagementHint: 78 }));
      console.log(`[finance-newsletters] ✓ ${boosted.length} newsletter articles fetched`);
      return boosted;
    } catch (err: any) {
      console.warn(`[finance-newsletters] RSS fetch failed: ${err?.message}`);
      return [];
    }
  }

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
    // Override source + boost engagement hint for newsletter content
    const boosted = trends.map(t => ({ ...t, source: "finance_newsletter" as const, engagementHint: 78 }));
    console.log(`[finance-newsletters] ✓ ${boosted.length} newsletter articles fetched`);
    return boosted;
  } catch (err: any) {
    console.warn(`[finance-newsletters] RSS fetch failed: ${err?.message}`);
    return [];
  }
}
