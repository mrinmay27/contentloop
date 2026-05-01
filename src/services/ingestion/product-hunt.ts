/** Task 2.7 — Product Hunt ingestion source.
 *
 * Product Hunt surfaces newly launched AI tools, SaaS products, and developer
 * tools. It's the highest-signal source for tech/AI niches.
 *
 * Uses the public GraphQL API (no auth needed for basic queries).
 * Topics from Product Hunt → strong carousel bias (product breakdowns).
 * engagementHint = 80 — high quality, verified launches.
 *
 * Only activates for tech, business, and creative niches.
 */

import type { RawTrend } from "../../domain/types.js";

const PH_GRAPHQL_URL = "https://api.producthunt.com/v2/api/graphql";
const ENGAGEMENT_HINT = 80;

// Niches that benefit from Product Hunt
const SUPPORTED_CATEGORIES = new Set(["tech", "business", "creative", "education"]);

const PH_QUERY = `
query FetchTopPosts($after: String, $featured: Boolean) {
  posts(first: 15, after: $after, order: VOTES, featured: $featured) {
    edges {
      node {
        id
        name
        tagline
        description
        url
        votesCount
        topics {
          edges { node { name slug } }
        }
        createdAt
      }
    }
  }
}`;

interface PhPost {
  id:          string;
  name:        string;
  tagline:     string;
  description?: string;
  url:         string;
  votesCount:  number;
  topics:      Array<{ name: string; slug: string }>;
  createdAt:   string;
}

/** Fetch from Product Hunt GraphQL. No token needed for public data. */
async function fetchPhPosts(featured = true): Promise<PhPost[]> {
  const body = JSON.stringify({
    query: PH_QUERY,
    variables: { featured },
  });

  const res = await fetch(PH_GRAPHQL_URL, {
    method: "POST",
    signal: AbortSignal.timeout(9000),
    headers: {
      "Content-Type": "application/json",
      "User-Agent":   "TPCE/1.0 (content-ingestion)",
      // Note: for higher rate limits add a Developer Token here:
      // "Authorization": `Bearer ${process.env.PRODUCT_HUNT_TOKEN ?? ""}`,
    },
    body,
  });

  if (!res.ok) throw new Error(`Product Hunt GraphQL ${res.status}`);

  const data: any = await res.json();
  if (data.errors) throw new Error(data.errors[0]?.message ?? "GraphQL error");

  const edges: any[] = data.data?.posts?.edges ?? [];
  return edges.map((e: any) => ({
    id:          String(e.node.id),
    name:        String(e.node.name),
    tagline:     String(e.node.tagline ?? ""),
    description: e.node.description ?? "",
    url:         String(e.node.url ?? `https://www.producthunt.com/posts/${e.node.id}`),
    votesCount:  Number(e.node.votesCount ?? 0),
    topics:      (e.node.topics?.edges ?? []).map((te: any) => ({
      name: String(te.node.name),
      slug: String(te.node.slug),
    })),
    createdAt:   String(e.node.createdAt ?? new Date().toISOString()),
  }));
}

/** Check if a post is relevant to the niche keywords */
function isRelevant(post: PhPost, keywords: string[]): boolean {
  const kw = keywords.map(k => k.toLowerCase());
  const text = [post.name, post.tagline, post.description ?? ""].join(" ").toLowerCase();
  const topicNames = post.topics.map(t => t.name.toLowerCase());

  return kw.some(k => text.includes(k) || topicNames.some(tn => tn.includes(k)));
}

/**
 * Fetch Product Hunt trending launches for tech/business niches.
 * Returns posts sorted by vote count as RawTrend items.
 */
export async function fetchProductHuntTrends(
  nicheCategory: string,
  keywords:      string[]
): Promise<RawTrend[]> {
  if (!SUPPORTED_CATEGORIES.has(nicheCategory)) {
    return [];  // Not relevant for non-tech niches
  }

  console.log(`[product-hunt] Fetching for category=${nicheCategory}`);

  let posts: PhPost[] = [];
  try {
    posts = await fetchPhPosts(true);   // featured only first
  } catch (err: any) {
    console.warn(`[product-hunt] Featured fetch failed: ${err?.message}`);
    try {
      posts = await fetchPhPosts(false);  // all posts fallback
    } catch (err2: any) {
      console.warn(`[product-hunt] All posts fetch also failed: ${err2?.message}`);
      return [];
    }
  }

  if (posts.length === 0) {
    console.log(`[product-hunt] No posts returned`);
    return [];
  }

  // Filter to niche-relevant posts, or keep all if no match (tech niches are broadly relevant)
  const relevant = posts.filter(p => isRelevant(p, keywords));
  const final = relevant.length >= 3 ? relevant : posts.slice(0, 10);

  // Sort by votes desc (most upvoted = highest engagement signal)
  final.sort((a, b) => b.votesCount - a.votesCount);

  const trends: RawTrend[] = final.slice(0, 10).map(post => {
    const pubDate = new Date(post.createdAt);
    const validDate = isNaN(pubDate.getTime()) ? new Date() : pubDate;

    // Votes → scaled engagement hint (500 votes = ~95, 50 votes = ~82)
    const voteBoost = Math.min(15, Math.floor(post.votesCount / 50));
    const hint = Math.min(95, ENGAGEMENT_HINT + voteBoost);

    return {
      source:            "hacker_news" as const,  // same scoring tier as HN
      title:             `${post.name}: ${post.tagline}`,
      url:               post.url,
      keywords:          [
        ...keywords.slice(0, 3),
        ...post.topics.slice(0, 2).map(t => t.name),
      ].slice(0, 8),
      sourcePublishedAt: validDate,
      observedAt:        new Date(),
      engagementHint:    hint,
    };
  });

  console.log(`[product-hunt] ✓ ${trends.length} product launches fetched (${final[0]?.votesCount ?? 0} top votes)`);
  return trends;
}
