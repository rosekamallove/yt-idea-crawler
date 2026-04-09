import type { RawSignal } from "../types.js";
import { config, matchesAIKeywords } from "../config.js";

const SUBREDDITS = [
  "LocalLLaMA",
  "ClaudeAI",
  "ChatGPT",
  "MachineLearning",
  "artificial",
  "ollama",
  "singularity",
  "cursor",
  "vibecoding",
];

const USER_AGENT = "yt-idea-crawler/0.1 (video research bot)";
const MIN_SCORE_HOT = 20;
const MIN_SCORE_NEW = 5;

interface RedditPost {
  data: {
    id: string;
    title: string;
    url: string;
    selftext: string;
    author: string;
    score: number;
    num_comments: number;
    created_utc: number;
    subreddit: string;
    permalink: string;
    is_self: boolean;
  };
}

interface RedditListing {
  data: {
    children: RedditPost[];
  };
}

/** Get an OAuth token using client credentials (app-only auth) */
async function getAccessToken(): Promise<string> {
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Authorization:
        "Basic " +
        Buffer.from(
          `${config.redditClientId}:${config.redditClientSecret}`
        ).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!res.ok) {
    throw new Error(`Reddit OAuth failed: ${res.status}`);
  }

  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

async function fetchSubreddit(
  subreddit: string,
  sort: "hot" | "new",
  token: string | null
): Promise<RedditPost[]> {
  // Use OAuth endpoint if we have a token, fallback to public JSON API
  const baseUrl = token
    ? `https://oauth.reddit.com/r/${subreddit}/${sort}?limit=50`
    : `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=50`;

  const headers: Record<string, string> = { "User-Agent": USER_AGENT };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(baseUrl, { headers });

  if (!res.ok) {
    throw new Error(`Reddit ${res.status} for r/${subreddit}/${sort}`);
  }

  const json = (await res.json()) as RedditListing;
  return json.data.children;
}

function toRawSignal(post: RedditPost): RawSignal {
  const d = post.data;
  return {
    sourceType: "reddit",
    title: d.title,
    url: d.is_self ? `https://reddit.com${d.permalink}` : d.url,
    body: d.selftext || null,
    author: d.author,
    engagementMetrics: {
      upvotes: d.score,
      comments: d.num_comments,
    },
    publishedAt: new Date(d.created_utc * 1000).toISOString(),
    tags: [d.subreddit],
  };
}

export async function poll(): Promise<RawSignal[]> {
  console.log(`[Reddit] Polling ${SUBREDDITS.length} subreddits (hot + new)...`);

  // Try OAuth first (needed for cloud/server environments)
  let token: string | null = null;
  if (config.redditClientId && config.redditClientSecret) {
    try {
      token = await getAccessToken();
      console.log("[Reddit] Using OAuth authentication");
    } catch (err) {
      console.warn("[Reddit] OAuth failed, falling back to public API:", err);
    }
  }

  const tasks = SUBREDDITS.flatMap((sub) => [
    fetchSubreddit(sub, "hot", token).then((posts) => ({
      sub,
      sort: "hot" as const,
      posts,
    })),
    fetchSubreddit(sub, "new", token).then((posts) => ({
      sub,
      sort: "new" as const,
      posts,
    })),
  ]);

  const results = await Promise.allSettled(tasks);

  const seen = new Set<string>();
  const signals: RawSignal[] = [];
  let failed = 0;

  for (const r of results) {
    if (r.status !== "fulfilled") {
      failed++;
      continue;
    }

    const { sort, posts } = r.value;
    const minScore = sort === "hot" ? MIN_SCORE_HOT : MIN_SCORE_NEW;

    for (const post of posts) {
      const d = post.data;

      if (seen.has(d.id)) continue;
      seen.add(d.id);

      if (d.score < minScore) continue;

      const text = [d.title, d.selftext, d.url].join(" ");
      if (!matchesAIKeywords(text)) continue;

      signals.push(toRawSignal(post));
    }
  }

  if (failed > 0) {
    console.warn(
      `[Reddit] ${failed}/${SUBREDDITS.length * 2} requests failed` +
        (token ? "" : " — add REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET for server use")
    );
  }

  console.log(`[Reddit] Found ${signals.length} AI-related signals`);
  return signals;
}
