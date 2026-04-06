import type { RawSignal } from "../types.js";
import { matchesAIKeywords } from "../config.js";

const HN_API = "https://hacker-news.firebaseio.com/v0";
const FETCH_LIMIT = 100;

interface HNItem {
  id: number;
  title?: string;
  url?: string;
  text?: string;
  by?: string;
  score?: number;
  descendants?: number; // comment count
  time?: number;
  type?: string;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HN API ${res.status}: ${url}`);
  return res.json() as Promise<T>;
}

async function fetchStoryIds(
  endpoint: string
): Promise<number[]> {
  const ids = await fetchJSON<number[]>(`${HN_API}/${endpoint}.json`);
  return ids.slice(0, FETCH_LIMIT);
}

async function fetchItem(id: number): Promise<HNItem | null> {
  try {
    return await fetchJSON<HNItem>(`${HN_API}/item/${id}.json`);
  } catch {
    return null;
  }
}

function toRawSignal(item: HNItem): RawSignal {
  return {
    sourceType: "hackernews",
    title: item.title ?? "",
    url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
    body: item.text ?? null,
    author: item.by ?? null,
    engagementMetrics: {
      upvotes: item.score ?? 0,
      comments: item.descendants ?? 0,
    },
    publishedAt: item.time
      ? new Date(item.time * 1000).toISOString()
      : null,
    tags: [],
  };
}

export async function poll(): Promise<RawSignal[]> {
  console.log("[HN] Polling top, new, and show stories...");

  // Fetch all three story lists in parallel
  const [topIds, newIds, showIds] = await Promise.allSettled([
    fetchStoryIds("topstories"),
    fetchStoryIds("newstories"),
    fetchStoryIds("showstories"),
  ]);

  // Merge and deduplicate IDs
  const allIds = new Set<number>();
  for (const result of [topIds, newIds, showIds]) {
    if (result.status === "fulfilled") {
      for (const id of result.value) allIds.add(id);
    } else {
      console.warn(`[HN] Failed to fetch a story list: ${result.reason}`);
    }
  }

  console.log(`[HN] Fetching ${allIds.size} unique items...`);

  // Fetch items in batches of 20 to avoid hammering the API
  const items: HNItem[] = [];
  const idArray = [...allIds];
  const BATCH_SIZE = 20;

  for (let i = 0; i < idArray.length; i += BATCH_SIZE) {
    const batch = idArray.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(fetchItem));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        items.push(r.value);
      }
    }
  }

  // Filter to stories (not comments/polls) that match AI keywords
  const signals = items
    .filter((item) => {
      if (item.type !== "story") return false;
      const text = [item.title, item.text, item.url].filter(Boolean).join(" ");
      return matchesAIKeywords(text);
    })
    .map(toRawSignal);

  console.log(
    `[HN] Found ${signals.length} AI-related signals from ${items.length} stories`
  );

  return signals;
}
