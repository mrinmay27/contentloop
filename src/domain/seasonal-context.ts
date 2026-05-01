/** Task 2.5.5 — Seasonal & Calendar Awareness.
 *  Returns a score multiplier (+10% max) when the topic matches a seasonal spike period.
 */

interface SeasonalSignal {
  months: number[]; // 1-based
  keywords: string[];
}

const SEASONAL_SIGNALS: SeasonalSignal[] = [
  // January: New Year resolutions → health & fitness spike
  { months: [1], keywords: ["fitness", "weight loss", "resolution", "new year", "habit", "goal", "diet", "gym"] },
  // February: Relationships & Valentine's
  { months: [2], keywords: ["valentine", "relationship", "love", "dating", "couple", "gift"] },
  // March–April: Spring cleaning, tax season, budgeting
  { months: [3, 4], keywords: ["tax", "budget", "spring clean", "declutter", "savings", "irs", "refund"] },
  // May–June: Graduation, travel planning, summer prep
  { months: [5, 6], keywords: ["graduation", "travel", "summer", "vacation", "school", "internship"] },
  // July–August: Summer content, outdoor, finance mid-year
  { months: [7, 8], keywords: ["summer", "outdoor", "beach", "mid-year", "review", "half year"] },
  // September–October: Back to school, productivity
  { months: [9, 10], keywords: ["back to school", "productivity", "fall", "halloween", "study", "routine"] },
  // November: Black Friday, shopping, finance year-end
  { months: [11], keywords: ["black friday", "deal", "shopping", "discount", "savings", "cyber monday"] },
  // December: Gift guides, year in review, planning
  { months: [12], keywords: ["gift", "holiday", "christmas", "year in review", "recap", "new year", "resolution"] },
];

/**
 * Returns a multiplier [1.0, 1.10] when the topic title/keywords match the current season.
 * Applies universally to all niches.
 */
export function seasonalScoreMultiplier(
  titleAndKeywords: string,
  nowDate: Date = new Date()
): number {
  const currentMonth = nowDate.getMonth() + 1; // 1-based
  const text = titleAndKeywords.toLowerCase();

  for (const signal of SEASONAL_SIGNALS) {
    if (!signal.months.includes(currentMonth)) continue;
    const matches = signal.keywords.filter((kw) => text.includes(kw)).length;
    if (matches > 0) {
      // +5% for 1 match, +10% for 2+ matches — capped at 1.10
      return Math.min(1.10, 1 + matches * 0.05);
    }
  }

  return 1.0; // No seasonal boost
}
