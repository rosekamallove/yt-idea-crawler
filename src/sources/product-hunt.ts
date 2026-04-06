import type { RawSignal } from "../types.js";
import { config, matchesAIKeywords } from "../config.js";

const PH_API = "https://api.producthunt.com/v2/api/graphql";

interface PHNode {
  name: string;
  tagline: string;
  url: string;
  votesCount: number;
  commentsCount: number;
  createdAt: string;
  topics: { edges: { node: { name: string } }[] };
  makers: { username: string }[];
}

interface PHResponse {
  data: {
    posts: {
      edges: { node: PHNode }[];
    };
  };
}

const QUERY = `
  query {
    posts(order: VOTES, postedAfter: "$DATE") {
      edges {
        node {
          name
          tagline
          url
          votesCount
          commentsCount
          createdAt
          topics(first: 5) {
            edges { node { name } }
          }
          makers { username }
        }
      }
    }
  }
`;

function toRawSignal(node: PHNode): RawSignal {
  const topics = node.topics.edges.map((e) => e.node.name);
  return {
    sourceType: "product-hunt",
    title: `${node.name}: ${node.tagline}`,
    url: node.url,
    body: node.tagline,
    author: node.makers[0]?.username ?? null,
    engagementMetrics: {
      upvotes: node.votesCount,
      comments: node.commentsCount,
    },
    publishedAt: node.createdAt,
    tags: topics,
  };
}

export async function poll(): Promise<RawSignal[]> {
  if (!config.productHuntToken) {
    console.log("[Product Hunt] No token — skipping. Set PRODUCTHUNT_TOKEN in .env");
    return [];
  }

  console.log("[Product Hunt] Fetching recent AI/dev tool launches...");

  // Posts from last 3 days
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const query = QUERY.replace("$DATE", since);

  const res = await fetch(PH_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.productHuntToken}`,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`Product Hunt API ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as PHResponse;
  const posts = json.data.posts.edges.map((e) => e.node);

  // Filter for AI/dev tool related posts
  const signals = posts
    .filter((post) => {
      const topics = post.topics.edges.map((e) => e.node.name.toLowerCase());
      const isDevOrAI = topics.some(
        (t) =>
          t.includes("artificial intelligence") ||
          t.includes("developer tools") ||
          t.includes("saas") ||
          t.includes("open source") ||
          t.includes("productivity")
      );
      const keywordMatch = matchesAIKeywords(
        `${post.name} ${post.tagline} ${topics.join(" ")}`
      );
      return isDevOrAI || keywordMatch;
    })
    .map(toRawSignal);

  console.log(`[Product Hunt] Found ${signals.length} AI/dev tool launches`);
  return signals;
}
