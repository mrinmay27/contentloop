export type PublishPlatform = 'instagram' | 'linkedin' | 'twitter' | 'reddit' | 'facebook' | 'youtube_shorts';

const LIMITS: Record<PublishPlatform, { caption: number; maxHashtags: number }> = {
  instagram: { caption: 2200,  maxHashtags: 30 },
  linkedin:  { caption: 3000,  maxHashtags: 5  },
  twitter:   { caption: 280,   maxHashtags: 2  },
  reddit:    { caption: 40000, maxHashtags: 0  },
  facebook:  { caption: 63206, maxHashtags: 10 },
  youtube_shorts: { caption: 5000, maxHashtags: 15 },
};

export const PLATFORM_META: Record<PublishPlatform, { label: string; icon: string; color: string }> = {
  instagram: { label: 'Instagram', icon: '📸', color: '#E1306C' },
  linkedin:  { label: 'LinkedIn',  icon: '💼', color: '#0A66C2' },
  twitter:   { label: 'Twitter / X', icon: '𝕏', color: '#000000' },
  reddit:    { label: 'Reddit',    icon: '🤖', color: '#FF4500' },
  facebook:  { label: 'Facebook',  icon: '👍', color: '#1877F2' },
  youtube_shorts: { label: 'YouTube Shorts', icon: '▶️', color: '#FF0000' },
};

export function formatCaption(opts: {
  platform: PublishPlatform;
  hook:     string;
  caption:  string;
  hashtags?: string[];
}): string {
  const { platform, hook, caption, hashtags = [] } = opts;
  // An unrecognised platform used to throw a destructuring TypeError, which
  // surfaced as a 500 with no clue that the platform name was the problem.
  const limits = LIMITS[platform];
  if (!limits) throw new Error(`Unknown publish platform: ${platform}`);
  const { caption: limit, maxHashtags } = limits;

  const tags = hashtags
    .slice(0, maxHashtags)
    .map(t => t.startsWith('#') ? t : `#${t}`)
    .join(' ');

  if (platform === 'twitter') {
    // Twitter: hook only (fits in 280), append 1-2 hashtags
    const base = hook.trim();
    const suffix = tags ? ` ${tags}` : '';
    const full = base + suffix;
    return full.length <= limit ? full : base.slice(0, limit - suffix.length - 1) + '…' + suffix;
  }

  if (platform === 'reddit') {
    // Reddit: title = hook, body = full caption — return full caption (title handled separately)
    return caption.trim();
  }

  // Default: hook + newlines + caption + hashtags
  const parts = [hook.trim(), '', caption.trim()];
  if (tags) parts.push('', tags);
  const full = parts.join('\n');

  if (full.length <= limit) return full;
  // Trim caption to fit
  const overhead = hook.length + (tags ? tags.length + 2 : 0) + 4; // 4 for newlines
  const bodyLimit = limit - overhead;
  const trimmedCaption = caption.trim().slice(0, bodyLimit - 1) + '…';
  return [hook.trim(), '', trimmedCaption, ...(tags ? ['', tags] : [])].join('\n');
}
