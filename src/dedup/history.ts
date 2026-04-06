import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { VideoBrief } from "../types.js";

const DATA_DIR = join(import.meta.dirname, "../../data");
const HISTORY_PATH = join(DATA_DIR, "history.json");

interface HistoryEntry {
  topic: string;
  date: string;
}

export async function loadRecentTopics(): Promise<string[]> {
  try {
    const data = await readFile(HISTORY_PATH, "utf-8");
    const entries = JSON.parse(data) as HistoryEntry[];
    // Only return topics from the last 14 days
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    return entries
      .filter((e) => new Date(e.date).getTime() > cutoff)
      .map((e) => e.topic);
  } catch {
    return [];
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
