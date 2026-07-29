// Shared types — aligns API data shapes with UI models

export type NavKey = 'inbox' | 'dashboard' | 'pipeline' | 'scheduler' | 'analytics' | 'settings';

export type ThemePage = {
  id: string;
  name: string;
  niche: string;
  nicheId: string;       // niche_id from DB
  status: 'active' | 'paused';
  accent: string;
  posts: number;
  followers: string;
  /** 'manual' means ContentLoop doesn't look for topics for this page. */
  discovery?: 'auto' | 'manual';
};

export type SuggestedFormat = 'post' | 'carousel' | 'reel';
export type FormatConfidence = 'user' | 'llm' | 'rule' | 'page_default' | 'learned';

export type Topic = {
  id: string;
  title: string;
  keywords: string[];
  sources: string[];
  score: number | null;
  scoreBreakdown?: { learnedBoost?: number } | null;
  decision: string | null;
  state: string;
  suggestedFormat: SuggestedFormat | null;
  formatConfidence: FormatConfidence | null;
  lastSeenAt?: string;
  sourceUrl?: string | null;
  // UI-side fields (from mock / enriched API)
  platform?: 'reddit' | 'twitter' | 'trends' | 'rss';
  tags?: string[];
  status?: 'review' | 'approved' | 'scheduled' | 'posted';
};

export type ContentItem = {
  id: string;
  type: 'post' | 'reel' | 'carousel';
  status: string;
  payload: any;
  qa_result: any;
  topic_title: string;
  page_name: string;
  platform: string;
  handle: string;
};

export type Stats = {
  topics: number;
  selected_topics: number;
  qa_ready: number;
  approved: number;
  scheduled: number;
  posted: number;
  // Today deltas
  topics_today: number;
  selected_today: number;
  qa_ready_today: number;
  approved_today: number;
  posted_today: number;
  next_post_at: string | null;
};

export type SchedulerSlot = {
  id: string;
  title: string;
  time: string;
  type: 'Carousel' | 'Reel' | 'Post';
  status: 'posted' | 'scheduled';
};

export type PublishJob = {
  id:               string;
  platform:         string;
  status:           'pending' | 'scheduled' | 'publishing' | 'published' | 'failed';
  scheduled_at:     string | null;
  published_at:     string | null;
  external_post_id: string | null;
  external_url:     string | null;
  error:            string | null;
  created_at:       string;
  updated_at:       string;
  /** True when nothing was actually sent — validation only. */
  dry_run?: boolean;
};

export type PublishPlatformInfo = {
  connected: boolean;
  label:     string;
  icon:      string;
};

export type AnalyticsData = {
  views: number[];
  saves: number[];
  follows: number[];
  months: string[];
  topPosts: { title: string; views: string; saves: string; type: string }[];
};

// ── Inbox (Sprint D-UI) ──────────────────────────────────────────────────
export type InboxDraftItem = {
  kind: 'draft'; contentItemId: string; type: 'post' | 'carousel' | 'reel';
  pageId: string; pageName: string; platform: string;
  topic: Topic; hook: string; formattedCaption: string;
  imageUrl: string | null; createdAt: string;
};
export type InboxFailedItem = {
  kind: 'failed_publish'; publishJobId: string; contentItemId: string;
  pageId: string; pageName: string; platform: string; topicTitle: string;
  error: string | null; scheduledAt: string | null;
};
export type InboxActivity = {
  id: string; kind: 'cross_post' | 'fast_track' | 'recycle' | 'trend_alert' | 'posted';
  title: string; createdAt: string; pageName: string | null;
  outcome?: { engagementRate: number; nicheAvg: number };
};
export type InboxData = {
  needsYou: Array<InboxDraftItem | InboxFailedItem>;
  activity: InboxActivity[];
  digest: { postedSinceYesterday: number; automationSinceYesterday: number; topicsScoredSinceYesterday: number };
  nextScheduled: Array<{ publishJobId: string; topicTitle: string; pageName: string; platform: string; scheduledAt: string }>;
};
