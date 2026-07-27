/**
 * Video renderer — orchestrates Remotion rendering + ffmpeg audio muxing.
 *
 * Pipeline:
 *   1. Remotion renders the visual composition (slides + transitions) → silent MP4
 *   2. ffmpeg muxes in the TTS audio track
 *   3. ffmpeg mixes in optional background music at reduced volume
 *   4. (optional) ffmpeg burns subtitles from SRT into the video
 *   5. Final MP4 is saved to data/media/<contentId>/video.mp4
 *
 * Supports three aspect ratios:
 *   - portrait  (1080×1920) — Reels/Shorts
 *   - landscape (1920×1080) — YouTube
 *   - square    (1080×1080) — Feed posts
 *
 * Supports transition types: fade, slide, zoom, wipe, none
 */

import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const MEDIA_DIR = path.resolve(process.cwd(), 'data/media');
const BGM_DIR = path.resolve(process.cwd(), 'data/bgm');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type RenderStatus = 'pending' | 'rendering' | 'muxing' | 'done' | 'failed';

export interface RenderResult {
  videoPath: string;
  publicUrl: string;
  durationSec: number;
  fileSizeBytes: number;
  status: RenderStatus;
}

export interface RenderOptions {
  /** Content item ID */
  contentId: string;
  /** Slides text array for Remotion composition */
  slides: string[];
  /** Page handle (e.g., @mypage) */
  handle: string;
  /** Brand accent color (hex) */
  accent: string;
  /** Target platform */
  target: 'instagram' | 'youtube_shorts' | 'both';
  /** Local paths to background images (one per slide, optional) */
  backgroundImages?: string[];
  /** Preferred over backgroundImages — carries the kind so video renders as video. */
  backgroundMedia?: Array<{ url: string; kind: 'image' | 'video' }>;
  /** Path to TTS audio file (optional — will be muxed in) */
  audioPath?: string;
  /** Background music: 'random', 'none', or a filename in data/bgm/ */
  bgm?: string;
  /** BGM volume relative to voice (0.0 to 1.0). Default: 0.15 */
  bgmVolume?: number;
  /** Video aspect ratio. Default: 'portrait' */
  aspect?: 'portrait' | 'landscape' | 'square';
  /** Slide transition type. Default: 'fade' */
  transition?: 'fade' | 'slide' | 'zoom' | 'wipe' | 'none';
  /** Path to SRT subtitle file — if provided, burns into video */
  subtitlePath?: string;
  /** Subtitle font size. Default: 24 */
  subtitleFontSize?: number;
}

// ── FFmpeg helpers ────────────────────────────────────────────────────────────

async function getFFmpeg(): Promise<string> {
  // Check if ffmpeg is available
  try {
    await execFileAsync('ffmpeg', ['-version']);
    return 'ffmpeg';
  } catch {
    console.error('[render] ffmpeg not found in PATH. Video rendering requires ffmpeg.');
    throw new Error('ffmpeg not found — install it with: brew install ffmpeg');
  }
}

/**
 * Get the duration of a media file in seconds.
 */
async function getMediaDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      filePath,
    ]);
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

/**
 * Pick a random BGM file from data/bgm/ directory.
 */
function getRandomBgm(): string | null {
  if (!fs.existsSync(BGM_DIR)) return null;
  const files = fs.readdirSync(BGM_DIR).filter((f) => f.endsWith('.mp3'));
  if (files.length === 0) return null;
  return path.join(BGM_DIR, files[Math.floor(Math.random() * files.length)]);
}

/**
 * Resolve BGM file path from the bgm option.
 */
function resolveBgm(bgm?: string): string | null {
  if (!bgm || bgm === 'none') return null;
  if (bgm === 'random') return getRandomBgm();
  const candidate = path.join(BGM_DIR, bgm);
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Burn SRT subtitles into the video using ffmpeg's subtitles filter.
 *
 * Creates styled subtitles:
 *   - White text with dark outline for legibility
 *   - Semi-transparent background box
 *   - Bottom-center positioning (respecting platform safe areas)
 */
async function burnSubtitles(
  inputVideoPath: string,
  srtPath: string,
  outputPath: string,
  fontSize = 24,
): Promise<string> {
  const ffmpeg = await getFFmpeg();

  // Escape path for ffmpeg subtitles filter (must escape : and \)
  const escapedSrtPath = srtPath
    .replace(/\\/g, '\\\\\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "'\\''");

  // Style: white text, dark outline, semi-transparent box, bottom center
  const subtitleFilter = [
    `subtitles='${escapedSrtPath}'`,
    `:force_style='FontSize=${fontSize}`,
    `,FontName=Arial`,
    `,PrimaryColour=&HFFFFFF&`,       // White text
    `,OutlineColour=&H40000000&`,     // Dark outline
    `,BackColour=&H80000000&`,        // Semi-transparent background
    `,BorderStyle=4`,                 // Background box style
    `,Outline=2`,                     // Outline width
    `,Shadow=1`,                      // Subtle shadow
    `,MarginV=80`,                    // Vertical margin from bottom
    `,Alignment=2'`,                  // Bottom-center
  ].join('');

  console.log(`[render] Burning subtitles: fontSize=${fontSize}`);

  await execFileAsync(ffmpeg, [
    '-y',
    '-i', inputVideoPath,
    '-vf', subtitleFilter,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'copy',
    outputPath,
  ], { timeout: 180_000 });

  return outputPath;
}


// ── Remotion rendering ────────────────────────────────────────────────────────

/**
 * Render the Remotion composition to a silent MP4.
 *
 * Uses @remotion/renderer which requires Chromium.
 * Falls back to a simpler ffmpeg slideshow if Remotion is unavailable.
 */
async function renderRemotionComposition(options: RenderOptions): Promise<string> {
  const outputDir = path.join(MEDIA_DIR, options.contentId);
  ensureDir(outputDir);
  const silentVideoPath = path.join(outputDir, 'composition.mp4');

  // Check if already rendered
  if (fs.existsSync(silentVideoPath)) {
    console.log('[render] Using cached composition');
    return silentVideoPath;
  }

  try {
    // Dynamic import to avoid loading Remotion at module load time
    const { bundle } = await import('@remotion/bundler');
    const { renderMedia, selectComposition } = await import('@remotion/renderer');

    console.log('[render] Bundling Remotion project...');
    const bundleLocation = await bundle({
      entryPoint: path.resolve(process.cwd(), 'src/remotion/ReelRoot.tsx'),
      // Serve data/media as the bundle's public dir. Remotion refuses bare
      // absolute paths (resolved against its dev server) AND file:// URLs, so
      // local footage has to be referenced relative to a public dir. This is
      // why background media never rendered.
      publicDir: MEDIA_DIR,
      onProgress: (p: number) => {
        if (p % 25 === 0) console.log(`[render] Bundle progress: ${p}%`);
      },
    });

    console.log('[render] Selecting composition...');
    // Select the right composition based on aspect ratio
    const compositionId = options.aspect === 'landscape' ? 'ReelLandscape'
      : options.aspect === 'square' ? 'ReelSquare'
      : 'Reel';

    const renderableImages = (options.backgroundImages ?? []).map(toRenderableSrc);
    const renderableMedia = options.backgroundMedia?.map(m => ({ ...m, url: toRenderableSrc(m.url) }));

    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: compositionId,
      inputProps: {
        slides: options.slides,
        handle: options.handle,
        accent: options.accent,
        font: 'DM Sans',
        target: options.target === 'both' ? 'instagram' : options.target,
        backgroundImages: renderableImages,
        backgroundMedia: renderableMedia,
        aspect: options.aspect ?? 'portrait',
        transition: options.transition ?? 'fade',
      },
    });

    console.log(`[render] Rendering ${composition.durationInFrames} frames at ${composition.fps}fps...`);
    await renderMedia({
      composition,
      serveUrl: bundleLocation,
      codec: 'h264',
      outputLocation: silentVideoPath,
      inputProps: {
        slides: options.slides,
        handle: options.handle,
        accent: options.accent,
        font: 'DM Sans',
        target: options.target === 'both' ? 'instagram' : options.target,
        backgroundImages: renderableImages,
        backgroundMedia: renderableMedia,
        aspect: options.aspect ?? 'portrait',
        transition: options.transition ?? 'fade',
      },
    });

    console.log('[render] Remotion render complete');
    return silentVideoPath;
  } catch (err: any) {
    console.warn(`[render] Remotion render failed: ${err.message}`);
    console.log('[render] Falling back to ffmpeg slideshow...');
    return renderFfmpegSlideshow(options, silentVideoPath);
  }
}

/**
 * Fallback: create a simple slideshow video using ffmpeg
 * (for environments where Remotion/Chromium isn't available).
 */
async function renderFfmpegSlideshow(
  options: RenderOptions,
  outputPath: string,
): Promise<string> {
  const ffmpeg = await getFFmpeg();
  const slideDurationSec = 3;
  const totalDurationSec = options.slides.length * slideDurationSec;

  // Create a solid color background with centered text per slide
  // This is a simplified fallback — no animations
  const filterParts: string[] = [];
  const width = 1080;
  const height = 1920;

  for (let i = 0; i < options.slides.length; i++) {
    const text = options.slides[i].replace(/'/g, "'\\''").replace(/\n/g, ' ');
    // Truncate for ffmpeg drawtext
    const truncated = text.length > 100 ? text.slice(0, 97) + '...' : text;

    filterParts.push(
      `color=c=#0A0A0A:size=${width}x${height}:d=${slideDurationSec}:r=30,` +
      `drawtext=text='${truncated}':fontcolor=white:fontsize=48:` +
      `x=(w-text_w)/2:y=(h-text_h)/2:fontfile=/System/Library/Fonts/Helvetica.ttc` +
      `[v${i}]`,
    );
  }

  // Concat all slides
  const inputs = options.slides.map((_, i) => `[v${i}]`).join('');
  const filterComplex =
    filterParts.join('; ') +
    `; ${inputs}concat=n=${options.slides.length}:v=1:a=0[outv]`;

  try {
    await execFileAsync(ffmpeg, [
      '-y',
      '-filter_complex', filterComplex,
      '-map', '[outv]',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-t', String(totalDurationSec),
      outputPath,
    ], { timeout: 120_000 });

    return outputPath;
  } catch (err: any) {
    console.error(`[render] ffmpeg slideshow failed: ${err.message}`);
    throw new Error('Video rendering failed — both Remotion and ffmpeg fallback failed');
  }
}

// ── Audio muxing ──────────────────────────────────────────────────────────────

/**
 * Mux TTS audio and optional BGM into the silent video.
 *
 * If only audio: mux directly.
 * If audio + BGM: mix audio at full volume, BGM at bgmVolume, then mux.
 */
async function muxAudio(
  silentVideoPath: string,
  audioPath: string | undefined,
  bgmPath: string | null,
  bgmVolume: number,
  outputPath: string,
): Promise<string> {
  const ffmpeg = await getFFmpeg();

  if (!audioPath && !bgmPath) {
    // No audio at all — just copy the video
    fs.copyFileSync(silentVideoPath, outputPath);
    return outputPath;
  }

  if (audioPath && !bgmPath) {
    // TTS audio only — simple mux
    console.log('[render] Muxing TTS audio into video...');
    await execFileAsync(ffmpeg, [
      '-y',
      '-i', silentVideoPath,
      '-i', audioPath,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      outputPath,
    ], { timeout: 120_000 });
    return outputPath;
  }

  if (!audioPath && bgmPath) {
    // BGM only — mux at reduced volume
    console.log('[render] Muxing BGM into video...');
    await execFileAsync(ffmpeg, [
      '-y',
      '-i', silentVideoPath,
      '-i', bgmPath,
      '-filter_complex', `[1:a]volume=${bgmVolume}[bgm]`,
      '-map', '0:v',
      '-map', '[bgm]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      outputPath,
    ], { timeout: 120_000 });
    return outputPath;
  }

  // Both TTS audio + BGM — mix together
  console.log('[render] Mixing TTS audio + BGM and muxing into video...');
  await execFileAsync(ffmpeg, [
    '-y',
    '-i', silentVideoPath,
    '-i', audioPath!,
    '-i', bgmPath!,
    '-filter_complex',
    `[1:a]volume=1.0[voice];[2:a]volume=${bgmVolume}[bgm];[voice][bgm]amix=inputs=2:duration=shortest[aout]`,
    '-map', '0:v',
    '-map', '[aout]',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    outputPath,
  ], { timeout: 120_000 });

  return outputPath;
}

// ── Main render pipeline ──────────────────────────────────────────────────────

/**
 * Full render pipeline:
 *   1. Render Remotion composition → silent MP4
 *   2. Mux TTS audio + BGM → final MP4
 */

/** Make a local asset path referenceable by Remotion.
 *
 *  Remotion rejects both bare absolute paths (it resolves them against its own
 *  dev server and 404s) and file:// URLs ("Can only download URLs starting
 *  with http:// or https://"). Local assets must live under the bundle's
 *  publicDir and be referenced relative to it — Remotion then serves them over
 *  http itself. MEDIA_DIR is registered as publicDir above.
 *
 *  Absolute paths inside MEDIA_DIR become relative; anything already a URL is
 *  left alone; anything else is returned unchanged so the caller can see it. */
function toRenderableSrc(src: string): string {
  if (/^(https?|data):/.test(src)) return src;
  const abs = src.startsWith('file://') ? src.slice('file://'.length) : src;
  if (abs.startsWith(MEDIA_DIR)) {
    return path.relative(MEDIA_DIR, abs).split(path.sep).join('/');
  }
  return src;
}

export async function renderVideo(options: RenderOptions): Promise<RenderResult> {
  const outputDir = path.join(MEDIA_DIR, options.contentId);
  ensureDir(outputDir);
  const finalVideoPath = path.join(outputDir, 'video.mp4');

  // Skip if already rendered
  if (fs.existsSync(finalVideoPath)) {
    const stat = fs.statSync(finalVideoPath);
    const duration = await getMediaDuration(finalVideoPath);
    console.log(`[render] Video already exists for ${options.contentId}`);
    return {
      videoPath: finalVideoPath,
      publicUrl: `/media/${options.contentId}/video.mp4`,
      durationSec: duration,
      fileSizeBytes: stat.size,
      status: 'done',
    };
  }

  console.log(`[render] Starting render pipeline for content ${options.contentId}`);

  // Step 1: Render visual composition
  const silentVideoPath = await renderRemotionComposition(options);

  // Step 2: Resolve BGM
  const bgmPath = resolveBgm(options.bgm);
  const bgmVolume = options.bgmVolume ?? 0.15;

  // Step 3: Mux audio
  const muxedPath = path.join(outputDir, 'muxed.mp4');
  await muxAudio(
    silentVideoPath,
    options.audioPath,
    bgmPath,
    bgmVolume,
    muxedPath,
  );

  // Step 4: Burn subtitles (if SRT provided)
  if (options.subtitlePath && fs.existsSync(options.subtitlePath)) {
    console.log('[render] Burning subtitles into video...');
    await burnSubtitles(muxedPath, options.subtitlePath, finalVideoPath, options.subtitleFontSize);
    // Clean up muxed intermediate
    try { fs.unlinkSync(muxedPath); } catch { /* ignore */ }
  } else {
    // No subtitles — muxed IS the final
    fs.renameSync(muxedPath, finalVideoPath);
  }

  // Step 5: Get final stats
  const stat = fs.statSync(finalVideoPath);
  const duration = await getMediaDuration(finalVideoPath);

  // Clean up intermediate files
  try {
    if (fs.existsSync(path.join(outputDir, 'composition.mp4'))) {
      fs.unlinkSync(path.join(outputDir, 'composition.mp4'));
    }
  } catch { /* ignore cleanup errors */ }

  console.log(
    `[render] Video complete: ${duration.toFixed(1)}s, ` +
    `${(stat.size / 1024 / 1024).toFixed(1)}MB`,
  );

  return {
    videoPath: finalVideoPath,
    publicUrl: `/media/${options.contentId}/video.mp4`,
    durationSec: duration,
    fileSizeBytes: stat.size,
    status: 'done',
  };
}

/**
 * List available BGM tracks.
 */
export function listBgmTracks(): Array<{ filename: string; path: string }> {
  ensureDir(BGM_DIR);
  return fs.readdirSync(BGM_DIR)
    .filter((f) => f.endsWith('.mp3'))
    .map((filename) => ({
      filename,
      path: path.join(BGM_DIR, filename),
    }));
}

/**
 * Route 2/3 — render a creator's uploaded clip with captions composited on top.
 *
 * Separate from renderVideo(), which builds a slide-based reel. Both share the
 * same publicDir/staticFile mechanics: assets must live under MEDIA_DIR and be
 * referenced relative to it, because Remotion rejects absolute and file:// paths.
 */
export async function renderCaptionedVideo(options: {
  contentId: string;
  /** Absolute path to the uploaded source, inside MEDIA_DIR. */
  sourcePath: string;
  srt: string;
  accent?: string;
  durationSec: number;
  /** Absolute path to a brand logo inside MEDIA_DIR, if any. */
  logoPath?: string;
}): Promise<RenderResult> {
  const outputDir = path.join(MEDIA_DIR, options.contentId);
  ensureDir(outputDir);
  const outPath = path.join(outputDir, 'captioned.mp4');

  const { bundle } = await import('@remotion/bundler');
  const { renderMedia, selectComposition } = await import('@remotion/renderer');

  const bundleLocation = await bundle({
    entryPoint: path.resolve(process.cwd(), 'src/remotion/ReelRoot.tsx'),
    publicDir: MEDIA_DIR,
  });

  const inputProps = {
    videoSrc: toRenderableSrc(options.sourcePath),
    srt: options.srt,
    accent: options.accent ?? '#F5A623',
    logoSrc: options.logoPath ? toRenderableSrc(options.logoPath) : undefined,
    durationSec: options.durationSec,
  };

  const composition = await selectComposition({
    serveUrl: bundleLocation, id: 'CaptionedVideo', inputProps,
  });

  console.log(`[render] Captioning ${options.contentId}: ${composition.durationInFrames} frames`);
  await renderMedia({
    composition, serveUrl: bundleLocation, codec: 'h264',
    outputLocation: outPath, inputProps,
  });

  const stat = fs.statSync(outPath);
  return {
    videoPath: outPath,
    publicUrl: `/media/${options.contentId}/captioned.mp4`,
    durationSec: await getMediaDuration(outPath),
    fileSizeBytes: stat.size,
    status: 'done',
  };
}
