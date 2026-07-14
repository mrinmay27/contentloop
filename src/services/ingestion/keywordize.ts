/**
 * Shared keyword extraction for all ingestion sources.
 *
 * Priority order: multi-word compounds → single niche-signal words → other domain words.
 * Single words alone are often ambiguous ("budget" could be anything; "budget carrier"
 * is unambiguously personal-finance + aviation). Compounds resolve that ambiguity.
 */

const STOP_WORDS = new Set<string>([
  // Articles & determiners
  "a", "an", "the", "this", "that", "these", "those", "such",
  // Prepositions
  "about", "above", "across", "after", "against", "along", "among", "around",
  "at", "before", "behind", "between", "beyond", "by", "despite", "down",
  "during", "except", "for", "from", "in", "inside", "into", "like", "near",
  "of", "off", "on", "onto", "out", "outside", "over", "past", "since",
  "through", "throughout", "to", "toward", "under", "until", "up", "upon",
  "with", "within", "without",
  // Conjunctions & question words
  "and", "but", "or", "nor", "so", "yet", "both", "either", "neither",
  "although", "because", "while", "when", "where", "whether",
  "why", "how", "than", "then",
  // Pronouns
  "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
  "she", "her", "it", "its", "they", "them", "their", "what", "which",
  "who", "whom", "whose",
  // Auxiliary verbs
  "am", "are", "is", "was", "were", "be", "been", "being",
  "have", "has", "had", "will", "would", "could", "should",
  "may", "might", "shall", "must", "can",
  // Vague action verbs that don't signal niche
  "get", "gets", "got", "make", "makes", "made", "take", "takes", "took",
  "come", "came", "goes", "went", "give", "gave", "find", "found",
  "know", "knew", "think", "thought", "see", "saw", "look", "looked",
  "want", "wanted", "use", "used", "seem", "seemed", "feel", "felt",
  "try", "tried", "keep", "kept", "let", "set", "put", "ask", "asked",
  "help", "helps", "helped", "show", "showed", "shown", "move", "moved",
  "turn", "turned", "call", "called", "play", "played", "run", "ran",
  "leave", "left", "begin", "began", "become", "became", "happen", "happened",
  "work", "works", "worked", "need", "needs", "needed", "want", "wants",
  "build", "builds", "built", "stick", "sticks", "stuck",
  "release", "releases", "released",
  // News-specific vague verbs
  "says", "said", "tell", "told", "warn", "warns", "warned",
  "urge", "urges", "urged", "claim", "claims", "claimed",
  "report", "reports", "reported", "announce", "announced",
  "reveal", "reveals", "revealed", "face", "faces", "faced",
  "scramble", "scrambles", "scrambled",
  "push", "pushes", "pushed", "pull", "pulls", "pulled",
  "hit", "hits", "rise", "rises", "rose", "risen",
  "fall", "falls", "fell", "fallen", "drop", "drops", "dropped",
  "raise", "raises", "raised", "launch", "launches", "launched",
  "amid", "after", "before",
  // Common adverbs
  "also", "just", "only", "even", "still", "already", "now", "then",
  "here", "there", "very", "quite", "rather", "almost", "enough",
  "more", "most", "less", "least", "much", "many", "few", "little",
  "some", "any", "all", "each", "every", "other", "another",
  "next", "last", "first", "second",
  // Generic adjectives
  "new", "old", "big", "small", "large", "long", "short", "high", "low",
  "good", "bad", "great", "best", "better", "worst", "worse",
  "right", "left", "back", "top", "full", "open", "free", "real",
  "true", "false", "sure", "clear", "hard", "easy", "major", "key",
  "recent", "latest", "current", "former", "possible",
  "advanced", "rising", "young", "old", "growing", "increasing", "leading",
  // Numbers as words
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  // Generic nouns that don't signal niche
  "time", "year", "years", "day", "days", "week", "weeks", "month", "months",
  "way", "ways", "thing", "things", "fact", "case", "part", "end",
  "point", "side", "hand", "number", "lot", "bit", "kind", "line",
  "head", "area", "form", "order", "level", "world", "life", "home",
  "place", "people", "person", "man", "woman", "child", "country", "city", "state",
  "news", "story", "update", "plan", "deal", "issue", "problem",
  "result", "effect", "impact", "role", "reason", "cause", "type", "version",
  "stranded", "passengers", "customer", "customers", "user", "users",
  "experts", "expert", "analyst", "analysts", "officials", "official",
  "adults", "adult", "seniors", "children", "teens", "youth",
  "matters", "matter", "model", "models", "system", "systems",
  "freedom", "power", "future", "trend", "trends", "guide", "tips",
]);

// These words directly imply a niche category — sorted ahead of generic domain words
const NICHE_SIGNAL_WORDS = new Set<string>([
  // Finance
  "finance", "financial", "investing", "investment", "investor", "investors",
  "stock", "stocks", "crypto", "bitcoin", "ethereum", "blockchain", "nft",
  "money", "budget", "budgeting", "income", "retirement", "pension",
  "bank", "banking", "loan", "loans", "debt", "savings",
  "portfolio", "dividend", "dividends", "market", "markets", "recession",
  "inflation", "mortgage", "interest", "fund", "funds", "etf", "ipo",
  "venture", "capital", "equity", "bond", "bonds", "treasury", "forex",
  "currency", "currencies", "wallet", "payment", "payments", "tax", "taxes",
  "insurance", "yield", "revenue", "profit", "loss", "bankruptcy", "bailout",
  "airline", "airlines", "carrier", "carriers", "fare", "fares",
  // Tech
  "ai", "artificial", "intelligence", "machine", "learning", "deep",
  "neural", "network", "llm", "gpt", "chatgpt", "openai", "anthropic",
  "software", "code", "coding", "developer", "developers", "programming",
  "tech", "technology", "startup", "saas", "cloud", "api",
  "algorithm", "framework", "database", "github",
  "cybersecurity", "security", "privacy", "app", "platform",
  "automation", "robot", "robotics", "quantum", "semiconductor", "chip", "chips",
  // Health
  "fitness", "health", "healthcare", "wellness", "nutrition",
  "workout", "workouts", "mental", "diet", "dieting", "exercise", "sleep",
  "meditation", "therapy", "therapist", "clinical", "medical", "medicine",
  "doctor", "patient", "vaccine", "treatment", "drug", "pharma", "hospital",
  "disease", "illness", "symptom", "recovery",
  // Food
  "recipe", "recipes", "cooking", "food", "meal", "meals", "restaurant",
  "baking", "vegan", "keto", "cuisine", "ingredients",
  "protein", "calorie", "calories",
  // Travel
  "travel", "traveling", "destination", "nomad", "adventure", "tourism",
  "tourist", "flight", "flights", "hotel", "hotels", "backpack", "backpacking",
  "visa", "passport", "itinerary", "cruise",
  // Business
  "business", "businesses", "entrepreneur", "entrepreneurs", "entrepreneurship",
  "marketing", "sales", "brand", "branding", "leadership", "growth", "strategy",
  "management", "ceo", "founder", "agency", "acquisition", "merger",
  // Creative
  "fashion", "beauty", "design", "designer", "art", "artist", "style",
  "photography", "photographer", "illustration", "aesthetic", "creative",
  "creator", "influencer",
  // Education
  "learning", "education", "educational", "student", "students", "course",
  "courses", "study", "studying", "university", "college", "skill", "skills",
  "teacher", "teaching", "curriculum", "degree",
  // Lifestyle
  "mindset", "habits", "productivity", "motivation", "development",
  "self", "improvement", "relationship", "relationships", "wellbeing",
  // Entertainment
  "gaming", "games", "gamer", "sports", "sport", "movie", "movies", "film",
  "music", "musician", "celebrity", "esports", "streaming",
  // Sustainability
  "climate", "environment", "environmental", "sustainability", "sustainable",
  "eco", "green", "carbon", "renewable", "solar", "electric", "emissions",
  "fossil", "energy",
]);

/**
 * Multi-word phrases that collapse ambiguous single words into a clear niche signal.
 * Matched against the cleaned input before single-word extraction; compounds rank first
 * in the output so they anchor niche classification.
 *
 * Sorted longest-first so more specific phrases match before shorter subsets
 * (e.g. "large language model" before "language model").
 */
const KNOWN_COMPOUNDS: readonly string[] = [
  // Finance – aviation crossover
  "budget airline", "budget carrier", "budget flight", "low cost carrier",
  "airline bankruptcy", "airline collapse", "carrier collapse",
  // Personal finance
  "personal finance", "financial planning", "financial freedom", "financial independence",
  "passive income", "retirement savings", "retirement fund", "retirement planning",
  "credit score", "credit card debt", "debt management", "debt free",
  "cost of living", "cost cutting", "cash flow", "net worth",
  "interest rate", "exchange rate", "tax planning", "tax savings",
  "hedge fund", "mutual fund", "index fund", "venture capital",
  "private equity", "stock market", "bond market", "real estate investing",
  "side hustle", "wealth building", "financial literacy",
  // Tech – AI
  "large language model", "language model",
  "machine learning", "deep learning", "artificial intelligence",
  "neural network", "natural language processing", "computer vision",
  "generative ai", "ai tools", "ai productivity",
  // Tech – general
  "open source", "cloud computing", "data science", "data privacy", "data breach",
  "cyber security", "cybersecurity threat", "software development",
  "app development", "web development", "tech startup",
  // Health
  "mental health", "mental wellness",
  "public health", "health care", "health insurance",
  "clinical trial", "blood pressure", "heart disease", "immune system",
  "weight loss", "gut health", "sleep hygiene", "sleep quality",
  "stress management", "anxiety disorder", "chronic pain",
  "intermittent fasting", "calorie deficit",
  // Food
  "plant based", "meal prep", "meal planning", "meal plan",
  "keto diet", "vegan diet", "whole food",
  // Business
  "product market fit", "market share", "market cap",
  "brand awareness", "content marketing", "social media marketing",
  "email marketing", "lead generation", "customer acquisition",
  "remote work", "work from home",
  // Education
  "online learning", "online course", "skill development",
  // Travel
  "solo travel", "digital nomad", "budget travel",
  // Sustainability
  "climate change", "global warming", "net zero",
  "renewable energy", "solar panel", "solar energy",
  "electric vehicle", "carbon emission", "carbon footprint",
  // Lifestyle
  "self improvement", "personal development", "work life balance",
  "morning routine", "habit formation",
  // Entertainment
  "video game", "streaming service", "social media",
];

export function keywordize(input: string, maxWords = 8): string[] {
  const cleaned = input
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 1. Match known compounds — highest priority, resolve single-word ambiguity
  const compounds = KNOWN_COMPOUNDS.filter((phrase) => cleaned.includes(phrase));

  // 2. Individual words with stop word filtering
  const words = cleaned
    .split(" ")
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  const uniqueWords = [...new Set(words)];

  // Signal words sort before generic domain words within the single-word tier
  uniqueWords.sort(
    (a, b) => (NICHE_SIGNAL_WORDS.has(b) ? 1 : 0) - (NICHE_SIGNAL_WORDS.has(a) ? 1 : 0)
  );

  // Single words already covered by a matched compound are redundant fragments
  // ("artificial intelligence" suppresses "artificial" and "intelligence").
  // Word-level membership, not raw substring, so "car" survives "carbon emission".
  const compoundWords = new Set(compounds.flatMap((phrase) => phrase.split(" ")));
  const standaloneWords = uniqueWords.filter((word) => !compoundWords.has(word));

  // Compounds first, then individual words fill remaining slots
  return [...new Set([...compounds, ...standaloneWords])].slice(0, maxWords);
}
