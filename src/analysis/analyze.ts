import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts.js";
import type { RawSignal, VideoBrief } from "../types.js";

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
                angle: {
                  type: "string" as const,
                  description: "The specific spin",
                },
                title: {
                  type: "string" as const,
                  description: "Video title for this angle",
                },
                hook: {
                  type: "string" as const,
                  description: "Curiosity hook that opens a loop",
                },
                thumbnailConcept: {
                  type: "string" as const,
                  description:
                    "Visual concept (90% psychology) — what makes someone stop scrolling",
                },
                intros: {
                  type: "array" as const,
                  items: {
                    type: "object" as const,
                    properties: {
                      intro: {
                        type: "string" as const,
                        description: "First 2-3 sentences of the video",
                      },
                      payoff: {
                        type: "string" as const,
                        description:
                          "What the viewer secretly hopes to walk away with",
                      },
                    },
                    required: ["intro", "payoff"],
                  },
                },
                buildProject: {
                  type: "string" as const,
                  description: "Concrete thing to build on camera",
                },
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
            required: [
              "buildability",
              "timeliness",
              "virality",
              "composite",
            ],
          },
          tags: {
            type: "array" as const,
            items: { type: "string" as const },
          },
        },
        required: [
          "topic",
          "whyNow",
          "sources",
          "angles",
          "scores",
          "tags",
        ],
      },
    },
  },
  required: ["briefs"],
};

function formatSignalsForPrompt(signals: RawSignal[]): string {
  return signals
    .map((s, i) => {
      const engagement = [
        s.engagementMetrics.upvotes && `${s.engagementMetrics.upvotes} upvotes`,
        s.engagementMetrics.stars && `${s.engagementMetrics.stars} stars`,
        s.engagementMetrics.comments &&
          `${s.engagementMetrics.comments} comments`,
      ]
        .filter(Boolean)
        .join(", ");

      return [
        `[${i + 1}] [${s.sourceType}] ${s.title}`,
        `    URL: ${s.url}`,
        engagement && `    Engagement: ${engagement}`,
        s.publishedAt && `    Published: ${s.publishedAt}`,
        s.tags.length > 0 && `    Tags: ${s.tags.join(", ")}`,
        s.body && `    Body: ${s.body.slice(0, 200)}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

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

  // Cap signals to avoid huge prompts — take top signals by engagement
  const sorted = [...signals].sort((a, b) => {
    const aScore =
      (a.engagementMetrics.upvotes ?? 0) + (a.engagementMetrics.stars ?? 0);
    const bScore =
      (b.engagementMetrics.upvotes ?? 0) + (b.engagementMetrics.stars ?? 0);
    return bScore - aScore;
  });
  const capped = sorted.slice(0, 100);

  console.log(
    `[Analysis] Sending ${capped.length} signals to Claude for analysis...`
  );

  const signalsSummary = formatSignalsForPrompt(capped);
  const userPrompt = buildUserPrompt(signalsSummary, recentTopics);

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

  // Extract tool use result
  const toolBlock = response.content.find((b) => b.type === "tool_use");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    throw new Error("Claude did not return structured output");
  }

  const result = toolBlock.input as { briefs: VideoBrief[] };

  console.log(
    `[Analysis] Generated ${result.briefs.length} video briefs`
  );

  return result.briefs;
}
