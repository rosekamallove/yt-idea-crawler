import type { RawSignal } from "../types.js";
import { config, matchesAIKeywords } from "../config.js";

const GITHUB_API = "https://api.github.com";

// Topics to search for
const SEARCH_QUERIES = [
  "AI agent",
  "LLM tool",
  "AI coding",
  "vibe coding",
  "Claude",
  "AI developer tool",
  "local LLM",
  "AI SDK",
];

interface GitHubRepo {
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  topics: string[];
  created_at: string;
  owner: { login: string };
}

interface GitHubSearchResult {
  items: GitHubRepo[];
}

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

async function searchRepos(query: string): Promise<GitHubRepo[]> {
  const since = getDateDaysAgo(7);
  const q = encodeURIComponent(`${query} created:>${since} stars:>20`);
  const url = `${GITHUB_API}/search/repositories?q=${q}&sort=stars&order=desc&per_page=30`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "yt-idea-crawler/0.1",
  };

  // Only add auth if it's a real token, not a placeholder
  if (config.githubToken && !config.githubToken.startsWith("ghp_...")) {
    headers["Authorization"] = `Bearer ${config.githubToken}`;
  }

  const res = await fetch(url, { headers });

  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as GitHubSearchResult;
  return json.items;
}

function toRawSignal(repo: GitHubRepo): RawSignal {
  return {
    sourceType: "github",
    title: `${repo.full_name}: ${repo.description ?? ""}`,
    url: repo.html_url,
    body: repo.description,
    author: repo.owner.login,
    engagementMetrics: {
      stars: repo.stargazers_count,
    },
    publishedAt: repo.created_at,
    tags: [
      ...(repo.topics ?? []),
      ...(repo.language ? [repo.language] : []),
    ],
  };
}

export async function poll(): Promise<RawSignal[]> {
  console.log(`[GitHub] Searching for trending AI repos (last 7 days)...`);

  const results = await Promise.allSettled(
    SEARCH_QUERIES.map((q) => searchRepos(q))
  );

  const seen = new Set<string>();
  const signals: RawSignal[] = [];

  for (const r of results) {
    if (r.status !== "fulfilled") {
      console.warn(`[GitHub] Search failed:`, r.reason);
      continue;
    }

    for (const repo of r.value) {
      if (seen.has(repo.full_name)) continue;
      seen.add(repo.full_name);

      // Extra keyword check on description + topics
      const text = [
        repo.full_name,
        repo.description,
        ...(repo.topics ?? []),
      ]
        .filter(Boolean)
        .join(" ");

      if (!matchesAIKeywords(text)) continue;

      signals.push(toRawSignal(repo));
    }
  }

  // Sort by stars descending
  signals.sort(
    (a, b) => (b.engagementMetrics.stars ?? 0) - (a.engagementMetrics.stars ?? 0)
  );

  console.log(`[GitHub] Found ${signals.length} trending AI repos`);
  return signals;
}
