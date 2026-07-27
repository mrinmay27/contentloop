import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { parseSrt, cueAtFrame, type Cue } from '../domain/srt';

/**
 * Route 2/3 — a creator's own footage with captions composited on top.
 *
 * Captions are rendered here rather than burned in with ffmpeg because neither
 * the bundled Remotion build nor a typical system ffmpeg has the `subtitles`
 * or `drawtext` filters (both need libass/libfreetype). Compositing also gives
 * a stroke + shadow treatment that stays legible over any footage, which a
 * plain overlay would not.
 */

export interface CaptionedVideoProps {
  /** Path relative to the bundle publicDir (MEDIA_DIR). */
  videoSrc: string;
  /** Raw SRT contents. Empty string renders the clip with no captions. */
  srt: string;
  accent: string;
  /** Optional brand logo, also publicDir-relative. */
  logoSrc?: string;
}

/** Assets served from publicDir arrive as relative paths and must go through
 *  staticFile(); http(s)/data sources pass straight through. */
function resolveSrc(src: string): string {
  return /^(https?|data):/.test(src) ? src : staticFile(src);
}

export const CaptionedVideo: React.FC<CaptionedVideoProps> = ({
  videoSrc, srt, accent, logoSrc,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cues: Cue[] = React.useMemo(() => parseSrt(srt ?? ''), [srt]);
  const cue = cueAtFrame(cues, frame, fps);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <OffthreadVideo
        src={resolveSrc(videoSrc)}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />

      {logoSrc && (
        <Img
          src={resolveSrc(logoSrc)}
          alt=""
          style={{
            position: 'absolute', top: 48, left: 48,
            width: 96, height: 96, objectFit: 'contain', opacity: 0.9,
          }}
        />
      )}

      {cue && (
        <AbsoluteFill style={{
          justifyContent: 'flex-end', alignItems: 'center',
          padding: '0 64px 220px',
        }}>
          <div style={{
            fontFamily: 'DM Sans, sans-serif', fontWeight: 700, fontSize: 64,
            lineHeight: 1.2, color: '#fff', textAlign: 'center',
            WebkitTextStroke: '3px rgba(0,0,0,0.85)',
            textShadow: `0 4px 24px rgba(0,0,0,0.9), 0 0 2px ${accent}`,
          }}>
            {cue.text}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
