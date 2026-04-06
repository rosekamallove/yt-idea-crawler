import RSSParser from "rss-parser";
import type { RawSignal } from "../types.js";

const parser = new RSSParser({ timeout: 8_000 });

// Nitter-like instances to try (most are unreliable — graceful degradation)
const INSTANCES = [
  "https://xcancel.com",
  "https://nitter.poast.org",
  "https://nitter.privacydev.net",
];

// Curated accounts: AI builders, tool creators, indie hackers
const ACCOUNTS = [
  "levelsio",
  "swyx",
  "kaboroevich",
  "mcaborkadam",
  "emollick",
  "AndrewYNg",
  "kaborarpathy",
  "simonw",
  "bindureddy",
  "skirano",
  "alexalbert__",
  "aabormasov",
  "shaborunselman",
  "ThePrimeagen",
  "t3dotgg",
  "aiaborjason",
  "sdand",
  "guillaumeaboratp",
  "raaboruchit",
  "dylan__tweets",
  "maborishikatsu",
  "mattshumer_",
  "amanrsanger",
  "mckaywrigley",
  "jxnlco",
  "sama",
  "demaborisrussak",
  "elaborad",
];

async function tryFetchRSS(
  account: string,
  instance: string
): Promise<RSSParser.Item[]> {
  const url = `${instance}/${account}/rss`;
  const feed = await parser.parseURL(url);
  return feed.items ?? [];
}

function toRawSignal(
  item: RSSParser.Item,
  account: string
): RawSignal {
  return {
    sourceType: "twitter",
    title: item.title ?? item.contentSnippet?.slice(0, 140) ?? "",
    url: item.link ?? "",
    body: item.contentSnippet ?? item.content ?? null,
    author: account,
    engagementMetrics: {},
    publishedAt: item.isoDate ?? null,
    tags: [account],
  };
}

export async function poll(): Promise<RawSignal[]> {
  console.log(
    `[Twitter] Trying ${INSTANCES.length} instances for ${ACCOUNTS.length} accounts...`
  );

  // Find a working instance first
  let workingInstance: string | null = null;
  for (const instance of INSTANCES) {
    try {
      // Test with a known active account
      await parser.parseURL(`${instance}/sama/rss`);
      workingInstance = instance;
      console.log(`[Twitter] Using instance: ${instance}`);
      break;
    } catch {
      console.log(`[Twitter] Instance down: ${instance}`);
    }
  }

  if (!workingInstance) {
    console.log(
      "[Twitter] All instances down — skipping. Consider using X API instead."
    );
    return [];
  }

  // Fetch all accounts from working instance
  const results = await Promise.allSettled(
    ACCOUNTS.map(async (account) => {
      const items = await tryFetchRSS(account, workingInstance);
      return items
        .filter((item) => {
          // Only tweets from last 3 days
          if (!item.isoDate) return true;
          const age = Date.now() - new Date(item.isoDate).getTime();
          return age < 3 * 24 * 60 * 60 * 1000;
        })
        .map((item) => toRawSignal(item, account));
    })
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
    console.log(`[Twitter] ${failed}/${ACCOUNTS.length} accounts failed`);
  }
  console.log(`[Twitter] Found ${signals.length} tweets`);
  return signals;
}
