import type { RawSignal, VideoBrief } from "../types.js";

const WEIGHTS = {
  buildability: 0.35,
  timeliness: 0.35,
  virality: 0.3,
};

function clamp(value: number, min = 1, max = 10): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Apply heuristic adjustments on top of LLM scores.
 * LLM gives subjective assessment; heuristics add objective signal.
 */
export function applyHeuristics(
  brief: VideoBrief,
  allSignals: RawSignal[]
): VideoBrief {
  let { buildability, timeliness, virality } = brief.scores;

  // --- Buildability boosts ---
  const hasGitHubSource = brief.sources.some((s) => s.source === "github");
  if (hasGitHubSource) buildability += 2; // It's literally a repo you can build with

  const text = [brief.topic, ...brief.sources.map((s) => s.snippet)]
    .join(" ")
    .toLowerCase();
  if (/\b(api|sdk|open.?source|framework|library|cli|npm|pip)\b/.test(text)) {
    buildability += 1;
  }
  // Light penalty for pure opinion — but don't crush it, reaction videos are valid
  if (
    /\b(opinion|commentary|editorial|rant)\b/.test(text) &&
    !hasGitHubSource
  ) {
    buildability -= 1;
  }

  // --- Timeliness boosts ---
  // Multi-source bonus: same topic appearing on multiple platforms
  const sourceTypes = new Set(brief.sources.map((s) => s.source));
  if (sourceTypes.size >= 3) timeliness += 2;
  else if (sourceTypes.size >= 2) timeliness += 1;

  // Age factor from freshest source
  const freshest = brief.sources
    .map((s) => {
      // Try to find the matching raw signal for publishedAt
      const match = allSignals.find((sig) => sig.url === s.url);
      return match?.publishedAt ? new Date(match.publishedAt).getTime() : 0;
    })
    .filter((t) => t > 0)
    .sort((a, b) => b - a)[0];

  if (freshest) {
    const hoursAgo = (Date.now() - freshest) / (1000 * 60 * 60);
    if (hoursAgo < 6) timeliness += 2;
    else if (hoursAgo < 12) timeliness += 1;
    else if (hoursAgo > 168) timeliness -= 2; // Older than a week
  }

  // --- Virality boosts ---
  const bigBrands =
    /\b(openai|anthropic|google|meta|microsoft|apple|nvidia)\b/i;
  if (bigBrands.test(text)) virality += 1;

  if (/\b(leaked?|controversy|drama|banned|killed|dead|broken)\b/i.test(text)) {
    virality += 1;
  }

  // Total engagement across sources
  const totalEngagement = allSignals
    .filter((s) => brief.sources.some((src) => src.url === s.url))
    .reduce(
      (sum, s) =>
        sum +
        (s.engagementMetrics.upvotes ?? 0) +
        (s.engagementMetrics.stars ?? 0),
      0
    );
  if (totalEngagement > 5000) virality += 2;
  else if (totalEngagement > 1000) virality += 1;

  // Clamp and compute composite
  buildability = clamp(buildability);
  timeliness = clamp(timeliness);
  virality = clamp(virality);

  const composite = parseFloat(
    (
      buildability * WEIGHTS.buildability +
      timeliness * WEIGHTS.timeliness +
      virality * WEIGHTS.virality
    ).toFixed(1)
  );

  return {
    ...brief,
    scores: { buildability, timeliness, virality, composite },
  };
}

/**
 * Extract the primary entity (tool/company/product) from a topic string.
 * Used for diversity grouping — e.g., "Claude Code token issues" → "claude code"
 */
function extractEntity(topic: string): string {
  const lower = topic.toLowerCase();

  // Known multi-word entities (order matters — check longer names first)
  const knownEntities = [
    "claude code",
    "cursor ai",
    "github copilot",
    "google gemini",
    "open interpreter",
    "stable diffusion",
    "hugging face",
    "visual studio code",
    "vs code",
    "open ai",
    "openai",
    "anthropic",
    "deepseek",
    "mistral",
    "gemini",
    "claude",
    "cursor",
    "copilot",
    "chatgpt",
    "midjourney",
    "perplexity",
    "windsurf",
    "replit",
    "vercel",
    "supabase",
    "meta",
    "google",
    "apple",
    "microsoft",
    "nvidia",
  ];

  for (const entity of knownEntities) {
    if (lower.includes(entity)) return entity;
  }

  // Fallback: first two words of the topic (rough heuristic)
  return lower.split(/\s+/).slice(0, 2).join(" ");
}

/**
 * Apply diminishing returns: when multiple briefs share the same entity,
 * the 2nd gets -1.0, 3rd gets -2.0, etc. on composite score.
 */
function applyDiminishingReturns(briefs: VideoBrief[]): VideoBrief[] {
  const entityCount = new Map<string, number>();

  return briefs.map((brief) => {
    const entity = extractEntity(brief.topic);
    const count = entityCount.get(entity) ?? 0;
    entityCount.set(entity, count + 1);

    if (count === 0) return brief; // First brief for this entity — no penalty

    const penalty = count * 1.0; // 2nd = -1.0, 3rd = -2.0, etc.
    const composite = parseFloat(
      Math.max(1, brief.scores.composite - penalty).toFixed(1)
    );

    return {
      ...brief,
      scores: { ...brief.scores, composite },
    };
  });
}

/**
 * Greedy diversity selection: pick briefs top-down, but cap at MAX_PER_ENTITY
 * per entity in the final output. Remaining briefs fill from the next best topics.
 */
const MAX_PER_ENTITY = 2;

function diversify(briefs: VideoBrief[]): VideoBrief[] {
  const entityCount = new Map<string, number>();
  const selected: VideoBrief[] = [];
  const overflow: VideoBrief[] = [];

  for (const brief of briefs) {
    const entity = extractEntity(brief.topic);
    const count = entityCount.get(entity) ?? 0;

    if (count < MAX_PER_ENTITY) {
      selected.push(brief);
      entityCount.set(entity, count + 1);
    } else {
      overflow.push(brief);
    }
  }

  // Append overflow at the end (still available in Notion, just ranked lower)
  return [...selected, ...overflow];
}

/** Score and rank all briefs */
export function scoreAndRank(
  briefs: VideoBrief[],
  allSignals: RawSignal[]
): VideoBrief[] {
  const scored = briefs
    .map((b) => applyHeuristics(b, allSignals))
    .sort((a, b) => b.scores.composite - a.scores.composite);

  // Apply diminishing returns for repeated entities, then re-sort
  const penalized = applyDiminishingReturns(scored).sort(
    (a, b) => b.scores.composite - a.scores.composite
  );

  // Final diversity pass: cap per-entity representation
  return diversify(penalized);
}
