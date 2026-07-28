/** How many slides a carousel or script-built reel should have.
 *
 *  Generation previously demanded EXACTLY 8 and silently substituted generic
 *  fallback content for anything else, so a good 7- or 9-slide carousel was
 *  thrown away with no warning. The count is now a preference with a tolerant
 *  range, resolved per content item, then per page, then a default.
 *
 *  Pure — no I/O.
 */

export const MIN_SLIDES = 3;
/** Instagram allows 10 images in a carousel; a little headroom above that is
 *  useful for reels, which have no such limit. */
export const MAX_SLIDES = 15;
export const DEFAULT_SLIDES = 8;

const usable = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && Number.isFinite(n);

export function resolveSlideCount(input: {
  contentOverride?: number;
  pageDefault?: number;
}): number {
  const chosen = usable(input.contentOverride) ? input.contentOverride
    : usable(input.pageDefault) ? input.pageDefault
    : DEFAULT_SLIDES;
  // Clamp rather than reject: an out-of-range preference should never be the
  // reason generation produces nothing.
  return Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, chosen));
}

/** Accept any carousel within range instead of one exact length. */
export function isAcceptableCarousel(carousel: unknown): boolean {
  return Array.isArray(carousel)
    && carousel.length >= MIN_SLIDES
    && carousel.length <= MAX_SLIDES;
}

/** Editor slide shape. */
export interface EditorSlide { id: number; text: string }

/**
 * Convert generated carousel entries into the shape the editor edits.
 *
 * The generator writes payload.carousel as {slide,title,body}; the editor
 * hydrates from payload.slides as {id,text}. Because those never matched, the
 * LLM's carousel was stored and then ignored — every content item opened
 * showing the editor's six hardcoded placeholders instead.
 */
export function carouselToEditorSlides(carousel: unknown): EditorSlide[] {
  if (!Array.isArray(carousel)) return [];
  return carousel
    .map((entry: any, i) => {
      const text = [entry?.title, entry?.body]
        .map((part) => (typeof part === "string" ? part.trim() : ""))
        .filter(Boolean)
        .join("\n");
      return { id: Number.isInteger(entry?.slide) ? entry.slide : i + 1, text };
    })
    .filter((slide) => slide.text.length > 0);
}
