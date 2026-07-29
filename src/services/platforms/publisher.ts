import { query } from '../../db/pool.js';
import type { PublishPlatform } from '../platformFormatter.js';
import * as instagram from '../instagram.js';

export interface PublishJobInput {
  jobId:            string;
  contentItemId:    string;
  pageId:           string;
  platform:         PublishPlatform;
  formattedCaption: string;
  imageUrls:        string[];   // first image used for single-image posts
  /** Rendered MP4 for video platforms. Null until the render job has run. */
  videoUrl:         string | null;
  hook:             string;     // used as Reddit title
}

async function markPublishing(jobId: string, dryRun: boolean) {
  await query(
    `UPDATE publish_jobs SET status='publishing', dry_run=$2, updated_at=now() WHERE id=$1`,
    [jobId, dryRun]
  );
}

async function markPublished(jobId: string, externalId: string, externalUrl?: string) {
  await query(
    `UPDATE publish_jobs
     SET status='published', published_at=now(), external_post_id=$2, external_url=$3, updated_at=now()
     WHERE id=$1`,
    [jobId, externalId, externalUrl ?? null]
  );
  await advanceTopicState(jobId, 'POSTED');
}

/**
 * Move the topic to the queue state its publish job implies.
 *
 * QueueState has declared SCHEDULED, POSTED and ANALYZED since the beginning
 * and nothing ever wrote any of them — topics stopped at QA_PASSED. The
 * dashboard's Scheduled and Posted tabs read that state, so they could never
 * fill, and anything published stayed in Selected/Review looking like it still
 * needed work. Meanwhile the POSTED stat card counts publish_jobs directly, so
 * the same screen showed 'Posted 2' beside an empty Posted tab.
 *
 * Deliberately skips dry runs: nothing was sent, so nothing was posted.
 */
async function advanceTopicState(jobId: string, state: 'SCHEDULED' | 'POSTED'): Promise<void> {
  await query(
    `UPDATE topics t
     SET state = $2
     FROM publish_jobs pj
     JOIN content_items c ON c.id = pj.content_item_id
     WHERE pj.id = $1
       AND t.id = c.topic_id
       AND pj.dry_run IS NOT TRUE
       -- Never walk a topic backwards: a second platform scheduled after the
       -- first has already gone out must not un-post it.
       AND NOT (t.state = 'POSTED' AND $2 = 'SCHEDULED')`,
    [jobId, state]
  );
}

async function markFailed(jobId: string, error: string) {
  await query(
    `UPDATE publish_jobs SET status='failed', error=$2, updated_at=now() WHERE id=$1`,
    [jobId, error]
  );
}

// ── Platform dispatchers ──────────────────────────────────────────────────────

async function publishToInstagram(input: PublishJobInput): Promise<void> {
  const tokenRow = await instagram.getToken(input.pageId);
  if (!tokenRow?.ig_user_id || !tokenRow?.access_token) {
    throw new Error('Instagram not connected for this page — go to Settings to connect');
  }

  const GRAPH = 'https://graph.instagram.com/v21.0';
  const token = tokenRow.access_token;
  const igUserId = tokenRow.ig_user_id;
  const imageUrl = input.imageUrls[0];

  if (!imageUrl) throw new Error('No image URL available for Instagram post');

  // Step 1: create media container
  const containerRes = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url:   imageUrl,
      caption:     input.formattedCaption,
      access_token: token,
    }),
  });
  if (!containerRes.ok) throw new Error(`IG container error: ${await containerRes.text()}`);
  const { id: containerId } = await containerRes.json() as { id: string };

  // Step 2: publish
  const publishRes = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: containerId, access_token: token }),
  });
  if (!publishRes.ok) throw new Error(`IG publish error: ${await publishRes.text()}`);
  const { id: postId } = await publishRes.json() as { id: string };

  await markPublished(input.jobId, postId, `https://www.instagram.com/p/${postId}/`);
}

async function publishToYouTube(input: PublishJobInput, dryRun: boolean): Promise<void> {
  // The most likely failure by far, and it deserves a real sentence rather
  // than an API error the user cannot act on.
  if (!input.videoUrl) {
    throw new Error("This reel has no rendered video yet — run the render job first.");
  }
  const { uploadShort } = await import("../youtube.js");
  const result = await uploadShort({
    pageId: input.pageId,
    videoUrl: input.videoUrl,
    hook: input.hook,
    description: input.formattedCaption,
    dryRun,
  });
  await markPublished(input.jobId, result.videoId, result.url);
}

async function publishStub(platform: string, input: PublishJobInput): Promise<void> {
  // Stub: marks as published with a fake ID so the UI shows success in dry-run/dev
  const fakeId = `stub-${platform}-${Date.now()}`;
  await markPublished(input.jobId, fakeId);
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

export async function dispatchPublishJob(input: PublishJobInput, dryRun: boolean): Promise<void> {
  await markPublishing(input.jobId, dryRun);
  try {
    if (dryRun) {
      // YouTube validates in dry-run rather than faking success: it checks the
      // token refreshes, the file exists, and the clip is Shorts-eligible, so a
      // passing dry run means a real run would work. A dry run that skips
      // validation tells the user nothing.
      if (input.platform === 'youtube_shorts') {
        await publishToYouTube(input, true);
        return;
      }
      await publishStub(input.platform, input);
      return;
    }
    switch (input.platform) {
      case 'instagram': return await publishToInstagram(input);
      case 'linkedin':  throw new Error('LinkedIn publishing — connect via Settings first');
      case 'twitter':   throw new Error('Twitter/X publishing — connect via Settings first');
      case 'reddit':    throw new Error('Reddit publishing — connect via Settings first');
      case 'facebook':  throw new Error('Facebook publishing — connect via Settings first');
      case 'youtube_shorts': return await publishToYouTube(input, dryRun);
      default:          throw new Error(`Unknown platform: ${input.platform}`);
    }
  } catch (err: any) {
    // Quota exhaustion is not a real failure — the job should retry tomorrow
    // rather than being treated as broken. Google's accounting is
    // authoritative, so we react to its error instead of mirroring a counter
    // locally, which would drift.
    if (err?.name === 'QuotaExceededError') {
      await query(
        `UPDATE publish_jobs SET status='scheduled', error=$2,
           scheduled_at = now() + interval '24 hours', updated_at=now()
         WHERE id=$1`,
        [input.jobId, err.message]
      );
      console.warn(`[publish] ${input.jobId}: ${err.message}`);
      return;
    }
    await markFailed(input.jobId, err?.message ?? 'Unknown error');
  }
}

/** Row shape: publish_jobs joined to content_items (page_id, payload). */
export function buildPublishJobInput(job: {
  id: string; content_item_id: string; page_id: string;
  platform: string; formatted_caption: string | null;
  payload: any; video_url?: string | null;
}): PublishJobInput {
  const payload = job.payload ?? {};
  const images: string[] = (payload.images ?? [])
    .map((img: any) => img?.url ?? img)
    .filter(Boolean);
  return {
    jobId: job.id,
    contentItemId: job.content_item_id,
    pageId: job.page_id,
    platform: job.platform as PublishPlatform,
    formattedCaption: job.formatted_caption ?? "",
    imageUrls: images,
    videoUrl: job.video_url ?? null,
    hook: payload.hook ?? "",
  };
}

/** Publish every scheduled job whose time has come. */
export async function publishDueJobs(dryRun: boolean): Promise<number> {
  // Self-heal: requeue claims stuck in 'publishing' (e.g. a crashed dispatch).
  // In the rare crash-after-publish-before-mark case this can publish the same
  // content twice — accepted for now.
  await query(
    `UPDATE publish_jobs SET status='scheduled', updated_at=now()
     WHERE status='publishing' AND updated_at < now() - interval '15 minutes'`
  );

  // Atomic claim: FOR UPDATE SKIP LOCKED ensures two overlapping ticks can
  // never select the same job. dispatchPublishJob's own markPublishing then
  // re-runs harmlessly (idempotent UPDATE to the same values).
  const { rows: claimed } = await query<any>(
    `UPDATE publish_jobs SET status='publishing', dry_run=$1, updated_at=now()
     WHERE id IN (
       SELECT id FROM publish_jobs
       WHERE status='scheduled' AND scheduled_at <= now()
       ORDER BY scheduled_at ASC LIMIT 25
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, content_item_id, page_id, platform, formatted_caption`,
    [dryRun]
  );
  if (claimed.length === 0) return 0;

  // video_url too — without it the publisher cannot reach the rendered MP4.
  const { rows: payloadRows } = await query<any>(
    `SELECT id, payload, video_url FROM content_items WHERE id = ANY($1::uuid[])`,
    [claimed.map((j: any) => j.content_item_id)]
  );
  const contentById = new Map(payloadRows.map((r: any) => [r.id, r]));

  for (const job of claimed) {
    const content = contentById.get(job.content_item_id);
    await dispatchPublishJob(
      buildPublishJobInput({
        ...job,
        payload: content?.payload,
        video_url: content?.video_url ?? null,
      }),
      dryRun
    );
  }
  return claimed.length;
}
