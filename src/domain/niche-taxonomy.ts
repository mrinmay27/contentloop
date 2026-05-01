/** Task 2.5.1 — Niche taxonomy system.
 *  A niche_category classifies which sources to activate, which QA rules apply,
 *  and what format to default to. Stored in page/niche config (future: DB column).
 */

export type NicheCategory =
  | "tech"          // AI, software, gadgets, developer tools
  | "finance"       // personal finance, investing, crypto
  | "health"        // fitness, nutrition, wellness, mental health
  | "food"          // recipes, cooking, restaurants
  | "travel"        // destinations, lifestyle, nomad
  | "business"      // entrepreneurship, marketing, startups
  | "creative"      // fashion, beauty, art, design
  | "education"     // learning, students, courses
  | "lifestyle"     // self-improvement, mindset, relationships
  | "entertainment" // gaming, sports, pop culture
  | "sustainability"// climate, environment, eco
  | "other";

/** Map of canonical keywords that strongly imply a niche category. */
const CATEGORY_SIGNALS: Record<NicheCategory, string[]> = {
  tech:          ["ai", "software", "code", "developer", "tech", "llm", "gpt", "machine learning", "startup", "saas", "productivity"],
  finance:       ["finance", "investing", "stock", "crypto", "bitcoin", "money", "budget", "passive income", "financial", "retirement"],
  health:        ["fitness", "health", "wellness", "nutrition", "workout", "mental health", "diet", "exercise", "sleep", "meditation"],
  food:          ["recipe", "cooking", "food", "meal", "restaurant", "baking", "vegan", "keto", "cuisine"],
  travel:        ["travel", "destination", "nomad", "adventure", "tourism", "flight", "hotel", "backpack"],
  business:      ["business", "entrepreneur", "marketing", "sales", "brand", "leadership", "growth", "strategy"],
  creative:      ["fashion", "beauty", "design", "art", "style", "photography", "illustration", "aesthetic"],
  education:     ["learning", "education", "student", "course", "study", "university", "skill", "teach"],
  lifestyle:     ["mindset", "self-improvement", "habits", "productivity", "motivation", "personal development"],
  entertainment: ["gaming", "sports", "movie", "music", "pop culture", "celebrity", "esports"],
  sustainability:["climate", "environment", "sustainability", "eco", "green", "carbon", "renewable"],
  other:         [],
};

/** Classify a niche by name + keywords → NicheCategory (heuristic, no LLM needed). */
export function classifyNiche(nicheName: string, keywords: string[]): NicheCategory {
  const text = [nicheName, ...keywords].join(" ").toLowerCase();

  let bestCategory: NicheCategory = "other";
  let bestScore = 0;

  for (const [category, signals] of Object.entries(CATEGORY_SIGNALS) as [NicheCategory, string[]][]) {
    if (category === "other") continue;
    const matches = signals.filter((signal) => text.includes(signal)).length;
    const score = matches / Math.max(1, signals.length);
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

/** Whether a niche category uses arXiv as a source. */
export function usesArxiv(category: NicheCategory): boolean {
  return ["tech", "health", "education", "finance", "sustainability"].includes(category);
}

/** Whether a niche category uses PubMed as a source. */
export function usesPubMed(category: NicheCategory): boolean {
  return ["health", "food", "education"].includes(category);
}

/** Whether a niche category uses Product Hunt as a source. */
export function usesProductHunt(category: NicheCategory): boolean {
  return ["tech", "business"].includes(category);
}

/** Whether a niche category uses crypto-specific RSS feeds. */
export function usesCryptoSources(category: NicheCategory): boolean {
  return category === "finance";
}

/** Default format for a niche category (page_default tier). */
export function categoryDefaultFormat(category: NicheCategory): "post" | "carousel" | "reel" {
  const carouselCategories: NicheCategory[] = ["health", "food", "education", "finance", "tech", "business"];
  const reelCategories: NicheCategory[] = ["entertainment", "lifestyle", "creative", "travel"];
  if (carouselCategories.includes(category)) return "carousel";
  if (reelCategories.includes(category)) return "reel";
  return "post";
}
