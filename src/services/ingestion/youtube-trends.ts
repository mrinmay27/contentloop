/** Task 2.5.4 — YouTube Trending as cross-platform signal.
 *
 * Fetches trending YouTube videos by category. Used as a format signal:
 * if a topic is trending on YouTube → strongly prefer `reel` format.
 *
 * Requires YOUTUBE_API_KEY (YouTube Data API v3, free: 10k units/day).
 * Falls back gracefully to empty array if no key is configured.
 *
 * source: "youtube_trends"
 * engagementHint: view-count-scaled, capped at 95
 * Format bias: reel (cross-platform video trending = reel signal)
 *
 * Niche categories: tech, gaming, education, entertainment, business
 */

import type { NicheCategory } from "../../domain/niche-taxonomy.js";
import type { RawTrend } from "../../domain/types.js";

// YouTube category IDs → niche categories
// https://developers.google.com/youtube/v3/docs/videoCategories/list
const CATEGORY_ID_MAP: Partial<Record<NicheCategory, string[]>> = {
  tech:          ["28"],     // Science & Technology
  education:     ["27"],     // Education
  entertainment: ["20", "2"],// Gaming + Autos & Vehicles (broader entertainment)
  business:      ["22"],     // People & Blogs (business content)
  health:        ["26"],     // Howto & Style
  lifestyle:     ["26", "22"],
  creative:      ["26"],     // Howto & Style
  food:          ["26"],
};

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const REGION = "US";
const MAX_RESULTS = 10;

function getApiKey(): string | null {
  return process.env.YOUTUBE_API_KEY ?? null;
}

interface YTVideo {
  title:      string;
  videoId:    string;
  viewCount?: number;
  publishedAt?: string;
}

async function fetchTrendingByCategory(categoryId: string, apiKey: string): Promise<YTVideo[]> {
  const params = new URLSearchParams({
    part:              "snippet,statistics",
    chart:             "mostPopular",
    regionCode:        REGION,
    videoCategoryId:   categoryId,
    maxResults:        String(MAX_RESULTS),
    key:               apiKey,
  });

  const res = await fetch(`${YOUTUBE_API_BASE}/videos?${params}`, {
    signal: AbortSignal.timeout(8000),
    headers: { "Accept": "application/json" },
  });

  if (!res.ok) throw new Error(`YouTube API ${res.status} for category ${categoryId}`);
  const data: any = await res.json();

  return (data.items ?? []).map((item: any) => ({
    title:       String(item.snippet?.title ?? ""),
    videoId:     String(item.id ?? ""),
    viewCount:   Number(item.statistics?.viewCount ?? 0),
    publishedAt: item.snippet?.publishedAt ?? undefined,
  })).filter((v: YTVideo) => v.title.length > 5);
}

/** Scale view count to 0–95 engagement hint */
function viewsToHint(viewCount: number): number {
  if (viewCount >= 1_000_000) return 95;
  if (viewCount >= 500_000)   return 88;
  if (viewCount >= 100_000)   return 80;
  if (viewCount >= 10_000)    return 70;
  return 60;
}

/**
 * Fetch YouTube trending videos for a niche category.
 * Activates for: tech, education, entertainment, business, health, lifestyle, creative, food.
 * Returns RawTrend items with strong reel-format bias.
 */
export async function fetchYouTubeTrends(
  nicheCategory: NicheCategory,
  keywords:      string[]
): Promise<RawTrend[]> {
  const categoryIds = CATEGORY_ID_MAP[nicheCategory];
  if (!categoryIds) return [];

  const apiKey = getApiKey();
  if (!apiKey) {
    console.log(`[youtube-trends] Skipped — YOUTUBE_API_KEY not configured`);
    return [];
  }

  console.log(`[youtube-trends] Fetching for category=${nicheCategory}, ytCategories=${categoryIds.join(",")}`);

  const keywordLower = keywords.map(k => k.toLowerCase());
  const allVideos: YTVideo[] = [];

  for (const catId of categoryIds.slice(0, 2)) {
    try {
      const videos = await fetchTrendingByCategory(catId, apiKey);
      allVideos.push(...videos);
    } catch (err: any) {
      console.warn(`[youtube-trends] Failed category ${catId}: ${err?.message}`);
    }
  }

  if (allVideos.length === 0) {
    console.log(`[youtube-trends] No results for ${nicheCategory}`);
    return [];
  }

  // Filter to relevant videos (keyword overlap) or keep all if no overlap found
  const relevant = allVideos.filter(v => {
    const lower = v.title.toLowerCase();
    return keywordLower.some(kw => lower.includes(kw));
  });
  const finalVideos = relevant.length > 0 ? relevant : allVideos.slice(0, 5);

  const trends: RawTrend[] = finalVideos.map(video => {
    const pubDate = video.publishedAt ? new Date(video.publishedAt) : new Date();
    return {
      source:            "youtube_trends" as const,
      title:             video.title,
      url:               `https://www.youtube.com/watch?v=${video.videoId}`,
      keywords:          keywords.slice(0, 5),
      sourcePublishedAt: isNaN(pubDate.getTime()) ? new Date() : pubDate,
      observedAt:        new Date(),
      engagementHint:    viewsToHint(video.viewCount ?? 0),
    };
  });

  console.log(`[youtube-trends] ✓ ${trends.length} trending videos fetched`);
  return trends;
}
