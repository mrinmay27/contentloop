import fs   from 'fs';
import path from 'path';

/**
 * File-based image storage for generated/pasted images.
 *
 * Why files and not data URLs in JSONB:
 *   - 1080×1080 PNG ≈ 1.5MB base64 → carousel of 10 slides ≈ 15MB JSONB row
 *   - JSONB queries get slow, payloads bloat over network
 *   - Files = stable, cache-friendly, cheap to migrate to S3 later
 *
 * Layout:
 *   data/uploads/<pageId>/brand/logo.png            ← brand assets
 *   data/uploads/<pageId>/<contentId>/<idx>.png     ← content slides
 *
 * Public URLs are served by Express static middleware at /uploads/*.
 * URLs include a ?v=<timestamp> cache-buster so browsers don't cache stale versions.
 */

export const UPLOADS_DIR = path.resolve(process.cwd(), 'data/uploads');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

interface DecodedImage { buffer: Buffer; ext: string; }

function parseDataUrl(dataUrl: string): DecodedImage {
  const match = dataUrl.match(/^data:image\/([\w+]+);base64,(.+)$/);
  if (!match) throw new Error('Invalid image data URL');
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  return { buffer: Buffer.from(match[2], 'base64'), ext };
}

function safeId(id: string): string {
  // Only allow chars safe for filesystem paths
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

export interface StoredImage { url: string; absPath: string; bytes: number; }

/** Save a brand asset (logo, etc.) — overwrites any existing file at the same kind. */
export function saveBrandImage(pageId: string, kind: string, dataUrl: string): StoredImage {
  const { buffer, ext } = parseDataUrl(dataUrl);
  const dir = path.join(UPLOADS_DIR, safeId(pageId), 'brand');
  ensureDir(dir);
  const filename = `${safeId(kind)}.${ext}`;
  const absPath  = path.join(dir, filename);
  fs.writeFileSync(absPath, buffer);
  return {
    absPath,
    bytes: buffer.length,
    url:   `/uploads/${safeId(pageId)}/brand/${filename}?v=${Date.now()}`,
  };
}

/** Save a content image at a specific slide index (carousels) or 0 (single post). */
export function saveContentImage(
  pageId:     string,
  contentId:  string,
  slideIndex: number,
  dataUrl:    string,
): StoredImage {
  const { buffer, ext } = parseDataUrl(dataUrl);
  const dir = path.join(UPLOADS_DIR, safeId(pageId), safeId(contentId));
  ensureDir(dir);
  const filename = `${slideIndex}.${ext}`;
  const absPath  = path.join(dir, filename);
  fs.writeFileSync(absPath, buffer);
  return {
    absPath,
    bytes: buffer.length,
    url:   `/uploads/${safeId(pageId)}/${safeId(contentId)}/${filename}?v=${Date.now()}`,
  };
}
