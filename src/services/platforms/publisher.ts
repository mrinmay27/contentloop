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
  hook:             string;     // used as Reddit title
}

async function markPublishing(jobId: string) {
  await query(
    `UPDATE publish_jobs SET status='publishing', updated_at=now() WHERE id=$1`,
    [jobId]
  );
}

async function markPublished(jobId: string, externalId: string, externalUrl?: string) {
  await query(
    `UPDATE publish_jobs
     SET status='published', published_at=now(), external_post_id=$2, external_url=$3, updated_at=now()
     WHERE id=$1`,
    [jobId, externalId, externalUrl ?? null]
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

async function publishStub(platform: string, input: PublishJobInput): Promise<void> {
  // Stub: marks as published with a fake ID so the UI shows success in dry-run/dev
  const fakeId = `stub-${platform}-${Date.now()}`;
  await markPublished(input.jobId, fakeId);
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

export async function dispatchPublishJob(input: PublishJobInput, dryRun: boolean): Promise<void> {
  await markPublishing(input.jobId);
  try {
    if (dryRun) {
      await publishStub(input.platform, input);
      return;
    }
    switch (input.platform) {
      case 'instagram': return await publishToInstagram(input);
      case 'linkedin':  throw new Error('LinkedIn publishing — connect via Settings first');
      case 'twitter':   throw new Error('Twitter/X publishing — connect via Settings first');
      case 'reddit':    throw new Error('Reddit publishing — connect via Settings first');
      case 'facebook':  throw new Error('Facebook publishing — connect via Settings first');
      default:          throw new Error(`Unknown platform: ${input.platform}`);
    }
  } catch (err: any) {
    await markFailed(input.jobId, err?.message ?? 'Unknown error');
  }
}
