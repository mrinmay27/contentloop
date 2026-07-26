/**
 * The built-in niches offered on step 1 of the create-page wizard.
 *
 * These used to be display-only mock data (a name, an emoji and some scores)
 * living inside CreatePageModal, so choosing one produced a page that never
 * reached the server and vanished on reload. Each preset now carries the real
 * keywords and persona that POST /api/niches requires, so the built-in path
 * creates a genuine niche exactly like the custom path does.
 *
 * `keywords` drive ingestion and semantic scoring; `monetizationKeywords`
 * mark topics with commercial intent; `targetPersona` is fed to the LLM.
 */

export type NichePreset = {
  id: string;
  name: string;
  emoji: string;
  /** Display-only signals shown on the niche cards. */
  trendScore: number;
  monetizationScore: number;
  competition: "Low" | "Med" | "High";
  growth: string;
  keywords: string[];
  monetizationKeywords: string[];
  targetPersona: string;
};

export const NICHE_PRESETS: NichePreset[] = [
  {
    id: "n1", name: "AI Tools", emoji: "🤖",
    trendScore: 97, monetizationScore: 92, competition: "High", growth: "+34%",
    keywords: ["ai tools", "chatgpt", "llm", "ai agents", "prompt engineering",
      "generative ai", "ai automation", "copilot"],
    monetizationKeywords: ["pricing", "free tier", "alternative", "review", "vs"],
    targetPersona: "Knowledge workers and founders who want practical AI tools they can use today, not research papers.",
  },
  {
    id: "n2", name: "Side Hustles", emoji: "💰",
    trendScore: 94, monetizationScore: 96, competition: "Med", growth: "+28%",
    keywords: ["side hustle", "passive income", "freelancing", "online business",
      "digital products", "solopreneur", "extra income"],
    monetizationKeywords: ["how much i made", "earnings", "revenue", "course", "template"],
    targetPersona: "People with a day job who want a realistic second income stream and distrust get-rich-quick advice.",
  },
  {
    id: "n3", name: "Crypto & Web3", emoji: "⛓️",
    trendScore: 85, monetizationScore: 88, competition: "High", growth: "+19%",
    keywords: ["bitcoin", "ethereum", "defi", "stablecoin", "crypto regulation",
      "onchain", "web3", "tokenomics"],
    monetizationKeywords: ["exchange", "yield", "airdrop", "wallet", "staking"],
    targetPersona: "Retail crypto participants who want signal on real developments rather than price hype.",
  },
  {
    id: "n4", name: "Fitness & Health", emoji: "💪",
    trendScore: 91, monetizationScore: 85, competition: "High", growth: "+22%",
    keywords: ["strength training", "hypertrophy", "nutrition", "protein",
      "fat loss", "mobility", "sleep quality", "longevity"],
    monetizationKeywords: ["supplement", "program", "coaching", "meal plan", "equipment"],
    targetPersona: "Busy adults who want evidence-based training and nutrition advice without gym-bro mythology.",
  },
  {
    id: "n5", name: "Personal Finance", emoji: "📊",
    trendScore: 89, monetizationScore: 93, competition: "Med", growth: "+31%",
    keywords: ["index funds", "budgeting", "compound interest", "retirement",
      "emergency fund", "debt payoff", "tax strategy", "savings rate"],
    monetizationKeywords: ["brokerage", "credit card", "high yield", "fees", "calculator"],
    targetPersona: "Working adults building wealth steadily who want plain-language money decisions, not stock tips.",
  },
  {
    id: "n6", name: "Mental Health", emoji: "🧠",
    trendScore: 88, monetizationScore: 72, competition: "Low", growth: "+41%",
    keywords: ["anxiety", "burnout", "therapy", "cbt", "mindfulness",
      "emotional regulation", "boundaries", "nervous system"],
    monetizationKeywords: ["app", "workbook", "therapist", "program", "journal"],
    targetPersona: "Adults managing everyday stress and burnout who want compassionate, practical, non-clinical guidance.",
  },
  {
    id: "n7", name: "Productivity", emoji: "⚡",
    trendScore: 86, monetizationScore: 80, competition: "Med", growth: "+18%",
    keywords: ["deep work", "time blocking", "focus", "note taking",
      "second brain", "habit building", "task management"],
    monetizationKeywords: ["app", "template", "notion", "course", "planner"],
    targetPersona: "Overloaded professionals who want systems that survive a real week, not aesthetic desk setups.",
  },
  {
    id: "n8", name: "Travel Hacks", emoji: "✈️",
    trendScore: 83, monetizationScore: 78, competition: "Med", growth: "+15%",
    keywords: ["award travel", "points and miles", "cheap flights", "carry on",
      "visa rules", "digital nomad", "layover"],
    monetizationKeywords: ["credit card", "booking", "deal", "insurance", "lounge"],
    targetPersona: "Frequent independent travellers who optimise cost and logistics rather than luxury.",
  },
  {
    id: "n9", name: "Real Estate", emoji: "🏠",
    trendScore: 80, monetizationScore: 94, competition: "Low", growth: "+12%",
    keywords: ["mortgage rates", "rental yield", "housing market", "reit",
      "first time buyer", "property tax", "landlord"],
    monetizationKeywords: ["lender", "refinance", "closing costs", "agent", "calculator"],
    targetPersona: "Prospective buyers and small landlords who want grounded market analysis and real numbers.",
  },
  {
    id: "n10", name: "Sustainable Living", emoji: "🌿",
    trendScore: 79, monetizationScore: 70, competition: "Low", growth: "+47%",
    keywords: ["zero waste", "energy efficiency", "solar", "composting",
      "sustainable fashion", "carbon footprint", "repairability"],
    monetizationKeywords: ["brand", "rebate", "worth it", "cost", "swap"],
    targetPersona: "People making practical greener choices at home who want honest trade-offs, not guilt.",
  },
  {
    id: "n11", name: "Creator Economy", emoji: "🎬",
    trendScore: 88, monetizationScore: 89, competition: "Med", growth: "+26%",
    keywords: ["youtube algorithm", "audience growth", "newsletter", "sponsorship",
      "short form video", "personal brand", "creator tools"],
    monetizationKeywords: ["cpm", "brand deal", "rate card", "membership", "revenue"],
    targetPersona: "Independent creators treating content as a business who want tactics with numbers attached.",
  },
  {
    id: "n12", name: "Tech News", emoji: "💻",
    trendScore: 82, monetizationScore: 75, competition: "High", growth: "+11%",
    keywords: ["product launch", "funding round", "acquisition", "open source",
      "developer tools", "security breach", "big tech", "chips"],
    monetizationKeywords: ["pricing", "free tier", "enterprise", "alternative", "benchmark"],
    targetPersona: "Technically literate readers who want what actually shipped and why it matters, minus press-release spin.",
  },
];

export function findNichePreset(id: string): NichePreset | undefined {
  return NICHE_PRESETS.find((preset) => preset.id === id);
}
