import { env } from "../../config/env.js";
import type { RawTrend } from "../../domain/types.js";

export async function fetchTwitterKeywordTrends(keywords: string[]): Promise<RawTrend[]> {
  if (!env.TWITTER_BEARER_TOKEN) {
    return keywords.slice(0, 4).map((keyword) => ({
      source: "twitter",
      title: `${keyword} conversation spike`,
      keywords: [keyword, "conversation", "spike"],
      observedAt: new Date(),
      engagementHint: 30
    }));
  }

  const query = encodeURIComponent(`(${keywords.slice(0, 5).join(" OR ")}) -is:retweet lang:en`);
  const url = `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=20&tweet.fields=created_at,public_metrics`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${env.TWITTER_BEARER_TOKEN}` }
  });
  if (!response.ok) return [];
  const json = await response.json();

  return (json.data ?? []).map((tweet: any) => ({
    source: "twitter",
    title: tweet.text.slice(0, 180),
    keywords: keywordize(tweet.text),
    sourcePublishedAt: tweet.created_at ? new Date(tweet.created_at) : undefined,
    observedAt: new Date(),
    engagementHint: Math.min(100, Number(tweet.public_metrics?.like_count ?? 0) + Number(tweet.public_metrics?.retweet_count ?? 0))
  }));
}

function keywordize(input: string): string[] {
  return [...new Set(input.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 3))].slice(
    0,
    10
  );
}
