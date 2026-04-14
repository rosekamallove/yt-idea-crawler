import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { VideoBrief } from "../types.js";

const DATA_DIR = join(import.meta.dirname, "../../data");
const HISTORY_PATH = join(DATA_DIR, "history.json");

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
  "has", "have", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "this", "that", "these", "those",
  "it", "its", "new", "how", "what", "why", "when", "who", "which",
  "all", "about", "into", "over", "after", "before", "between",
]);

/** Extract meaningful content words from a topic string */
function contentWords(topic: string): Set<string> {
  return new Set(
    topic
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
  );
}

/** Check if two topics are semantically similar (60%+ word overlap) */
function isSimilar(a: string, b: string, threshold = 0.6): boolean {
  const wordsA = contentWords(a);
  const wordsB = contentWords(b);
  if (wordsA.size === 0 || wordsB.size === 0) return false;

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }

  const smaller = Math.min(wordsA.size, wordsB.size);
  return overlap / smaller >= threshold;
}

interface HistoryEntry {
  topic: string;
  date: string;
}

/**
 * Load recent topics from history.
 * Returns both exact topic strings (for the LLM prompt) and a matcher function
 * that checks semantic similarity against the history.
 */
export async function loadRecentTopics(): Promise<{
  topics: string[];
  isCoveredRecently: (newTopic: string) => boolean;
}> {
  try {
    const data = await readFile(HISTORY_PATH, "utf-8");
    const entries = JSON.parse(data) as HistoryEntry[];
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const topics = entries
      .filter((e) => new Date(e.date).getTime() > cutoff)
      .map((e) => e.topic);

    return {
      topics,
      isCoveredRecently: (newTopic: string) =>
        topics.some((existing) => isSimilar(newTopic, existing)),
    };
  } catch {
    return { topics: [], isCoveredRecently: () => false };
  }
}

export async function saveTopics(briefs: VideoBrief[]): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });

  let existing: HistoryEntry[] = [];
  try {
    const data = await readFile(HISTORY_PATH, "utf-8");
    existing = JSON.parse(data) as HistoryEntry[];
  } catch {
    // No history yet
  }

  const now = new Date().toISOString();
  const newEntries = briefs.map((b) => ({ topic: b.topic, date: now }));

  // Keep last 30 days of history
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const merged = [...existing, ...newEntries].filter(
    (e) => new Date(e.date).getTime() > cutoff
  );

  await writeFile(HISTORY_PATH, JSON.stringify(merged, null, 2));
  console.log(
    `[History] Saved ${newEntries.length} new topics (${merged.length} total in history)`
  );
}
