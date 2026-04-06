import RSSParser from "rss-parser";
import type { RawSignal } from "../types.js";

const parser = new RSSParser({ timeout: 10_000 });

const QUERIES = [
  "AI coding tool launch",
  "vibe coding AI",
  "Claude Code",
  "Cursor AI",
  "LLM open source release",
  "AI agent framework",
  "AI developer tools",
  "AI startup launch",
];

function buildFeedUrl(query: string): string {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}+when:3d&hl=en-US&gl=US&ceid=US:en`;
}

function toRawSignal(
  item: RSSParser.Item,
  query: string
): RawSignal {
  return {
    sourceType: "google-news",
    title: item.title ?? "",
    url: item.link ?? "",
    body: item.contentSnippet ?? item.content ?? null,
    author: item.creator ?? null,
    engagementMetrics: {},
    publishedAt: item.isoDate ?? null,
    tags: [query],
  };
}

export async function poll(): Promise<RawSignal[]> {
  console.log(`[Google News] Fetching ${QUERIES.length} query feeds...`);

  const results = await Promise.allSettled(
    QUERIES.map(async (query) => {
      const url = buildFeedUrl(query);
      const feed = await parser.parseURL(url);
      return (feed.items ?? []).map((item) => toRawSignal(item, query));
    })
  );

  const seen = new Set<string>();
  const signals: RawSignal[] = [];

  for (const r of results) {
    if (r.status !== "fulfilled") {
      console.warn(`[Google News] Feed failed:`, r.reason);
      continue;
    }

    for (const signal of r.value) {
      // Deduplicate by URL
      if (!signal.url || seen.has(signal.url)) continue;
      seen.add(signal.url);
      signals.push(signal);
    }
  }

  console.log(`[Google News] Found ${signals.length} articles`);
  return signals;
}
