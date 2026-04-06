import { createHash } from "crypto";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import type { RawSignal } from "../types.js";

const DATA_DIR = join(import.meta.dirname, "../../data");
const SEEN_URLS_PATH = join(DATA_DIR, "seen-urls.json");

// Stop words to strip for semantic fingerprinting
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "it", "in", "on", "at", "to", "for",
  "of", "and", "or", "but", "not", "with", "from", "by", "as",
  "this", "that", "was", "are", "be", "has", "had", "have", "do",
  "does", "did", "will", "would", "could", "should", "may", "might",
  "i", "you", "we", "they", "he", "she", "my", "your", "our",
  "show", "hn", "ask",
]);

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

/** Normalize URL: strip UTM params, trailing slash, lowercase hostname */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.toLowerCase();
    // Strip tracking params
    for (const param of [...u.searchParams.keys()]) {
      if (param.startsWith("utm_") || param === "ref" || param === "source") {
        u.searchParams.delete(param);
      }
    }
    // Strip trailing slash
    let href = u.href;
    if (href.endsWith("/")) href = href.slice(0, -1);
    return href;
  } catch {
    return url.toLowerCase().replace(/\/+$/, "");
  }
}

/** Semantic fingerprint: lowercase → strip stop words → sort → hash */
function semanticFingerprint(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .sort();
  return sha256(words.join(" "));
}

async function loadSeenUrls(): Promise<Set<string>> {
  try {
    const data = await readFile(SEEN_URLS_PATH, "utf-8");
    const arr = JSON.parse(data) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

async function saveSeenUrls(seen: Set<string>): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  // Keep last 10,000 entries to prevent unbounded growth
  const arr = [...seen].slice(-10_000);
  await writeFile(SEEN_URLS_PATH, JSON.stringify(arr, null, 2));
}

export interface DedupResult {
  signals: RawSignal[];
  duplicatesRemoved: number;
}

/**
 * Deduplicate signals by URL hash + semantic fingerprint.
 * Persists seen URLs across runs.
 */
export async function dedup(signals: RawSignal[]): Promise<DedupResult> {
  const seenUrls = await loadSeenUrls();
  const initialSize = seenUrls.size;

  const seenFingerprints = new Set<string>();
  const deduplicated: RawSignal[] = [];

  for (const signal of signals) {
    // Layer 1: URL dedup
    const urlHash = sha256(normalizeUrl(signal.url));
    if (seenUrls.has(urlHash)) continue;

    // Layer 2: Semantic fingerprint dedup
    const fp = semanticFingerprint(signal.title);
    if (seenFingerprints.has(fp)) continue;

    seenUrls.add(urlHash);
    seenFingerprints.add(fp);
    deduplicated.push(signal);
  }

  await saveSeenUrls(seenUrls);

  const duplicatesRemoved = signals.length - deduplicated.length;
  console.log(
    `[Dedup] ${signals.length} → ${deduplicated.length} signals (${duplicatesRemoved} duplicates removed, ${seenUrls.size - initialSize} new URLs persisted)`
  );

  return { signals: deduplicated, duplicatesRemoved };
}
