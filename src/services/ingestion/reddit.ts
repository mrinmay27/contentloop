import type { RawTrend } from "../../domain/types.js";

export async function fetchRedditTrends(subreddits: string[], keywords: string[]): Promise<RawTrend[]> {
  const trends: RawTrend[] = [];
  for (const subreddit of subreddits.slice(0, 4)) {
    const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=10`;
    try {
      const response = await fetch(url, { headers: { "User-Agent": "theme-page-content-engine/0.1" } });
      if (!response.ok) continue;
      const json = await response.json();
      for (const child of json.data?.children ?? []) {
        const post = child.data;
        if (!post?.title) continue;
        trends.push({
          source: "reddit",
          title: post.title,
          url: `https://reddit.com${post.permalink}`,
          keywords: keywordize(post.title),
          sourcePublishedAt: post.created_utc ? new Date(post.created_utc * 1000) : undefined,
          observedAt: new Date(),
          engagementHint: Math.min(100, Number(post.score ?? 0) / 10)
        });
      }
    } catch {
      // Ignore per-source failures.
    }
  }
  return trends;
}

function keywordize(input: string): string[] {
  return [...new Set(input.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 3))].slice(
    0,
    10
  );
}
