export type QueueState =
  | "IDEA"
  | "SCORED"
  | "CONTENT_READY"
  | "QA_PASSED"
  | "SCHEDULED"
  | "POSTED"
  | "ANALYZED";

export type TopicDecision = "selected" | "backup" | "discarded";
export type Platform = "instagram" | "youtube_shorts";
export type ContentType = "reel" | "carousel";

/** Which format the system recommends for this topic */
export type SuggestedFormat = "post" | "carousel" | "reel";

/** Which decision tier set the format — higher trust = user > llm > rule > page_default */
export type FormatConfidence = "user" | "llm" | "rule" | "page_default";

export interface Topic {
  id: string;
  nicheId: string;
  title: string;
  keywords: string[];
  sources: string[];
  sourceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  velocity: number;
  score: number | null;
  decision: TopicDecision | null;
  state: QueueState;
  /** LLM / rule / page-default suggested content format */
  suggestedFormat: SuggestedFormat | null;
  /** Which tier made the format decision */
  formatConfidence: FormatConfidence | null;
}

export interface Niche {
  id: string;
  name: string;
  keywords: string[];
  monetizationKeywords: string[];
  negativeKeywords: string[];
  targetPersona: string;
}

export interface Page {
  id: string;
  nicheId: string;
  name: string;
  platform: Platform;
  handle: string;
  brand: {
    colors: string[];
    fonts: string[];
    logoPlacement: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  };
}

export interface RawTrend {
  source: "google_trends" | "reddit" | "rss" | "twitter" | "google_news" | "medium" | "hacker_news";
  title: string;
  url?: string;
  keywords: string[];
  sourcePublishedAt?: Date;
  observedAt: Date;
  engagementHint?: number;
}

export interface GeneratedContent {
  reelScripts: Array<{
    title: string;
    hook: string;
    script: string;
    cta: string;
    hookScore: number;
  }>;
  carousel: Array<{
    slide: number;
    title: string;
    body: string;
  }>;
  captions: Record<Platform, string>;
  hashtags: string[];
}

export interface QaResult {
  passed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    reason: string;
  }>;
}
