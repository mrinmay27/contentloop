import { Worker } from "bullmq";
import { env } from "../config/env.js";
import { configStore } from "../config/configStore.js";
import { classifyNiche } from "../domain/niche-taxonomy.js";
import { scoreTopic } from "../domain/scoring.js";
import { generateContent } from "../services/content-generator.js";
import { ingestForNiche } from "../services/ingestion/index.js";
import { publishPost } from "../services/platforms/posting.js";
import { runQualityGate } from "../services/qa.js";
import { nextAvailableSlot } from "../services/scheduler.js";
import {
  createContentItems,
  updateTopicFormat,
  createPost,
  getNiche,
  insertMetric,
  listApprovedContentWithoutPost,
  listNiches,
  listPages,
  listPosts,
  listRecentTopicTitles,
  listScheduledTimesForPage,
  listScorableTopics,
  listSelectedTopicsWithoutContent,
  markPostPosted,
  updateTopicScore,
  upsertRawTrend
} from "../services/repositories.js";
import { connection, enqueueDailyPipeline } from "./queues.js";

const workerOptions = { connection, concurrency: 3 };

new Worker(
  "ingest",
  async () => {
    const niches = await listNiches();
    for (const niche of niches) {
      // Pass first page ID so tag-generator cache is consulted (Task 2.0)
      const pages = await listPages(niche.id);
      const pageId = pages[0]?.id;
      const trends = await ingestForNiche(niche, pageId);
      for (const trend of trends) {
        await upsertRawTrend(niche.id, trend);
      }
    }
  },
  workerOptions
);

new Worker(
  "score",
  async () => {
    const topics = await listScorableTopics();
    for (const topic of topics) {
      const niche = await getNiche(topic.nicheId);
      if (!niche) continue;
      const recentTitles = await listRecentTopicTitles(topic.nicheId, topic.id);
      const breakdown = scoreTopic(topic, niche, recentTitles);
      await updateTopicScore(topic.id, breakdown.score, breakdown.decision, breakdown);
    }
  },
  workerOptions
);

new Worker(
  "generate",
  async () => {
    const topics = await listSelectedTopicsWithoutContent();
    for (const topic of topics) {
      const niche = await getNiche(topic.nicheId);
      if (!niche) continue;
      const pages = await listPages(topic.nicheId);
      const { content, suggestedFormat, formatConfidence } = await generateContent(topic, niche, pages);

      // Task 1.4: Apply page_default format if LLM/rules returned nothing
      let finalFormat   = suggestedFormat;
      let finalConfidence = formatConfidence;
      if (!finalFormat || finalConfidence === 'page_default') {
        const cfgDefault = configStore.get('DEFAULT_FORMAT');
        if (cfgDefault && cfgDefault !== 'auto') {
          finalFormat     = cfgDefault as typeof suggestedFormat;
          finalConfidence = 'page_default';
        }
      }

      // Persist format decision to topic row before QA
      await updateTopicFormat(topic.id, finalFormat, finalConfidence);
      const nicheCategory = classifyNiche(niche.name, niche.keywords);
      const qa = runQualityGate(content, nicheCategory);
      await createContentItems(topic.id, pages, content, qa);
    }
  },
  workerOptions
);

new Worker(
  "schedule",
  async () => {
    const approved = await listApprovedContentWithoutPost();
    for (const item of approved) {
      const existing = await listScheduledTimesForPage(item.page_id);
      const slot = nextAvailableSlot(existing);
      await createPost(item.id, item.page_id, item.platform, slot, env.POSTING_DRY_RUN);
    }
  },
  workerOptions
);

new Worker(
  "post",
  async () => {
    const duePosts = (await listPosts("SCHEDULED")).filter((post) => post.scheduled_at && new Date(post.scheduled_at) <= new Date());
    for (const post of duePosts) {
      const externalId = await publishPost({
        postId: post.id,
        platform: post.platform,
        payload: post.payload,
        pageHandle: post.handle
      });
      await markPostPosted(post.id, externalId);
    }
  },
  workerOptions
);

new Worker(
  "analyze",
  async () => {
    const posted = await listPosts("POSTED");
    for (const post of posted) {
      await insertMetric(post.id, {
        views1h: Math.floor(Math.random() * 300),
        views24h: Math.floor(Math.random() * 2500),
        saves: Math.floor(Math.random() * 80),
        followsGained: Math.floor(Math.random() * 20)
      });
    }
  },
  workerOptions
);

await enqueueDailyPipeline();
console.log(`Worker running in ${env.NODE_ENV} mode`);
