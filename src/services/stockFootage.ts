/**
 * Stock footage sourcing from Pexels API.
 *
 * Automatically downloads royalty-free HD video clips and images
 * based on topic keywords — used as B-roll for Reel compositions.
 *
 * Inspired by MoneyPrinterTurbo's material.py, adapted for TPCE's
 * TypeScript + Remotion pipeline.
 *
 * Requirements:
 *   - PEXELS_API_KEY env var (free at https://www.pexels.com/api/)
 */

import fs from 'fs';
import { resolveMediaDir } from "../config/paths.js";
import { configStore } from "../config/configStore.js";
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const MEDIA_DIR = resolveMediaDir();

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type VideoAspect = 'portrait' | 'landscape' | 'square';

export interface StockVideo {
  id: number;
  url: string;
  downloadUrl: string;
  width: number;
  height: number;
  duration: number;
  provider: 'pexels';
}

export interface StockImage {
  id: number;
  url: string;
  downloadUrl: string;
  width: number;
  height: number;
  photographer: string;
  provider: 'pexels';
}

export interface DownloadedMedia {
  localPath: string;
  publicUrl: string;
  type: 'video' | 'image';
  width: number;
  height: number;
  durationSec?: number;
}

// ── Pexels API aspect mapping ─────────────────────────────────────────────────

const ASPECT_TO_ORIENTATION: Record<VideoAspect, string> = {
  portrait: 'portrait',
  landscape: 'landscape',
  square: 'square',
};

const ASPECT_TO_RESOLUTION: Record<VideoAspect, { width: number; height: number }> = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
};

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Search for stock videos on Pexels.
 */
export async function searchVideos(
  searchTerm: string,
  aspect: VideoAspect = 'portrait',
  perPage = 15,
): Promise<StockVideo[]> {
  // Settings first, env as fallback — otherwise the Settings field would be
  // another control that looks functional and isn't.
  const apiKey = configStore.get('PEXELS_API_KEY') || process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.log('[stockFootage] PEXELS_API_KEY not set — skipping stock footage search');
    return [];
  }

  const orientation = ASPECT_TO_ORIENTATION[aspect];
  const params = new URLSearchParams({
    query: searchTerm,
    per_page: String(perPage),
    orientation,
  });

  const url = `https://api.pexels.com/videos/search?${params}`;
  console.log(`[stockFootage] Searching videos: "${searchTerm}" (${orientation})`);

  try {
    const res = await fetch(url, {
      headers: { Authorization: apiKey },
    });

    if (!res.ok) {
      console.error(`[stockFootage] Pexels API error: ${res.status} ${res.statusText}`);
      return [];
    }

    const data = await res.json() as any;
    if (!data.videos) return [];

    const target = ASPECT_TO_RESOLUTION[aspect];
    const results: StockVideo[] = [];

    for (const v of data.videos) {
      // Find the best video file matching our target resolution
      const files = v.video_files ?? [];
      const best = files
        .filter((f: any) => f.width && f.height)
        .sort((a: any, b: any) => {
          // Prefer files closest to our target resolution
          const diffA = Math.abs(a.width - target.width) + Math.abs(a.height - target.height);
          const diffB = Math.abs(b.width - target.width) + Math.abs(b.height - target.height);
          return diffA - diffB;
        })[0];

      if (best?.link) {
        results.push({
          id: v.id,
          url: v.url,
          downloadUrl: best.link,
          width: best.width,
          height: best.height,
          duration: v.duration,
          provider: 'pexels',
        });
      }
    }

    console.log(`[stockFootage] Found ${results.length} videos for "${searchTerm}"`);
    return results;
  } catch (err: any) {
    console.error(`[stockFootage] Search failed: ${err.message}`);
    return [];
  }
}

/**
 * Search for stock images on Pexels (used as slide backgrounds in Reels).
 */
export async function searchImages(
  searchTerm: string,
  aspect: VideoAspect = 'portrait',
  perPage = 10,
): Promise<StockImage[]> {
  // Settings first, env as fallback — otherwise the Settings field would be
  // another control that looks functional and isn't.
  const apiKey = configStore.get('PEXELS_API_KEY') || process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.log('[stockFootage] PEXELS_API_KEY not set — skipping stock image search');
    return [];
  }

  const orientation = ASPECT_TO_ORIENTATION[aspect];
  const params = new URLSearchParams({
    query: searchTerm,
    per_page: String(perPage),
    orientation,
  });

  const url = `https://api.pexels.com/v1/search?${params}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: apiKey },
    });

    if (!res.ok) return [];

    const data = await res.json() as any;
    if (!data.photos) return [];

    return data.photos.map((p: any) => ({
      id: p.id,
      url: p.url,
      // Use 'large2x' for high quality, or 'portrait'/'landscape' for aspect-specific
      downloadUrl: aspect === 'portrait' ? (p.src?.portrait ?? p.src?.large2x) : (p.src?.landscape ?? p.src?.large2x),
      width: p.width,
      height: p.height,
      photographer: p.photographer,
      provider: 'pexels' as const,
    }));
  } catch (err: any) {
    console.error(`[stockFootage] Image search failed: ${err.message}`);
    return [];
  }
}

// ── Download ──────────────────────────────────────────────────────────────────

/**
 * Download a media file from a URL to the local filesystem.
 */
export async function downloadMedia(
  downloadUrl: string,
  contentId: string,
  filename: string,
): Promise<string> {
  const dir = path.join(MEDIA_DIR, contentId, 'footage');
  ensureDir(dir);
  const localPath = path.join(dir, filename);

  // Skip if already downloaded
  if (fs.existsSync(localPath)) {
    console.log(`[stockFootage] Already cached: ${filename}`);
    return localPath;
  }

  console.log(`[stockFootage] Downloading: ${filename}`);
  const res = await fetch(downloadUrl);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  const writeStream = fs.createWriteStream(localPath);
  // @ts-ignore — ReadableStream to Node.js Readable compat
  await pipeline(Readable.fromWeb(res.body as any), writeStream);

  const stat = fs.statSync(localPath);
  console.log(`[stockFootage] Downloaded: ${filename} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);

  return localPath;
}

/**
 * Source background images for a Reel's slides based on keywords.
 *
 * Downloads one image per slide (or fewer if not enough results).
 * Returns an array of local file paths that can be served via Express static.
 */
/** Decide, per slide, whether to use a video clip or a still.
 *  Video is preferred — stills are the fallback that made every reel look like
 *  a slideshow. Returns [] when neither is available so the composition uses
 *  its existing gradient backgrounds. */
export function pickBackgroundPlan(
  slideCount: number,
  videosAvailable: number,
  imagesAvailable: number,
): Array<'video' | 'image'> {
  const plan: Array<'video' | 'image'> = [];
  for (let i = 0; i < slideCount; i++) {
    if (i < videosAvailable) plan.push('video');
    else if (imagesAvailable > 0) plan.push('image');
    else break;
  }
  return plan;
}

export async function sourceReelBackgrounds(
  contentId: string,
  keywords: string[],
  slideCount: number,
  aspect: VideoAspect = 'portrait',
): Promise<DownloadedMedia[]> {
  const searchTerm = keywords.slice(0, 3).join(' ');

  // Video first — this is what stops reels being slideshows. searchVideos()
  // was fully implemented and called from nowhere until now.
  const [videos, images] = await Promise.all([
    searchVideos(searchTerm, aspect, slideCount + 3),
    searchImages(searchTerm, aspect, slideCount + 5),
  ]);

  const plan = pickBackgroundPlan(slideCount, videos.length, images.length);
  if (plan.length === 0) {
    console.log(`[stockFootage] No footage found — Reel will use gradient backgrounds`);
    return [];
  }

  const results: DownloadedMedia[] = [];
  let videoIdx = 0;
  let imageIdx = 0;

  for (let i = 0; i < plan.length; i++) {
    try {
      if (plan[i] === 'video') {
        const v = videos[videoIdx++];
        const filename = `bg_${i}.mp4`;
        const localPath = await downloadMedia(v.downloadUrl, contentId, filename);
        results.push({
          localPath,
          publicUrl: `/media/${contentId}/footage/${filename}`,
          type: 'video',
          width: v.width,
          height: v.height,
          durationSec: v.duration,
        });
      } else {
        const img = images[imageIdx++];
        const ext = img.downloadUrl.match(/\.(\w+)\?/)?.[1] ?? 'jpg';
        const filename = `bg_${i}.${ext}`;
        const localPath = await downloadMedia(img.downloadUrl, contentId, filename);
        results.push({
          localPath,
          publicUrl: `/media/${contentId}/footage/${filename}`,
          type: 'image',
          width: img.width,
          height: img.height,
        });
      }
    } catch (err: any) {
      // One bad download must not sink the whole reel.
      console.error(`[stockFootage] Failed to download background ${i}: ${err.message}`);
    }
  }

  const videoCount = results.filter(r => r.type === 'video').length;
  console.log(`[stockFootage] Sourced ${results.length}/${slideCount} backgrounds (${videoCount} video, ${results.length - videoCount} image)`);
  return results;
}
