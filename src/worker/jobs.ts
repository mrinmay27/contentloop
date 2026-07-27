import fsSync from "node:fs";
import { env } from "../config/env.js";
import type { TopicDecision } from "../domain/types.js";
import { configStore } from "../config/configStore.js";
import { classifyNiche } from "../domain/niche-taxonomy.js";
import { scoreTopic, applySourceQualityOverrides } from "../domain/scoring.js";
import { applySourceDiversityCap, DEFAULT_MAX_PER_SOURCE } from "../domain/sourceDiversity.js";
import { applyAutomationOverrides } from "../domain/automation.js";
import { generateContent } from "../services/content-generator.js";
import { ingestForNiche } from "../services/ingestion/index.js";
import { runQualityGate } from "../services/qa.js";
import { nextAvailableSlot } from "../services/scheduler.js";
import { synthesizeReelAudio, saveSubtitles, resolveVoice } from "../services/tts.js";
import { sourceReelBackgrounds } from "../services/stockFootage.js";
import { renderVideo, renderCaptionedVideo } from "../services/videoRenderer.js";
import { resolveReelPath, rendererFor } from "../domain/reelPath.js";
import { parseReelScript } from "../remotion/parseReelScript.js";
import {
  createContentItems,
  updateTopicFormat,
  getNiche,
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

// Sprint U1 Task 6: apply user tuning overrides from the config store (JSON
// strings) before any queue processor runs, so every job sees the effective
// thresholds/multipliers from the first tick.
try {
  const at = configStore.get("AUTOMATION_THRESHOLDS");
  if (at) {
    applyAutomationOverrides(JSON.parse(at));
    console.log(`[config] automation overrides active: ${at}`);
  }
  const sq = configStore.get("SOURCE_QUALITY_OVERRIDES");
  if (sq) applySourceQualityOverrides(JSON.parse(sq));
} catch (err) { console.warn(`[config] invalid tuning overrides ignored: ${err}`); }

export async function ingest(): Promise<void> {
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
}

/** Max topics one source may put in a single scored batch's selected queue.
 *  Configurable via MAX_TOPICS_PER_SOURCE; 0 disables the cap entirely. */
function resolveMaxPerSource(): number {
  const raw = configStore.get('MAX_TOPICS_PER_SOURCE');
  const parsed = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(parsed)
    ? parsed
    : DEFAULT_MAX_PER_SOURCE;
}

export async function score(): Promise<void> {
  const { getLearnedSignals } = await import("../services/learningRepo.js");
  const { buildSemanticContext } = await import("../services/semanticScoring.js");
  const topics = await listScorableTopics();
  if (topics.length === 0) return;

  const nicheMap = new Map<string, NonNullable<Awaited<ReturnType<typeof getNiche>>>>();
  for (const topic of topics) {
    if (!nicheMap.has(topic.nicheId)) {
      const niche = await getNiche(topic.nicheId);
      if (niche) nicheMap.set(topic.nicheId, niche);
    }
  }

  const semanticByTopic = await buildSemanticContext(topics, nicheMap);
  const learnedCache = new Map<string, Awaited<ReturnType<typeof getLearnedSignals>>>();

  // Score first, persist after the diversity pass — otherwise a topic would be
  // written as selected and then immediately demoted in a second write.
  const scored: Array<{
    id: string; source: string | undefined; score: number;
    decision: TopicDecision; breakdown: ReturnType<typeof scoreTopic>;
  }> = [];

  for (const topic of topics) {
    const niche = nicheMap.get(topic.nicheId);
    if (!niche) continue;
    if (!learnedCache.has(topic.nicheId)) {
      learnedCache.set(topic.nicheId, await getLearnedSignals(topic.nicheId));
    }
    const recentTitles = await listRecentTopicTitles(topic.nicheId, topic.id);
    const breakdown = scoreTopic(
      topic, niche, recentTitles,
      learnedCache.get(topic.nicheId),
      semanticByTopic.get(topic.id)
    );
    scored.push({
      id: topic.id,
      source: topic.sources?.[0],
      score: breakdown.score,
      decision: breakdown.decision,
      breakdown,
    });
  }

  // Task 2.9: stop one prolific feed filling the whole selected queue.
  const capped = applySourceDiversityCap(scored, resolveMaxPerSource());
  let demoted = 0;
  for (const topic of capped) {
    if (topic.decision !== topic.breakdown.decision) demoted++;
    await updateTopicScore(topic.id, topic.score, topic.decision, topic.breakdown);
  }
  if (demoted > 0) {
    console.log(`[score] source diversity: demoted ${demoted} topic(s) to backup`);
  }

  try {
    const { detectTrendSpikes } = await import("../services/automation/trendAlerts.js");
    const alerts = await detectTrendSpikes(topics);
    if (alerts > 0) console.log(`[score] ${alerts} trend alert(s)`);
  } catch (err: any) {
    console.warn(`[score] trend alert detection failed: ${err?.message}`);
  }
}

export async function generate(): Promise<void> {
  const { getFormatSignals } = await import("../services/learningRepo.js");
  const { applyLearnedFormat } = await import("../domain/format-rules.js");
  const formatSignalsCache = new Map<string, Awaited<ReturnType<typeof getFormatSignals>>>();
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

    // Learned tiebreak: proven niche format overrides weak decisions
    if (finalFormat && finalConfidence && (finalConfidence === 'rule' || finalConfidence === 'page_default')) {
      if (!formatSignalsCache.has(topic.nicheId)) {
        formatSignalsCache.set(topic.nicheId, await getFormatSignals(topic.nicheId));
      }
      const learned = applyLearnedFormat(finalFormat, finalConfidence, formatSignalsCache.get(topic.nicheId)!);
      finalFormat = learned.format;
      finalConfidence = learned.confidence;
    }

    // Persist format decision to topic row before QA
    await updateTopicFormat(topic.id, finalFormat, finalConfidence);
    const nicheCategory = classifyNiche(niche.name, niche.keywords);
    const qa = runQualityGate(content, nicheCategory);
    await createContentItems(topic.id, pages, content, qa, finalFormat);
  }
}

// ── Media job: TTS synthesis + stock footage sourcing ──────────────────────
export async function media(): Promise<void> {
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
}

// ── Render job: Remotion video rendering + audio muxing ────────────────────
export async function render(): Promise<void> {
  const reels = await listReelsWithoutVideo();
  if (reels.length === 0) return;
  console.log(`[render] Processing ${reels.length} reels for video rendering`);

  for (const reel of reels) {
    try {
      const payload = reel.payload;

      // Which route made this reel decides which renderer runs. Without this
      // an uploaded clip was eligible to be re-rendered as a slideshow, which
      // would overwrite the creator's own footage.
      const path = resolveReelPath({ reelPath: payload?.reelPath, videoUrl: reel.video_url });
      if (rendererFor(path) === 'captioned') {
        const sourcePath = `${process.cwd()}/data/media/${reel.id}/source.mp4`;
        if (!fsSync.existsSync(sourcePath)) {
          console.log(`[render] ${reel.id}: ${path} path but no uploaded video yet — skipping`);
          continue;
        }
        await updateContentVideo(reel.id, null, 'rendering');
        // Probe the real length — passing 0 would fall back to a 10s default
        // and truncate or pad the creator's footage.
        const { probeVideo } = await import("../services/mediaProbe.js");
        const probe = await probeVideo(sourcePath);
        const srtPath = `${process.cwd()}/data/media/${reel.id}/captions.srt`;
        const captioned = await renderCaptionedVideo({
          contentId: reel.id,
          sourcePath,
          srt: fsSync.existsSync(srtPath) ? fsSync.readFileSync(srtPath, 'utf-8') : '',
          accent: (typeof reel.brand === 'string' ? JSON.parse(reel.brand) : reel.brand ?? {})?.colors?.[0] ?? '#F5A623',
          durationSec: probe?.durationSec ?? 10,
        });
        await updateContentVideo(reel.id, captioned.publicUrl, 'done');
        console.log(`[render] ✓ Captioned video for ${reel.id}: ${captioned.durationSec.toFixed(1)}s`);
        continue;
      }

      await updateContentVideo(reel.id, null, 'rendering');
      const scriptText = `${payload?.reel?.hook ?? ''}. ${payload?.reel?.script ?? ''}. ${payload?.reel?.cta ?? ''}`;
      const slides = parseReelScript(scriptText);

      // Resolve background media from footage_urls, keeping the kind so video
      // renders as video instead of being treated as a still. This mapping
      // previously dropped f.type, which is why kind never reached Remotion.
      // NOTE: localPath (absolute), not publicUrl — Remotion renders
      // server-side from the filesystem, not over HTTP.
      const backgroundMedia: Array<{ url: string; kind: 'image' | 'video' }> =
        (reel.footage_urls ?? [])
          .filter((f: any) => f.localPath)
          .map((f: any) => ({
            url: f.localPath,
            kind: f.type === 'video' ? 'video' as const : 'image' as const,
          }));

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
        backgroundMedia,
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
}

export async function schedule(): Promise<void> {
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
}

export async function post(): Promise<void> {
  const { publishDueJobs } = await import("../services/platforms/publisher.js");
  const published = await publishDueJobs(env.POSTING_DRY_RUN);
  if (published > 0) console.log(`[post] Published ${published} due job(s)`);
}

export async function analyze(): Promise<void> {
  const { runMetricsCapture } = await import("../services/metrics/index.js");
  const { runLearningStep } = await import("../services/learningService.js");
  const captured = await runMetricsCapture();
  if (captured > 0) console.log(`[analyze] Captured ${captured} metric snapshot(s)`);
  await runLearningStep();

  // Growth automation — after core capture+learn, individually shielded.
  try {
    const { runReactor } = await import("../services/automation/reactor.js");
    const fired = await runReactor();
    if (fired > 0) console.log(`[analyze] Reactor fired ${fired} action(s)`);
  } catch (err: any) {
    console.warn(`[analyze] reactor failed: ${err?.message}`);
  }

  try {
    const { runRecycler } = await import("../services/automation/recycler.js");
    const recycled = await runRecycler();
    if (recycled > 0) console.log(`[analyze] Recycled ${recycled} winner(s)`);
  } catch (err: any) {
    console.warn(`[analyze] recycler failed: ${err?.message}`);
  }
}

export const JOBS = { ingest, score, generate, media, render, schedule, post, analyze } as const;
export type JobName = keyof typeof JOBS;
export const JOB_NAMES = Object.keys(JOBS) as JobName[];

/** BullMQ concurrency per job (server mode). Values preserved from the
 *  original worker: media/render are resource-heavy, post/analyze must not
 *  overlap themselves (atomic claim + non-reentrant learn step). */
export const JOB_CONCURRENCY: Record<JobName, number> = {
  ingest: 3, score: 3, generate: 3, media: 1, render: 1, schedule: 3, post: 1, analyze: 1,
};
