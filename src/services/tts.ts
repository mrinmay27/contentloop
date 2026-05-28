/**
 * Text-to-Speech service using Microsoft Edge's online TTS engine.
 *
 * Why Edge TTS?
 *   - Free, no API key or Azure subscription required
 *   - High-quality neural voices (same engine as Azure Cognitive Services)
 *   - Supports 300+ voices in 100+ languages
 *   - Returns word-boundary metadata for subtitle timing
 *
 * Trade-off: Uses an undocumented Microsoft API — may break without notice.
 * For production at scale, consider migrating to the official Azure Speech SDK.
 */

import { EdgeTTS, type Voice, type SynthesisOptions, type WordBoundary } from '@andresaya/edge-tts';
import fs from 'fs';
import path from 'path';

// ── Voice presets for different content niches ─────────────────────────────────
// Each preset maps a niche category to a curated voice that matches the tone.
// Users can override via TTS_VOICE env var or per-request.

export interface VoicePreset {
  voice: string;
  label: string;
  gender: 'Male' | 'Female';
  style: string;
}

export const VOICE_PRESETS: Record<string, VoicePreset> = {
  // General / default
  default: {
    voice: 'en-US-AriaNeural',
    label: 'Aria (US, Female)',
    gender: 'Female',
    style: 'Friendly, professional narrator',
  },
  // Tech / AI / productivity
  tech: {
    voice: 'en-US-GuyNeural',
    label: 'Guy (US, Male)',
    gender: 'Male',
    style: 'Clear, authoritative tech explainer',
  },
  // Health & wellness
  health: {
    voice: 'en-US-JennyNeural',
    label: 'Jenny (US, Female)',
    gender: 'Female',
    style: 'Warm, trustworthy health communicator',
  },
  // Finance & business
  finance: {
    voice: 'en-US-DavisNeural',
    label: 'Davis (US, Male)',
    gender: 'Male',
    style: 'Confident, measured financial analyst',
  },
  // Food & lifestyle
  food: {
    voice: 'en-US-SaraNeural',
    label: 'Sara (US, Female)',
    gender: 'Female',
    style: 'Enthusiastic, warm lifestyle host',
  },
  // Energetic / trending / viral
  energetic: {
    voice: 'en-US-AndrewNeural',
    label: 'Andrew (US, Male)',
    gender: 'Male',
    style: 'High-energy, engaging storyteller',
  },
  // Calm / educational
  calm: {
    voice: 'en-US-EmmaNeural',
    label: 'Emma (US, Female)',
    gender: 'Female',
    style: 'Calm, educational narrator',
  },
};

// ── Core TTS interface ────────────────────────────────────────────────────────

export interface SynthesisResult {
  /** Absolute path to the generated audio file */
  audioPath: string;
  /** Duration in seconds */
  durationSec: number;
  /** Word-level timing boundaries for subtitle generation */
  wordBoundaries: WordBoundary[];
  /** Voice used for synthesis */
  voiceName: string;
  /** File size in bytes */
  fileSizeBytes: number;
}

export interface TTSOptions {
  /** Edge TTS voice name (e.g., 'en-US-AriaNeural'). Falls back to preset or default. */
  voice?: string;
  /** Speech rate adjustment: '-20%' to '+50%'. Default: '+5%' (slightly faster for Reels) */
  rate?: string;
  /** Pitch adjustment: '-10Hz' to '+10Hz'. Default: '0Hz' */
  pitch?: string;
  /** Volume: '0%' to '100%'. Default: '100%' */
  volume?: string;
}

const MEDIA_DIR = path.resolve(process.cwd(), 'data/media');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Resolve the voice name from options, niche preset, or default.
 */
export function resolveVoice(
  explicitVoice?: string,
  nicheCategory?: string,
  envOverride?: string,
): string {
  if (explicitVoice) return explicitVoice;
  if (envOverride) return envOverride;
  if (nicheCategory && VOICE_PRESETS[nicheCategory]) {
    return VOICE_PRESETS[nicheCategory].voice;
  }
  return VOICE_PRESETS.default.voice;
}

/**
 * Synthesize text to an MP3 file using Edge TTS.
 *
 * @param text       The text to speak
 * @param outputPath Absolute path for the output .mp3 file
 * @param options    Voice, rate, pitch, volume overrides
 * @returns          Synthesis result with path, duration, and word boundaries
 */
export async function synthesize(
  text: string,
  outputPath: string,
  options: TTSOptions = {},
): Promise<SynthesisResult> {
  const voiceName = options.voice ?? VOICE_PRESETS.default.voice;
  const synthesisOptions: SynthesisOptions = {
    rate: options.rate ?? '+5%',
    pitch: options.pitch ?? '0Hz',
    volume: options.volume ?? '100%',
  };

  // Ensure output directory exists
  ensureDir(path.dirname(outputPath));

  const tts = new EdgeTTS();

  // Synthesize — populates internal buffers and word boundaries
  await tts.synthesize(text, voiceName, synthesisOptions);

  // Write to file
  await tts.toFile(outputPath);

  const wordBoundaries = tts.getWordBoundaries();
  const audioInfo = tts.getAudioInfo();
  const stat = fs.statSync(outputPath);

  return {
    audioPath: outputPath,
    durationSec: audioInfo.estimatedDuration / 1000,
    wordBoundaries,
    voiceName,
    fileSizeBytes: stat.size,
  };
}

/**
 * Generate audio for a reel script and save to the media directory.
 *
 * @param contentId     UUID of the content_item
 * @param scriptText    Full reel script text (hook + body + CTA)
 * @param nicheCategory Niche category for voice preset selection
 * @param options       Optional voice/rate/pitch overrides
 */
export async function synthesizeReelAudio(
  contentId: string,
  scriptText: string,
  nicheCategory?: string,
  options: TTSOptions = {},
): Promise<SynthesisResult> {
  const voice = resolveVoice(options.voice, nicheCategory, process.env.TTS_VOICE);
  const outputDir = path.join(MEDIA_DIR, contentId);
  const outputPath = path.join(outputDir, 'audio.mp3');

  console.log(`[tts] Synthesizing audio for content ${contentId} with voice ${voice}`);

  const result = await synthesize(scriptText, outputPath, { ...options, voice });

  console.log(
    `[tts] Audio generated: ${result.durationSec.toFixed(1)}s, ` +
    `${(result.fileSizeBytes / 1024).toFixed(0)}KB, ` +
    `${result.wordBoundaries.length} word boundaries`,
  );

  return result;
}

/**
 * Generate a short preview audio clip (for the dashboard voice picker).
 */
export async function previewVoice(
  text: string,
  voice: string,
  options: TTSOptions = {},
): Promise<Buffer> {
  const tts = new EdgeTTS();
  await tts.synthesize(text, voice, {
    rate: options.rate ?? '+5%',
    pitch: options.pitch ?? '0Hz',
    volume: options.volume ?? '100%',
  });
  return tts.toBuffer();
}

/**
 * List all available Edge TTS voices, optionally filtered by language.
 */
export async function listVoices(locale?: string): Promise<Voice[]> {
  const tts = new EdgeTTS();
  if (locale) {
    return tts.getVoicesByLanguage(locale);
  }
  return tts.getVoices();
}

/**
 * Convert word boundaries to SRT subtitle format.
 * Each entry becomes a subtitle line timed to the word boundary offsets.
 *
 * Groups words into chunks of ~6-8 words per subtitle line for readability.
 */
export function wordBoundariesToSrt(boundaries: WordBoundary[], wordsPerLine = 7): string {
  if (boundaries.length === 0) return '';

  const lines: string[] = [];
  let lineIndex = 1;

  for (let i = 0; i < boundaries.length; i += wordsPerLine) {
    const chunk = boundaries.slice(i, i + wordsPerLine);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];

    const startMs = first.offset;
    const endMs = last.offset + last.duration;

    const startSrt = msToSrtTimestamp(startMs);
    const endSrt = msToSrtTimestamp(endMs);
    const text = chunk.map((wb) => wb.text).join(' ');

    lines.push(`${lineIndex}`);
    lines.push(`${startSrt} --> ${endSrt}`);
    lines.push(text);
    lines.push('');
    lineIndex++;
  }

  return lines.join('\n');
}

function msToSrtTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const millis = ms % 1000;
  return (
    `${String(hours).padStart(2, '0')}:` +
    `${String(minutes).padStart(2, '0')}:` +
    `${String(seconds).padStart(2, '0')},` +
    `${String(millis).padStart(3, '0')}`
  );
}

/**
 * Save SRT subtitle file alongside the audio.
 */
export async function saveSubtitles(
  contentId: string,
  boundaries: WordBoundary[],
): Promise<string> {
  const srt = wordBoundariesToSrt(boundaries);
  const outputDir = path.join(MEDIA_DIR, contentId);
  ensureDir(outputDir);
  const srtPath = path.join(outputDir, 'subtitles.srt');
  fs.writeFileSync(srtPath, srt, 'utf-8');
  return srtPath;
}
