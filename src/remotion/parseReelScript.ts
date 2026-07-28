// Parse the free-form reel script textarea into an array of slide strings.
//
// A new slide starts at a blank line OR at a labelled section (Hook:, Body:,
// CTA:, Intro:, Outro:), with or without wrapping brackets.
//
// The label rule is new. This file always documented it, but the code only
// ever split on blank lines and merely stripped a label from the front of a
// block. So a labelled script written on single newlines — which is exactly
// what the render job reconstructs — collapsed into ONE slide carrying the
// entire script for the whole video.

/** Sections that begin a new slide. Deliberately a closed list: a stray
 *  "Note:" or "Tip:" must not silently split someone's sentence. */
const SECTION_LABELS = ["hook", "body", "cta", "intro", "outro"];

const LABEL_LINE = new RegExp(
  `^\\[?\\s*(?:${SECTION_LABELS.join("|")})\\s*:\\s*`,
  "i"
);

/** Remove a leading label and any wrapping brackets from a block. */
function stripLabel(block: string): string {
  return block
    .replace(LABEL_LINE, "")
    .replace(/\]\s*$/, "")
    .trim();
}

export function parseReelScript(script: string): string[] {
  if (!script.trim()) return ["No script yet"];

  const slides: string[] = [];

  for (const paragraph of script.split(/\n{2,}/)) {
    if (!paragraph.trim()) continue;

    // Within a paragraph a labelled line also starts a new slide; its
    // continuation lines stay attached to it.
    let current: string[] = [];
    const flush = () => {
      const text = stripLabel(current.join("\n"));
      if (text) slides.push(text);
      current = [];
    };

    for (const line of paragraph.split("\n")) {
      if (LABEL_LINE.test(line.trim()) && current.length > 0) flush();
      current.push(line);
    }
    flush();
  }

  return slides.length > 0 ? slides : [script.trim()];
}
