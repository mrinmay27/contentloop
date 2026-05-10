import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { ReelComposition, type ReelProps, reelDurationFrames, REEL_FPS, REEL_WIDTH, REEL_HEIGHT } from './ReelComposition.js';

// Default props for the studio / preview
const DEFAULT_SLIDES = [
  'Stop Working Hard.\nStart Working Smarter.',
  '78% of knowledge workers say AI saves them 5+ hours every week.',
  'The secret? Learn the right 3 tools.',
  'Follow for daily AI productivity breakdowns.',
];

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Reel"
    component={ReelComposition as any}
    durationInFrames={reelDurationFrames(DEFAULT_SLIDES.length)}
    fps={REEL_FPS}
    width={REEL_WIDTH}
    height={REEL_HEIGHT}
    defaultProps={{
      slides:  DEFAULT_SLIDES,
      handle:  '@aiproductivitydaily',
      accent:  '#F5A623',
      font:    'DM Sans',
      target:  'both',
    }}
  />
);

registerRoot(RemotionRoot);
