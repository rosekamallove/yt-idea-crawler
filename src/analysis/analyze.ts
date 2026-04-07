import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import {
  CLUSTER_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  buildClusterUserPrompt,
  buildUserPrompt,
} from "./prompts.js";
import type { RawSignal, VideoBrief } from "../types.js";

// --- Types ---

interface TopicCluster {
  name: string;
  representativeSignalIndices: number[];
  totalSignalCount: number;
  sourceTypes: string[];
}

// --- Schemas ---

const CLUSTER_SCHEMA = {
  type: "object" as const,
  properties: {
    topics: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          name: {
            type: "string" as const,
            description: "Short descriptive topic name",
          },
          representativeSignalIndices: {
            type: "array" as const,
            items: { type: "number" as const },
            description: "Indices (1-based) of the 2-3 best signals for this topic",
          },
          totalSignalCount: {
            type: "number" as const,
            description: "Total number of signals in this cluster",
          },
          sourceTypes: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "Which platforms this appeared on",
          },
        },
        required: [
          "name",
          "representativeSignalIndices",
          "totalSignalCount",
          "sourceTypes",
        ],
      },
    },
  },
  required: ["topics"],
};

const VIDEO_BRIEF_SCHEMA = {
  type: "object" as const,
  properties: {
    briefs: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          topic: { type: "string" as const, description: "Core subject" },
          whyNow: {
            type: "string" as const,
            description: "Why this is timely",
          },
          sources: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                url: { type: "string" as const },
                title: { type: "string" as const },
                source: { type: "string" as const },
                snippet: {
                  type: "string" as const,
                  description: "Key quote or takeaway",
                },
              },
              required: ["url", "title", "source", "snippet"],
            },
          },
          angles: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                angle: { type: "string" as const },
                title: { type: "string" as const },
                hook: { type: "string" as const },
                thumbnailConcept: { type: "string" as const },
                intros: {
                  type: "array" as const,
                  items: {
                    type: "object" as const,
                    properties: {
                      intro: { type: "string" as const },
                      payoff: { type: "string" as const },
                    },
                    required: ["intro", "payoff"],
                  },
                },
                buildProject: { type: "string" as const },
                format: {
                  type: "string" as const,
                  enum: [
                    "tutorial",
                    "deep-dive",
                    "speed-build",
                    "comparison",
                    "reaction",
                  ],
                },
                estimatedBuildTime: { type: "string" as const },
              },
              required: [
                "angle",
                "title",
                "hook",
                "thumbnailConcept",
                "intros",
                "buildProject",
                "format",
                "estimatedBuildTime",
              ],
            },
          },
          scores: {
            type: "object" as const,
            properties: {
              buildability: { type: "number" as const },
              timeliness: { type: "number" as const },
              virality: { type: "number" as const },
              composite: { type: "number" as const },
            },
            required: ["buildability", "timeliness", "virality", "composite"],
          },
          tags: {
            type: "array" as const,
            items: { type: "string" as const },
          },
        },
        required: ["topic", "whyNow", "sources", "angles", "scores", "tags"],
      },
    },
  },
  required: ["briefs"],
};

// --- Formatting ---

/** Compact one-liner format for clustering (cheap pass) */
function formatSignalsCompact(signals: RawSignal[]): string {
  return signals
    .map((s, i) => {
      const eng =
        (s.engagementMetrics.upvotes ?? 0) + (s.engagementMetrics.stars ?? 0);
      const engStr = eng > 0 ? `${eng}` : "0";
      return `[${i + 1}] [${s.sourceType}] ${s.title} | ${engStr} pts | ${s.url}`;
    })
    .join("\n");
}

/** Rich format for brief generation (per-cluster) */
function formatClusterForPrompt(
  cluster: TopicCluster,
  signals: RawSignal[]
): string {
  const reps = cluster.representativeSignalIndices
    .map((idx) => signals[idx - 1]) // 1-based indices
    .filter(Boolean);

  const repLines = reps
    .map((s) => {
      const engagement = [
        s.engagementMetrics.upvotes && `${s.engagementMetrics.upvotes} upvotes`,
        s.engagementMetrics.stars && `${s.engagementMetrics.stars} stars`,
        s.engagementMetrics.comments && `${s.engagementMetrics.comments} comments`,
      ]
        .filter(Boolean)
        .join(", ");

      return [
        `  [${s.sourceType}] ${s.title}`,
        `    URL: ${s.url}`,
        engagement && `    Engagement: ${engagement}`,
        s.publishedAt && `    Published: ${s.publishedAt}`,
        s.body && `    Body: ${s.body.slice(0, 200)}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return (
    `TOPIC: "${cluster.name}"\n` +
    `Appeared on: ${cluster.sourceTypes.join(", ")} (${cluster.totalSignalCount} total signals)\n` +
    `Representative signals:\n${repLines}`
  );
}

// --- Pass 1: Cluster ---

async function clusterSignals(
  client: Anthropic,
  signals: RawSignal[]
): Promise<TopicCluster[]> {
  // Cap at 500 signals for Haiku context
  const capped = signals.slice(0, 500);

  console.log(
    `[Cluster] Pass 1: Sending ${capped.length} signals to Haiku for clustering...`
  );

  const summary = formatSignalsCompact(capped);
  const userPrompt = buildClusterUserPrompt(summary);

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    system: CLUSTER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    tools: [
      {
        name: "submit_clusters",
        description: "Submit the grouped topic clusters",
        input_schema: CLUSTER_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: "submit_clusters" },
  });

  const toolBlock = response.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("Haiku did not return structured clustering output");
  }

  const result = toolBlock.input as { topics: TopicCluster[] };

  console.log(
    `[Cluster] Identified ${result.topics.length} distinct topics from ${capped.length} signals`
  );

  // Log topic summary
  for (const t of result.topics) {
    console.log(
      `  - ${t.name} (${t.totalSignalCount} signals, ${t.sourceTypes.join("+")})`
    );
  }

  return result.topics;
}

// --- Pass 2: Generate Briefs ---

async function generateBriefs(
  client: Anthropic,
  clusters: TopicCluster[],
  signals: RawSignal[],
  recentTopics: string[]
): Promise<VideoBrief[]> {
  console.log(
    `\n[Analysis] Pass 2: Sending ${clusters.length} topics to Sonnet for brief generation...`
  );

  const clusteredSummary = clusters
    .map((c) => formatClusterForPrompt(c, signals))
    .join("\n\n---\n\n");

  const userPrompt = buildUserPrompt(clusteredSummary, recentTopics);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    tools: [
      {
        name: "submit_video_briefs",
        description:
          "Submit the analyzed video briefs with topics, angles, hooks, and scores",
        input_schema: VIDEO_BRIEF_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: "submit_video_briefs" },
  });

  const toolBlock = response.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("Sonnet did not return structured output");
  }

  const result = toolBlock.input as { briefs: VideoBrief[] };

  console.log(`[Analysis] Generated ${result.briefs.length} video briefs`);

  return result.briefs;
}

// --- Main Entry ---

export async function analyze(
  signals: RawSignal[],
  recentTopics: string[]
): Promise<VideoBrief[]> {
  if (!config.anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is required for analysis. Set it in .env"
    );
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  // Pass 1: Cluster signals into distinct topics (Haiku — cheap)
  const clusters = await clusterSignals(client, signals);

  // Pass 2: Generate video briefs from clusters (Sonnet — rich)
  const briefs = await generateBriefs(client, clusters, signals, recentTopics);

  return briefs;
}
