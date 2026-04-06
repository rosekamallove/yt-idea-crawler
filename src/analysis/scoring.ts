import type { RawSignal, VideoBrief } from "../types.js";

const WEIGHTS = {
  buildability: 0.5,
  timeliness: 0.3,
  virality: 0.2,
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
  if (
    /\b(opinion|commentary|editorial|analysis|rant|drama)\b/.test(text) &&
    !hasGitHubSource
  ) {
    buildability -= 2;
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

/** Score and rank all briefs */
export function scoreAndRank(
  briefs: VideoBrief[],
  allSignals: RawSignal[]
): VideoBrief[] {
  return briefs
    .map((b) => applyHeuristics(b, allSignals))
    .sort((a, b) => b.scores.composite - a.scores.composite);
}
