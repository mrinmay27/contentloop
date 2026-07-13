import { Worker } from "bullmq";
import { env } from "../config/env.js";
import { configStore } from "../config/configStore.js";
import { classifyNiche } from "../domain/niche-taxonomy.js";
import { scoreTopic } from "../domain/scoring.js";
import { generateContent } from "../services/content-generator.js";
import { ingestForNiche } from "../services/ingestion/index.js";
import { runQualityGate } from "../services/qa.js";
import { nextAvailableSlot } from "../services/scheduler.js";
import { synthesizeReelAudio, saveSubtitles, resolveVoice } from "../services/tts.js";
import { sourceReelBackgrounds } from "../services/stockFootage.js";
import { renderVideo } from "../services/videoRenderer.js";
import { parseReelScript } from "../remotion/parseReelScript.js";
import {
  createContentItems,
  updateTopicFormat,
  getNiche,
  insertMetric,
  listApprovedContentWithoutJob,
  listNiches,
  listPages,
  listRecentTopicTitles,
  listScheduledTimesForPage,
  listScorableTopics,
  listSelectedTopicsWithoutContent,
  scheduleContentBatch,
  updateTopicScore,
  upsertRawTrend,
  // Media pipeline
  listReelsWithoutAudio,
  listReelsWithoutVideo,
  updateContentAudio,
  updateContentFootage,
  updateContentVideo,
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

// ── Media worker: TTS synthesis + stock footage sourcing ──────────────────────
new Worker(
  "media",
  async () => {
    const reels = await listReelsWithoutAudio();
    if (reels.length === 0) return;
    console.log(`[media] Processing ${reels.length} reels for TTS + footage`);

    for (const reel of reels) {
      try {
        const payload = reel.payload;
        if (!payload?.reel?.script) {
          console.log(`[media] Skipping reel ${reel.id} — no script in payload`);
          continue;
        }

        // 1. Synthesize TTS audio from the reel script
        const nicheCategory = reel.niche_name?.toLowerCase() ?? 'default';
        const voice = resolveVoice(undefined, nicheCategory, env.TTS_VOICE);
        const scriptText = `${payload.reel.hook}. ${payload.reel.script}. ${payload.reel.cta}`;

        const ttsResult = await synthesizeReelAudio(reel.id, scriptText, nicheCategory, {
          voice,
          rate: env.TTS_RATE,
        });

        // Save subtitles from word boundaries
        const srtPath = await saveSubtitles(reel.id, ttsResult.wordBoundaries);
        const srtUrl = `/media/${reel.id}/subtitles.srt`;

        // Persist audio info to DB
        await updateContentAudio(
          reel.id,
          `/media/${reel.id}/audio.mp3`,
          ttsResult.durationSec,
          srtUrl,
          ttsResult.voiceName,
          ttsResult.wordBoundaries,
        );

        // 2. Source stock footage backgrounds (if Pexels key available)
        const keywords = reel.keywords ?? [];
        const slides = parseReelScript(scriptText);
        const footage = await sourceReelBackgrounds(reel.id, keywords, slides.length);

        if (footage.length > 0) {
          await updateContentFootage(reel.id, footage);
        }

        console.log(`[media] ✓ Reel ${reel.id}: audio ${ttsResult.durationSec.toFixed(1)}s, ${footage.length} backgrounds`);
      } catch (err: any) {
        console.error(`[media] ✗ Failed processing reel ${reel.id}: ${err.message}`);
      }
    }
  },
  { connection, concurrency: 1 }, // Lower concurrency — TTS is network-bound
);

// ── Render worker: Remotion video rendering + audio muxing ────────────────────
new Worker(
  "render",
  async () => {
    const reels = await listReelsWithoutVideo();
    if (reels.length === 0) return;
    console.log(`[render] Processing ${reels.length} reels for video rendering`);

    for (const reel of reels) {
      try {
        await updateContentVideo(reel.id, null, 'rendering');

        const payload = reel.payload;
        const scriptText = `${payload?.reel?.hook ?? ''}. ${payload?.reel?.script ?? ''}. ${payload?.reel?.cta ?? ''}`;
        const slides = parseReelScript(scriptText);

        // Resolve background images from footage_urls
        const footageUrls: string[] = (reel.footage_urls ?? [])
          .map((f: any) => f.localPath)
          .filter(Boolean);

        // Resolve brand from page
        const brand = typeof reel.brand === 'string' ? JSON.parse(reel.brand) : (reel.brand ?? {});
        const accent = brand.colors?.[0] ?? '#F5A623';

        // Audio path
        const audioPath = reel.audio_url
          ? `${process.cwd()}/data/media/${reel.id}/audio.mp3`
          : undefined;

        // Subtitle path (from TTS word boundaries)
        const subtitlePath = reel.subtitle_url
          ? `${process.cwd()}/data/media/${reel.id}/subtitles.srt`
          : undefined;

        // Aspect ratio: derive from platform or payload override
        const aspect = reel.platform === 'youtube_shorts' ? 'portrait' as const
          : (payload?.reelTarget === 'youtube_shorts' ? 'portrait' as const : 'portrait' as const);

        const result = await renderVideo({
          contentId: reel.id,
          slides,
          handle: reel.handle ?? '@page',
          accent,
          target: reel.platform === 'youtube_shorts' ? 'youtube_shorts' : 'instagram',
          backgroundImages: footageUrls,
          audioPath,
          bgm: env.BGM_MODE,
          bgmVolume: env.BGM_VOLUME,
          aspect,
          transition: 'fade',
          subtitlePath,
        });

        await updateContentVideo(reel.id, result.publicUrl, 'done');
        console.log(`[render] ✓ Video rendered for ${reel.id}: ${result.durationSec.toFixed(1)}s`);
      } catch (err: any) {
        console.error(`[render] ✗ Failed rendering reel ${reel.id}: ${err.message}`);
        await updateContentVideo(reel.id, null, 'failed');
      }
    }
  },
  { connection, concurrency: 1 }, // Rendering is CPU-heavy — one at a time
);

new Worker(
  "schedule",
  async () => {
    const { formatCaption } = await import("../services/platformFormatter.js");
    const approved = await listApprovedContentWithoutJob();
    for (const item of approved) {
      const existing = await listScheduledTimesForPage(item.page_id);
      const slot = nextAvailableSlot(existing);
      const payload = item.payload ?? {};
      const formattedCaption = formatCaption({
        platform: item.platform,
        hook: payload.hook ?? "",
        caption: payload.caption ?? "",
        hashtags: payload.hashtags ?? [],
      });
      await scheduleContentBatch([{
        contentItemId: item.id,
        pageId: item.page_id,
        platform: item.platform,
        scheduledAt: slot,
        formattedCaption,
      }]);
    }
  },
  workerOptions
);

new Worker(
  "post",
  async () => {
    const { publishDueJobs } = await import("../services/platforms/publisher.js");
    const published = await publishDueJobs(env.POSTING_DRY_RUN);
    if (published > 0) console.log(`[post] Published ${published} due job(s)`);
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
console.log(`Worker running in ${env.NODE_ENV} mode — queues: ingest, score, generate, media, render, schedule, post, analyze`);

