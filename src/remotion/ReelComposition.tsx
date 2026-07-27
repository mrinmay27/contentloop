import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Easing,
  Img,
  OffthreadVideo,
} from 'remotion';

// ── Aspect ratio presets ──────────────────────────────────────────────────────

export type VideoAspect = 'portrait' | 'landscape' | 'square';
export type TransitionType = 'fade' | 'slide' | 'zoom' | 'wipe' | 'none';

export interface AspectConfig {
  width: number;
  height: number;
  label: string;
}

export const ASPECT_CONFIGS: Record<VideoAspect, AspectConfig> = {
  portrait:  { width: 1080, height: 1920, label: '9:16 Portrait (Reels/Shorts)' },
  landscape: { width: 1920, height: 1080, label: '16:9 Landscape (YouTube)' },
  square:    { width: 1080, height: 1080, label: '1:1 Square (Feed)' },
};

export interface ReelProps {
  slides:           string[];
  handle:           string;
  accent:           string;
  font:             string;
  target:           'instagram' | 'youtube_shorts' | 'both';
  backgroundImages?: string[];   // one URL per slide (may be shorter than slides array)
  /** Preferred over backgroundImages — carries the kind so video renders as
   *  video. backgroundImages is kept so existing callers keep working. */
  backgroundMedia?: Array<{ url: string; kind: 'image' | 'video' }>;
  aspect?:          VideoAspect;
  transition?:      TransitionType;
}

export const REEL_FPS    = 30;
export const REEL_WIDTH  = 1080;
export const REEL_HEIGHT = 1920;
export const FRAMES_PER_SLIDE = 90; // 3s
const TRANSITION_FRAMES = 15; // 0.5s for transitions

export function reelDurationFrames(slideCount: number) {
  return slideCount * FRAMES_PER_SLIDE;
}

/** Resolve actual width/height from aspect prop */
export function resolveAspect(aspect?: VideoAspect): AspectConfig {
  return ASPECT_CONFIGS[aspect ?? 'portrait'];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

/** Responsive font size based on text length and aspect ratio */
function fontSizeFor(text: string, aspect: VideoAspect = 'portrait'): number {
  const len = text.replace(/\n/g, '').length;
  // Scale factor: landscape has wider but shorter canvas
  const scale = aspect === 'landscape' ? 0.75 : aspect === 'square' ? 0.85 : 1;
  let size: number;
  if (len < 30)  size = 96;
  else if (len < 60)  size = 76;
  else if (len < 100) size = 60;
  else if (len < 150) size = 48;
  else size = 40;
  return Math.round(size * scale);
}

// Split on first sentence boundary or \n — first chunk = headline, rest = body
function splitLines(text: string): [string, string] {
  const byNewline = text.split('\n');
  if (byNewline.length >= 2) {
    return [byNewline[0].trim(), byNewline.slice(1).join('\n').trim()];
  }
  // Split on first punctuation if long enough
  const mid = text.search(/[.!?…]/);
  if (mid > 10 && mid < text.length - 4) {
    return [text.slice(0, mid + 1).trim(), text.slice(mid + 1).trim()];
  }
  return [text.trim(), ''];
}

// ── Transition calculations ──────────────────────────────────────────────────

function getTransitionStyle(
  transition: TransitionType,
  frameInSlide: number,
  isEntry: boolean,
): React.CSSProperties {
  const t = isEntry
    ? interpolate(frameInSlide, [0, TRANSITION_FRAMES], [0, 1], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        easing: Easing.out(Easing.cubic),
      })
    : interpolate(frameInSlide, [FRAMES_PER_SLIDE - TRANSITION_FRAMES, FRAMES_PER_SLIDE], [1, 0], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
        easing: Easing.in(Easing.cubic),
      });

  switch (transition) {
    case 'fade':
      return { opacity: t };

    case 'slide':
      return isEntry
        ? { opacity: 1, transform: `translateX(${(1 - t) * 100}%)` }
        : { opacity: 1, transform: `translateX(${(1 - t) * -100}%)` };

    case 'zoom':
      return isEntry
        ? { opacity: t, transform: `scale(${0.85 + t * 0.15})` }
        : { opacity: t, transform: `scale(${1 + (1 - t) * 0.15})` };

    case 'wipe':
      return { clipPath: isEntry ? `inset(0 ${(1 - t) * 100}% 0 0)` : `inset(0 0 0 ${(1 - t) * 100}%)` };

    case 'none':
    default:
      return { opacity: frameInSlide < 2 ? 0 : 1 };
  }
}

// ── Word-by-word animated block ─────────────────────────────────────────────

function AnimatedWords({
  text, frame, startFrame, color, fontSize, bold = true, stagger = 3,
}: {
  text: string; frame: number; startFrame: number;
  color: string; fontSize: number; bold?: boolean; stagger?: number;
}) {
  const words = text.split(/\s+/);
  return (
    <span>
      {words.map((word, i) => {
        const wordFrame = frame - (startFrame + i * stagger);
        const progress  = Math.max(0, Math.min(1, wordFrame / 10));
        const eased     = Easing.out(Easing.cubic)(progress);
        return (
          <span key={i} style={{
            display: 'inline-block',
            marginRight: '0.22em',
            opacity:   eased,
            transform: `translateY(${(1 - eased) * 20}px)`,
            color,
            fontSize,
            fontWeight: bold ? 800 : 500,
            lineHeight: 1.2,
            letterSpacing: '-0.02em',
          }}>
            {word}
          </span>
        );
      })}
    </span>
  );
}

// ── Bottom-third slide text ──────────────────────────────────────────────────
// Text lives in the bottom 40% of the frame — image fills top, text sits in a
// guaranteed dark scrim. Accent colour is used only for the small pill/bar
// decoration, never for the main headline (avoids colour clash with background).

function SlideContent({
  text, frame, accent, isLast, hasImage, aspect = 'portrait',
}: {
  text: string; frame: number; accent: string; isLast: boolean;
  hasImage: boolean; aspect?: VideoAspect;
}) {
  const [headline, body] = splitLines(text);
  const fs = fontSizeFor(text, aspect);

  const slideOut = interpolate(frame, [FRAMES_PER_SLIDE - 12, FRAMES_PER_SLIDE], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Thin accent pill that slides in before the words
  const pillW = interpolate(frame, [0, 18], [0, 48], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const headlineWords = headline.split(' ').length;
  const bodyStartFrame = headlineWords * 3 + 8;

  // Responsive padding based on aspect ratio
  const hPadding = aspect === 'landscape' ? 120 : aspect === 'square' ? 56 : 72;

  return (
    <div style={{
      opacity: slideOut,
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
      textAlign: 'left', padding: `0 ${hPadding}px`,
      width: '100%', boxSizing: 'border-box',
    }}>
      {/* Accent pill */}
      <div style={{
        height: 5, width: pillW, borderRadius: 3,
        background: accent, marginBottom: 24,
      }} />

      {/* Headline — always white so it reads on any background */}
      <div style={{ marginBottom: body ? 18 : 0 }}>
        <AnimatedWords
          text={headline} frame={frame} startFrame={0}
          color="#ffffff" fontSize={fs} bold stagger={3}
        />
      </div>

      {/* Body — slightly muted white */}
      {body && (
        <div>
          <AnimatedWords
            text={body} frame={frame} startFrame={bodyStartFrame}
            color="rgba(255,255,255,0.80)" fontSize={Math.round(fs * 0.68)} bold={false} stagger={2}
          />
        </div>
      )}

      {/* Save nudge on last slide */}
      {isLast && (
        <div style={{
          marginTop: 32, fontSize: aspect === 'landscape' ? 24 : 30,
          color: 'rgba(255,255,255,0.55)', fontWeight: 600,
          opacity: interpolate(frame, [12, 28], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
        }}>
          👉 Save this &amp; follow for more
        </div>
      )}
    </div>
  );
}

// ── Background layers ────────────────────────────────────────────────────────

function Background({
  accent, frame, totalFrames, media, frameInSlide,
}: {
  accent: string; frame: number; totalFrames: number;
  media?: { url: string; kind: 'image' | 'video' }; frameInSlide: number;
}) {
  const { r, g, b } = hexToRgb(accent.startsWith('#') ? accent : '#F5A623');
  const orbY = interpolate(frame, [0, totalFrames], [55, 45]);
  const orbX = interpolate(frame, [0, totalFrames], [50, 52]);
  const pulse = 1 + 0.04 * Math.sin((frame / REEL_FPS) * Math.PI);

  // Slow Ken Burns zoom on the image
  const imgScale = media
    ? interpolate(frameInSlide, [0, FRAMES_PER_SLIDE], [1.0, 1.06], { extrapolateRight: 'clamp' })
    : 1;

  return (
    <>
      <AbsoluteFill style={{ background: `rgb(8,6,4)` }} />

      {media ? (
        <>
          {/* Full-bleed background with Ken Burns zoom. Video plays muted:
              the reel's own TTS track is the audio. OffthreadVideo has no
              loop prop — a clip shorter than its slide holds its last frame,
              which is what we want anyway (a black gap would be worse). */}
          <AbsoluteFill style={{ overflow: 'hidden' }}>
            {media.kind === 'video' ? (
              <OffthreadVideo
                src={media.url}
                muted
                style={{
                  width: '100%', height: '100%',
                  objectFit: 'cover',
                  transform: `scale(${imgScale})`,
                  transformOrigin: 'center center',
                }}
              />
            ) : (
              <Img
                src={media.url}
                style={{
                  width: '100%', height: '100%',
                  objectFit: 'cover',
                  transform: `scale(${imgScale})`,
                  transformOrigin: 'center center',
                }}
              />
            )}
          </AbsoluteFill>
          {/* Heavy dark gradient overlay — bottom to top, keeps text legible */}
          <AbsoluteFill style={{
            background: `linear-gradient(
              to top,
              rgba(0,0,0,0.92) 0%,
              rgba(0,0,0,0.65) 35%,
              rgba(0,0,0,0.35) 60%,
              rgba(0,0,0,0.15) 100%)`,
          }} />
          {/* Accent colour wash — subtly tints the image with brand colour */}
          <AbsoluteFill style={{
            background: `rgba(${r},${g},${b},0.12)`,
            mixBlendMode: 'color',
          }} />
        </>
      ) : (
        <>
          {/* Fallback: gradient orb background (no image) */}
          <AbsoluteFill style={{
            background: `radial-gradient(ellipse ${700 * pulse}px ${500 * pulse}px at ${orbX}% ${orbY}%,
              rgba(${r},${g},${b},0.18) 0%,
              rgba(${r},${g},${b},0.06) 45%,
              transparent 70%)`,
          }} />
          <AbsoluteFill style={{
            background: `radial-gradient(ellipse 80% 80% at 50% 50%,
              transparent 40%, rgba(0,0,0,0.75) 100%)`,
          }} />
        </>
      )}

      {/* Scan-line texture */}
      <AbsoluteFill style={{
        backgroundImage: `repeating-linear-gradient(
          0deg, transparent, transparent 3px,
          rgba(255,255,255,0.012) 3px, rgba(255,255,255,0.012) 4px)`,
      }} />

      {/* Left brand stripe */}
      <div style={{
        position: 'absolute', left: 0, top: '20%', bottom: '20%',
        width: 4,
        background: `linear-gradient(to bottom, transparent, rgba(${r},${g},${b},0.8), transparent)`,
        borderRadius: '0 2px 2px 0',
      }} />
    </>
  );
}

// ── Main composition ─────────────────────────────────────────────────────────

export const ReelComposition: React.FC<ReelProps> = ({
  slides, handle, accent, target, backgroundImages = [], backgroundMedia,
  aspect = 'portrait', transition = 'fade',
}) => {
  // backgroundMedia wins; fall back to treating backgroundImages as stills so
  // any caller that hasn't been updated keeps rendering exactly as before.
  const media = backgroundMedia ?? backgroundImages.map(url => ({ url, kind: 'image' as const }));
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const slideIndex    = Math.min(Math.floor(frame / FRAMES_PER_SLIDE), slides.length - 1);
  const frameInSlide  = frame - slideIndex * FRAMES_PER_SLIDE;
  const progress      = frame / durationInFrames;
  const isLastSlide   = slideIndex === slides.length - 1;
  const displayHandle = handle.startsWith('@') ? handle : `@${handle}`;
  const { r, g, b }   = hexToRgb(accent.startsWith('#') ? accent : '#F5A623');

  // Transition styles
  const entryStyle = getTransitionStyle(transition, frameInSlide, true);
  const isFirstFrame = frameInSlide === 0;

  // Layout adjustments per aspect ratio
  const isLandscape = aspect === 'landscape';
  const isSquare = aspect === 'square';
  const bottomOffset = isLandscape
    ? (target === 'youtube_shorts' ? 100 : 80)
    : isSquare
      ? (target === 'youtube_shorts' ? 160 : 130)
      : (target === 'youtube_shorts' ? 240 : 200);
  const topHudY = isLandscape ? 28 : isSquare ? 36 : 56;
  const dotHudY = isLandscape ? 64 : isSquare ? 80 : 112;
  const handleSize = isLandscape ? 22 : isSquare ? 24 : 28;
  const counterBottom = bottomOffset - 40;

  return (
    <AbsoluteFill style={{
      fontFamily: `'DM Sans','Inter',system-ui,sans-serif`,
      overflow: 'hidden',
    }}>
      {/* Background with transition */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        ...entryStyle,
      }}>
        <Background
          accent={accent} frame={frame} totalFrames={durationInFrames}
          media={media[slideIndex]}
          frameInSlide={frameInSlide}
        />
      </div>

      {/* ── Top HUD ─────────────────────────────────────────── */}

      {/* Progress bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, height: 4,
        width: `${progress * 100}%`,
        background: `linear-gradient(to right, rgba(${r},${g},${b},0.6), rgba(${r},${g},${b},1))`,
      }} />

      {/* Handle */}
      <div style={{
        position: 'absolute', top: topHudY, left: 0, right: 0,
        display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10,
      }}>
        {/* Dot before handle */}
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: accent }} />
        <span style={{
          fontSize: handleSize, fontWeight: 700,
          color: `rgba(${r},${g},${b},0.9)`,
          letterSpacing: '0.02em',
        }}>
          {displayHandle}
        </span>
      </div>

      {/* Slide progress dots */}
      <div style={{
        position: 'absolute', top: dotHudY, left: 0, right: 0,
        display: 'flex', justifyContent: 'center', gap: 8,
      }}>
        {slides.map((_, i) => (
          <div key={i} style={{
            height: 4,
            width:  i === slideIndex ? 28 : 8,
            borderRadius: 2,
            background: i < slideIndex
              ? `rgba(${r},${g},${b},0.9)`
              : i === slideIndex
                ? accent
                : 'rgba(255,255,255,0.2)',
            transition: 'width 0.3s',
          }} />
        ))}
      </div>

      {/* ── Bottom-third text scrim ─────────────────────────── */}
      {/* Extra gradient scrim specifically under the text — guarantees legibility
          regardless of what the background image looks like */}
      <AbsoluteFill style={{
        background: isLandscape
          ? `linear-gradient(to top,
              rgba(0,0,0,0.88) 0%,
              rgba(0,0,0,0.60) 35%,
              rgba(0,0,0,0.20) 55%,
              transparent     70%)`
          : `linear-gradient(to top,
              rgba(0,0,0,0.88) 0%,
              rgba(0,0,0,0.72) 28%,
              rgba(0,0,0,0.30) 48%,
              transparent     65%)`,
        ...entryStyle,
      }} />

      {/* ── Main text — anchored to bottom third ────────────── */}
      <div style={{
        position: 'absolute',
        bottom: bottomOffset,
        left: 0, right: 0,
        ...entryStyle,
      }}>
        <SlideContent
          text={slides[slideIndex] ?? ''}
          frame={frameInSlide}
          accent={accent}
          isLast={isLastSlide}
          hasImage={!!media[slideIndex]}
          aspect={aspect}
        />
      </div>

      {/* ── Bottom HUD ──────────────────────────────────────── */}

      {/* Slide counter */}
      <div style={{
        position: 'absolute',
        bottom: counterBottom,
        right: 44,
        fontSize: isLandscape ? 18 : 24, fontWeight: 700,
        color: 'rgba(255,255,255,0.25)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {slideIndex + 1}/{slides.length}
      </div>

      {/* YouTube Shorts side icons */}
      {target === 'youtube_shorts' && !isLandscape && (
        <div style={{
          position: 'absolute', right: 32,
          bottom: isSquare ? 180 : 260,
          display: 'flex', flexDirection: 'column', gap: 36, alignItems: 'center',
        }}>
          {['👍','💬','↗️','⋯'].map(ic => (
            <div key={ic} style={{ fontSize: isSquare ? 36 : 44, filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.6))' }}>
              {ic}
            </div>
          ))}
        </div>
      )}

      {/* Instagram bottom actions */}
      {target !== 'youtube_shorts' && !isLandscape && (
        <div style={{
          position: 'absolute', bottom: isSquare ? 40 : 64, left: 44,
          display: 'flex', gap: 28, alignItems: 'center',
        }}>
          {['♥', '💬', '↗'].map(ic => (
            <div key={ic} style={{
              fontSize: isSquare ? 32 : 40, opacity: 0.7,
              filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
            }}>{ic}</div>
          ))}
        </div>
      )}

      {/* Corner accent element */}
      <div style={{
        position: 'absolute',
        bottom: isLandscape ? 28 : isSquare ? 36 : 52,
        right: 44,
        width: isLandscape ? 36 : 48, height: isLandscape ? 36 : 48,
        borderRadius: '50%',
        border: `3px solid rgba(${r},${g},${b},0.5)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: isLandscape ? 16 : 20,
      }}>
        ⊕
      </div>
    </AbsoluteFill>
  );
};

