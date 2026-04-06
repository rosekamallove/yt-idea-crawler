import type { RawSignal } from "../types.js";
import { matchesAIKeywords } from "../config.js";

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

async function fetchSubreddit(
  subreddit: string,
  sort: "hot" | "new"
): Promise<RedditPost[]> {
  const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=50`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });

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
    url: d.is_self
      ? `https://reddit.com${d.permalink}`
      : d.url,
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

  const tasks = SUBREDDITS.flatMap((sub) => [
    fetchSubreddit(sub, "hot").then((posts) => ({ sub, sort: "hot" as const, posts })),
    fetchSubreddit(sub, "new").then((posts) => ({ sub, sort: "new" as const, posts })),
  ]);

  const results = await Promise.allSettled(tasks);

  const seen = new Set<string>();
  const signals: RawSignal[] = [];

  for (const r of results) {
    if (r.status !== "fulfilled") {
      console.warn(`[Reddit] Failed:`, r.reason);
      continue;
    }

    const { sort, posts } = r.value;
    const minScore = sort === "hot" ? MIN_SCORE_HOT : MIN_SCORE_NEW;

    for (const post of posts) {
      const d = post.data;

      // Deduplicate within this run
      if (seen.has(d.id)) continue;
      seen.add(d.id);

      // Score filter
      if (d.score < minScore) continue;

      // AI keyword filter
      const text = [d.title, d.selftext, d.url].join(" ");
      if (!matchesAIKeywords(text)) continue;

      signals.push(toRawSignal(post));
    }
  }

  console.log(`[Reddit] Found ${signals.length} AI-related signals`);
  return signals;
}
