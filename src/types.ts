export type SourceType =
  | "hackernews"
  | "reddit"
  | "github"
  | "google-news"
  | "twitter"
  | "product-hunt"
  | "youtube";

export interface RawSignal {
  sourceType: SourceType;
  title: string;
  url: string;
  body: string | null;
  author: string | null;
  engagementMetrics: {
    upvotes?: number;
    comments?: number;
    stars?: number;
    retweets?: number;
  };
  publishedAt: string | null; // ISO date
  tags: string[];
}

export interface SourceRef {
  url: string;
  title: string;
  source: SourceType;
  snippet: string;
}

export interface IntroOption {
  intro: string;
  payoff: string;
}

export type VideoFormat =
  | "tutorial"
  | "deep-dive"
  | "speed-build"
  | "comparison"
  | "reaction";

export interface Angle {
  angle: string;
  title: string;
  hook: string;
  thumbnailConcept: string;
  intros: IntroOption[];
  buildProject: string;
  format: VideoFormat;
  estimatedBuildTime: string;
}

export interface ScoreBreakdown {
  buildability: number;
  timeliness: number;
  virality: number;
  composite: number;
}

export interface VideoBrief {
  topic: string;
  whyNow: string;
  sources: SourceRef[];
  angles: Angle[];
  scores: ScoreBreakdown;
  tags: string[];
}
