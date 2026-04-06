import type { RawSignal } from "../types.js";
import { config } from "../config.js";

const YT_API = "https://www.googleapis.com/youtube/v3";

// Competitor channels in the AI/vibe-coding niche
// Format: [channelId, channelName]
const CHANNELS: [string, string][] = [
  ["UCsBjURrPoezykLs9EqgamOA", "Fireship"],
  ["UCWN3xxRkmTPphBnUhpnuTJA", "theo - t3.gg"],
  ["UCvjgXvBlCQM2a3MBq6tnfCw", "AI Jason"],
  ["UCo8bcnLyZH8tBIH9V1mLgqQ", "TheAIGRID"],
  ["UCPjNBjflYl0-HQtUvOx0Ibw", "Greg Isenberg"],
  ["UC4x3CR25WSlvMJUtSPPzwwg", "Chris Raroque"],
  ["UCv7m_ohx9SNmgeyOScsG_Pw", "Rourke Heath"],
  ["UCawZsQWqfGSbCI5yjkdVkTA", "Matthew Berman"],
  ["UCbo-KbSjJDG6JWQ_MTZ_rNA", "Nick Saraev"],
  ["UCmeU2DYiVy80wMBGZzEWnbw", "Paul J Lipsky"],
  ["UCMo28ATCDU0Kn9dpilAF79Q", "Simon Hoiberg"],
  ["UC3i3qKQ5aR_guegQj5bhOMw", "Zinho Automates"],
  ["UCKdQsv8EQ4RBtqJHXYPsS5w", "Kevin Kern"],
  ["UC4FK5DEcMLB3CyJcbJfZEJA", "Nicholas Puru"],
  ["UC5Ls4Ms_OFhUXIAm3iScyYQ", "Grit AI Studio"],
  ["UCZE0kpnhoy84NO9r1gs5W5Q", "Shawn Builds AI"],
  ["UC2UXDak6o7rBm23k3Vv5dww", "Tina Huang"],
  ["UCswG6FSbgZjbWtdf_hMLaow", "Matt Pocock"],
  ["UC-PQKtrPhk3JXyjUleBLgQQ", "AI Edge HQ"],
  ["UCOXRjenlq9PmlTqd_JhAbMQ", "Eric W Tech"],
];

interface YTSearchItem {
  id: { videoId: string };
  snippet: {
    title: string;
    description: string;
    channelTitle: string;
    publishedAt: string;
  };
}

interface YTSearchResponse {
  items: YTSearchItem[];
}

async function fetchRecentUploads(
  channelId: string,
  channelName: string
): Promise<RawSignal[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    part: "snippet",
    channelId,
    type: "video",
    order: "date",
    publishedAfter: since,
    maxResults: "10",
    key: config.youtubeApiKey,
  });

  const res = await fetch(`${YT_API}/search?${params}`);
  if (!res.ok) {
    throw new Error(`YT API ${res.status} for ${channelName}`);
  }

  const json = (await res.json()) as YTSearchResponse;

  return (json.items ?? []).map((item) => ({
    sourceType: "youtube" as const,
    title: `[${item.snippet.channelTitle}] ${item.snippet.title}`,
    url: `https://youtube.com/watch?v=${item.id.videoId}`,
    body: item.snippet.description?.slice(0, 300) ?? null,
    author: item.snippet.channelTitle,
    engagementMetrics: {},
    publishedAt: item.snippet.publishedAt,
    tags: [channelName],
  }));
}

export async function poll(): Promise<RawSignal[]> {
  if (!config.youtubeApiKey) {
    console.log("[YouTube] No API key -- skipping. Set YOUTUBE_API_KEY in .env");
    return [];
  }

  console.log(
    `[YouTube] Checking ${CHANNELS.length} competitor channels...`
  );

  const results = await Promise.allSettled(
    CHANNELS.map(([id, name]) => fetchRecentUploads(id, name))
  );

  const signals: RawSignal[] = [];
  let failed = 0;
  for (const r of results) {
    if (r.status === "fulfilled") {
      signals.push(...r.value);
    } else {
      failed++;
    }
  }

  if (failed > 0) {
    console.log(`[YouTube] ${failed}/${CHANNELS.length} channels failed`);
  }
  console.log(`[YouTube] Found ${signals.length} recent uploads`);
  return signals;
}
