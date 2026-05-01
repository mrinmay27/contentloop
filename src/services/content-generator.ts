import { llmClient, llmConfig } from "../config/llm.js";
import { sanitizeLlmFormat, suggestFormatByRules } from "../domain/format-rules.js";
import { scoreHook } from "../domain/scoring.js";
import type { FormatConfidence, GeneratedContent, Niche, Page, SuggestedFormat, Topic } from "../domain/types.js";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

async function callLLM(prompt: string): Promise<string | null> {
  if (!llmClient) return null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const completion = await llmClient.chat.completions.create({
        model: llmConfig.model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You generate concise, high-retention social content. Return valid JSON only. Avoid spam, false claims, and generic motivational filler."
          },
          { role: "user", content: prompt }
        ]
      });
      return completion.choices[0]?.message.content ?? null;
    } catch (error: any) {
      const status = error?.status ?? error?.response?.status;
      const isRetryable = status === 429 || status === 502 || status === 503;
      console.error(`[generate] LLM attempt ${attempt + 1}/${MAX_RETRIES} failed (${status ?? "unknown"}): ${error?.message}`);

      if (isRetryable && attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.log(`[generate] Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.error(`[generate] All retries exhausted or non-retryable error. Using fallback content.`);
        return null;
      }
    }
  }
  return null;
}

export interface GenerateResult {
  content: GeneratedContent;
  suggestedFormat: SuggestedFormat;
  formatConfidence: FormatConfidence;
}

export async function generateContent(
  topic: Topic,
  niche: Niche,
  pages: Page[]
): Promise<GenerateResult> {
  const prompt = buildPrompt(topic, niche, pages);
  const raw = await callLLM(prompt);

  if (!raw) {
    console.log(`[generate] Using fallback content for topic: "${topic.title}"`);
    const rulesResult = suggestFormatByRules(
      topic.title,
      topic.sources[0] ?? "",
      topic.score ?? 0
    );
    return {
      content: fallbackContent(topic, niche, pages),
      suggestedFormat: rulesResult.format,
      formatConfidence: "rule"
    };
  }

  try {
    const parsed = JSON.parse(raw);
    const content = normalizeGeneratedContent(parsed, topic, niche, pages);

    // --- Format decision ---
    const llmRawFormat = parsed.suggested_format as SuggestedFormat | undefined;
    const primarySource = topic.sources[0] ?? "";

    if (llmRawFormat && ["post", "carousel", "reel"].includes(llmRawFormat)) {
      // LLM gave us a format — run sanity check
      const { format, confidence } = sanitizeLlmFormat(
        llmRawFormat,
        topic.title,
        primarySource,
        topic.score ?? 0
      );
      return { content, suggestedFormat: format, formatConfidence: confidence };
    } else {
      // LLM didn't return a format — fall back to rules
      const rulesResult = suggestFormatByRules(
        topic.title,
        primarySource,
        topic.score ?? 0
      );
      return { content, suggestedFormat: rulesResult.format, formatConfidence: "rule" };
    }
  } catch {
    console.error(`[generate] Failed to parse LLM response for "${topic.title}", using fallback`);
    const rulesResult = suggestFormatByRules(
      topic.title,
      topic.sources[0] ?? "",
      topic.score ?? 0
    );
    return {
      content: fallbackContent(topic, niche, pages),
      suggestedFormat: rulesResult.format,
      formatConfidence: "rule"
    };
  }
}

function buildPrompt(topic: Topic, niche: Niche, pages: Page[]): string {
  return JSON.stringify({
    task: "Generate content for theme pages",
    topic: topic.title,
    keywords: topic.keywords,
    niche: niche.name,
    targetPersona: niche.targetPersona,
    platforms: [...new Set(pages.map((page) => page.platform))],
    requirements: {
      reelScripts: "exactly 2 scripts, 30-45 seconds each, with hook/script/cta",
      carousel: "exactly 8 slides: hook, slides 2-6 value, slide 7 summary, slide 8 CTA",
      captions: "platform-specific for instagram and youtube_shorts",
      hashtags: "exactly 10 relevant hashtags",
      tone: "clear, useful, specific, not spammy",
      suggested_format: [
        "Also decide the best Instagram format for this topic:",
        "  'post'     → breaking news, single insight, quote, announcement, hot take",
        "  'carousel' → how-to, list, step-by-step, educational, tips, deep-dives, research",
        "  'reel'     → trending/viral topic, personality, story, emotional hook, early signal",
        "Return the format name as the 'suggested_format' key at the top level of your JSON."
      ].join(" ")
    },
    outputShape: {
      suggested_format: "'post' | 'carousel' | 'reel'",
      reelScripts: [{ title: "string", hook: "string", script: "string", cta: "string" }],
      carousel: [{ slide: 1, title: "string", body: "string" }],
      captions: { instagram: "string", youtube_shorts: "string" },
      hashtags: ["string"]
    }
  });
}

function normalizeGeneratedContent(input: any, topic: Topic, niche: Niche, pages: Page[]): GeneratedContent {
  const fallback = fallbackContent(topic, niche, pages);
  const reelScripts = Array.isArray(input.reelScripts) ? input.reelScripts.slice(0, 2) : fallback.reelScripts;
  const scoredScripts = reelScripts.map((script: any, index: number) => {
    const hook = String(script.hook ?? fallback.reelScripts[index]?.hook ?? fallback.reelScripts[0].hook);
    return {
      title: String(script.title ?? `Reel ${index + 1}`),
      hook,
      script: String(script.script ?? fallback.reelScripts[index]?.script ?? fallback.reelScripts[0].script),
      cta: String(script.cta ?? fallback.reelScripts[index]?.cta ?? fallback.reelScripts[0].cta),
      hookScore: scoreHook(hook).score
    };
  });

  while (scoredScripts.length < 2) scoredScripts.push(fallback.reelScripts[scoredScripts.length]);

  return {
    reelScripts: scoredScripts,
    carousel: Array.isArray(input.carousel) && input.carousel.length === 8 ? input.carousel : fallback.carousel,
    captions: {
      instagram: String(input.captions?.instagram ?? fallback.captions.instagram),
      youtube_shorts: String(input.captions?.youtube_shorts ?? fallback.captions.youtube_shorts)
    },
    hashtags: Array.isArray(input.hashtags) ? input.hashtags.slice(0, 10).map(String) : fallback.hashtags
  };
}

function fallbackContent(topic: Topic, niche: Niche, pages: Page[]): GeneratedContent {
  const hooks = [
    `Stop ignoring this ${niche.name} trend before it gets crowded`,
    `Most people miss this ${topic.keywords[0] ?? niche.name} signal until it is too late`
  ];

  const reelScripts = hooks.map((hook, index) => ({
    title: `${topic.title} angle ${index + 1}`,
    hook,
    script:
      `Hook: ${hook}. ` +
      `Context: ${topic.title} is appearing across ${topic.sourceCount} source(s). ` +
      `Point 1: watch the behavior behind the trend, not just the headline. ` +
      `Point 2: connect it to a specific pain point for ${niche.targetPersona}. ` +
      `Point 3: turn the insight into one small action today.`,
    cta: "Save this and follow for the next signal before it peaks.",
    hookScore: scoreHook(hook).score
  }));

  const carousel = [
    { slide: 1, title: hooks[0], body: "A fresh signal is forming. Here is what to watch." },
    { slide: 2, title: "What changed", body: `${topic.title} is gaining attention across ${topic.sources.join(", ")}.` },
    { slide: 3, title: "Why it matters", body: `It maps to ${niche.targetPersona}'s current goals and objections.` },
    { slide: 4, title: "The practical angle", body: "Focus on a repeatable action, not a broad opinion." },
    { slide: 5, title: "Content angle", body: "Lead with the mistake, then show the smarter replacement." },
    { slide: 6, title: "CTA angle", body: "Offer a save-worthy checklist or ask for a specific comment." },
    { slide: 7, title: "Summary", body: "Trend, audience pain, practical action, clear CTA." },
    { slide: 8, title: "Next step", body: "Save this post and follow for tomorrow's trend breakdown." }
  ];

  const captions = {
    instagram: `${topic.title}\n\nUse this before the topic becomes crowded. Save it for your next content planning session.`,
    youtube_shorts: `${topic.title}. A quick signal to act on today. Subscribe for daily theme-page ideas.`
  };

  const baseTags = [niche.name, ...topic.keywords, "contentstrategy", "theme pages", "socialgrowth"];
  const hashtags = [...new Set(baseTags)]
    .slice(0, 10)
    .map((tag) => `#${tag.toLowerCase().replace(/[^a-z0-9]+/g, "")}`)
    .filter((tag) => tag.length > 1);

  while (hashtags.length < 10) hashtags.push(`#${["trends", "creator", "marketing", "growth", "reels"][hashtags.length % 5]}`);

  void pages;
  return { reelScripts, carousel, captions, hashtags };
}
