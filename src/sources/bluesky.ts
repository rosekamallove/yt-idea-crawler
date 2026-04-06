import type { RawSignal } from "../types.js";
import { matchesAIKeywords } from "../config.js";

const BSKY_API = "https://public.api.bsky.app";

// Curated AI builder accounts on Bluesky
const ACCOUNTS = [
  "simonwillison.net",
  "swyx.bsky.social",
  "karpathy.bsky.social",
  "levelsio.bsky.social",
  "mattshumer.bsky.social",
  "andrewng.bsky.social",
  "emollick.bsky.social",
  "mckaywrigley.bsky.social",
  "sdand.bsky.social",
  "alexalbert.bsky.social",
  "rauchg.bsky.social",
  "sama.bsky.social",
  "skirano.bsky.social",
  "t3.gg",
  "primeagen.bsky.social",
  "mattpocock.com",
  "fireship.io",
  "amasad.bsky.social",
  "jxnl.bsky.social",
  "bindureddy.bsky.social",
];

interface BskyPost {
  uri: string;
  cid: string;
  author: {
    handle: string;
    displayName?: string;
  };
  record: {
    text: string;
    createdAt: string;
  };
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
}

interface BskyFeedResponse {
  feed: { post: BskyPost }[];
}

async function fetchAuthorFeed(handle: string): Promise<BskyPost[]> {
  const params = new URLSearchParams({
    actor: handle,
    limit: "30",
    filter: "posts_no_replies",
  });

  const res = await fetch(
    `${BSKY_API}/xrpc/app.bsky.feed.getAuthorFeed?${params}`
  );

  if (!res.ok) {
    throw new Error(`Bluesky ${res.status} for ${handle}`);
  }

  const json = (await res.json()) as BskyFeedResponse;
  return json.feed.map((f) => f.post);
}

function postUrl(uri: string, handle: string): string {
  // uri format: at://did:plc:xxx/app.bsky.feed.post/yyy
  const rkey = uri.split("/").pop();
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

function toRawSignal(post: BskyPost): RawSignal {
  return {
    sourceType: "twitter", // grouped with twitter as social media signals
    title: post.record.text.slice(0, 200),
    url: postUrl(post.uri, post.author.handle),
    body: post.record.text,
    author: post.author.displayName ?? post.author.handle,
    engagementMetrics: {
      upvotes: post.likeCount ?? 0,
      retweets: post.repostCount ?? 0,
      comments: post.replyCount ?? 0,
    },
    publishedAt: post.record.createdAt,
    tags: [post.author.handle, "bluesky"],
  };
}

export async function poll(): Promise<RawSignal[]> {
  console.log(`[Bluesky] Fetching feeds for ${ACCOUNTS.length} accounts...`);

  const results = await Promise.allSettled(
    ACCOUNTS.map((handle) => fetchAuthorFeed(handle))
  );

  const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const signals: RawSignal[] = [];
  let failed = 0;

  for (const r of results) {
    if (r.status !== "fulfilled") {
      failed++;
      continue;
    }

    for (const post of r.value) {
      // Only posts from last 3 days
      if (new Date(post.record.createdAt).getTime() < threeDaysAgo) continue;

      // Filter for AI-related content
      if (!matchesAIKeywords(post.record.text)) continue;

      signals.push(toRawSignal(post));
    }
  }

  if (failed > 0) {
    console.log(`[Bluesky] ${failed}/${ACCOUNTS.length} accounts failed`);
  }
  console.log(`[Bluesky] Found ${signals.length} AI-related posts`);
  return signals;
}
