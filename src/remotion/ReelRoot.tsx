import React from 'react';
import { Composition, registerRoot } from 'remotion';
import {
  ReelComposition,
  type ReelProps,
  reelDurationFrames,
  REEL_FPS,
  ASPECT_CONFIGS,
  type VideoAspect,
} from './ReelComposition';   // extensionless: Remotion bundles this from
                              // source with webpack, which does not resolve
                              // .js -> .tsx. moduleResolution is "Bundler",
                              // so tsc accepts it too.
import { CaptionedVideo, type CaptionedVideoProps } from './CaptionedVideo';

// Default props for the studio / preview
const DEFAULT_SLIDES = [
  'Stop Working Hard.\nStart Working Smarter.',
  '78% of knowledge workers say AI saves them 5+ hours every week.',
  'The secret? Learn the right 3 tools.',
  'Follow for daily AI productivity breakdowns.',
];

const DEFAULT_PROPS: ReelProps = {
  slides:     DEFAULT_SLIDES,
  handle:     '@aiproductivitydaily',
  accent:     '#F5A623',
  font:       'DM Sans',
  target:     'both',
  aspect:     'portrait',
  transition: 'fade',
};

/**
 * Registers compositions for all three aspect ratios:
 *   - Reel         → 1080×1920 (Portrait, default)
 *   - ReelLandscape → 1920×1080
 *   - ReelSquare    → 1080×1080
 *
 * The render pipeline selects the correct composition ID based on the
 * aspect ratio configured for the content item or page.
 */
export const RemotionRoot: React.FC = () => (
  <>
    {/* Portrait 9:16 — Reels / Shorts (default) */}
    <Composition
      id="Reel"
      component={ReelComposition as any}
      durationInFrames={reelDurationFrames(DEFAULT_SLIDES.length)}
      fps={REEL_FPS}
      width={ASPECT_CONFIGS.portrait.width}
      height={ASPECT_CONFIGS.portrait.height}
      defaultProps={{ ...DEFAULT_PROPS, aspect: 'portrait' as VideoAspect }}
    />

    {/* Landscape 16:9 — YouTube */}
    <Composition
      id="ReelLandscape"
      component={ReelComposition as any}
      durationInFrames={reelDurationFrames(DEFAULT_SLIDES.length)}
      fps={REEL_FPS}
      width={ASPECT_CONFIGS.landscape.width}
      height={ASPECT_CONFIGS.landscape.height}
      defaultProps={{ ...DEFAULT_PROPS, aspect: 'landscape' as VideoAspect }}
    />

    {/* Route 2/3 — a creator's own footage with composited captions. Its
        duration comes from the uploaded clip, so calculateMetadata derives it
        from durationSec rather than using a fixed length that would truncate
        or pad real footage. */}
    <Composition
      id="CaptionedVideo"
      component={CaptionedVideo as any}
      durationInFrames={30 * 10}
      fps={REEL_FPS}
      width={ASPECT_CONFIGS.portrait.width}
      height={ASPECT_CONFIGS.portrait.height}
      defaultProps={{
        videoSrc: '', srt: '', accent: '#F5A623',
      } as CaptionedVideoProps}
      calculateMetadata={({ props }: any) => ({
        durationInFrames: Math.max(
          1,
          Math.round((Number(props.durationSec) || 10) * REEL_FPS),
        ),
      })}
    />

    {/* Square 1:1 — Feed posts */}
    <Composition
      id="ReelSquare"
      component={ReelComposition as any}
      durationInFrames={reelDurationFrames(DEFAULT_SLIDES.length)}
      fps={REEL_FPS}
      width={ASPECT_CONFIGS.square.width}
      height={ASPECT_CONFIGS.square.height}
      defaultProps={{ ...DEFAULT_PROPS, aspect: 'square' as VideoAspect }}
    />
  </>
);

registerRoot(RemotionRoot);
