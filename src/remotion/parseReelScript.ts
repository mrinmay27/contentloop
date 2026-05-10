// Parse the free-form reel script textarea into an array of slide strings.
// Each double-newline or labelled section (Hook:, Body:, CTA:) becomes one slide.
export function parseReelScript(script: string): string[] {
  if (!script.trim()) return ['No script yet'];

  // Split on blank lines
  const blocks = script
    .split(/\n{2,}/)
    .map(b => b.trim())
    .filter(Boolean);

  const slides: string[] = [];

  for (const block of blocks) {
    // Strip section labels like "Hook:", "Body:", "CTA:" at the start of a block
    const cleaned = block.replace(/^(hook|body|cta|intro|outro)\s*:\s*/i, '').trim();
    if (cleaned) slides.push(cleaned);
  }

  return slides.length > 0 ? slides : [script.trim()];
}
