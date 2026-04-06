import type { RawSignal, SourceType } from "../types.js";
import { poll as pollHN } from "./hackernews.js";
import { poll as pollReddit } from "./reddit.js";
import { poll as pollGitHub } from "./github-trending.js";
import { poll as pollGoogleNews } from "./google-news.js";
import { poll as pollTwitter } from "./twitter.js";
import { poll as pollBluesky } from "./bluesky.js";
import { poll as pollProductHunt } from "./product-hunt.js";
import { poll as pollYouTube } from "./youtube.js";

interface SourceModule {
  name: SourceType;
  poll: () => Promise<RawSignal[]>;
}

const ALL_SOURCES: SourceModule[] = [
  { name: "hackernews", poll: pollHN },
  { name: "reddit", poll: pollReddit },
  { name: "github", poll: pollGitHub },
  { name: "google-news", poll: pollGoogleNews },
  { name: "twitter", poll: pollTwitter },
  { name: "twitter", poll: pollBluesky }, // Bluesky grouped as social signals
  { name: "product-hunt", poll: pollProductHunt },
  { name: "youtube", poll: pollYouTube },
];

export async function pollAll(
  filter?: SourceType[]
): Promise<RawSignal[]> {
  const sources = filter
    ? ALL_SOURCES.filter((s) => filter.includes(s.name))
    : ALL_SOURCES;

  console.log(
    `\nPolling ${sources.length} source(s): ${sources.map((s) => s.name).join(", ")}\n`
  );

  const results = await Promise.allSettled(
    sources.map(async (s) => {
      const start = Date.now();
      const signals = await s.poll();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      console.log(`[${s.name}] Done in ${elapsed}s — ${signals.length} signals\n`);
      return signals;
    })
  );

  const allSignals: RawSignal[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      allSignals.push(...r.value);
    } else {
      console.error(`Source failed:`, r.reason);
    }
  }

  console.log(`Total raw: ${allSignals.length} signals from ${sources.length} source(s)\n`);
  return allSignals;
}
