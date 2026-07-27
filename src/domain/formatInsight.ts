/** Turns raw format learning signals into something explainable.
 *
 *  The engine already biases format decisions toward the proven winner
 *  (applyLearnedFormat in format-rules.ts, which stamps format_confidence =
 *  'learned'). That happened invisibly: a topic's format could change and
 *  nothing told the user why, or whether enough data had accumulated for the
 *  bias to be live at all. This summarises the same signals, against the same
 *  threshold, so the UI can report the state truthfully instead of guessing.
 *
 *  Pure — no service or DB imports, sibling domain imports only.
 */

import { MIN_FORMAT_SAMPLES } from "./learning.js";
import type { FormatSignal } from "./format-rules.js";

export interface FormatRow {
  label: string;
  score: number;
  sampleSize: number;
  /** Whether this row has enough samples to influence the engine. */
  eligible: boolean;
}

export interface FormatPerformance {
  /** All formats with usable scores, best first. */
  rows: FormatRow[];
  /** Best format that actually clears the sample threshold, else null. */
  leader: FormatRow | null;
  /** none = no data; gathering = data but not enough; active = bias is live. */
  status: "none" | "gathering" | "active";
  /** Samples still needed before the bias can activate (0 once active). */
  samplesNeeded: number;
  /** How many times better the leader is than the runner-up, if there is one. */
  leadMultiple: number | null;
}

export function summariseFormatPerformance(signals: FormatSignal[]): FormatPerformance {
  const rows: FormatRow[] = signals
    .filter((s) => Number.isFinite(s.score))
    .map((s) => ({
      label: s.label,
      score: s.score,
      sampleSize: s.sampleSize,
      eligible: s.sampleSize >= MIN_FORMAT_SAMPLES,
    }))
    .sort((a, b) => b.score - a.score);

  if (rows.length === 0) {
    return { rows, leader: null, status: "none", samplesNeeded: MIN_FORMAT_SAMPLES, leadMultiple: null };
  }

  const leader = rows.find((r) => r.eligible) ?? null;
  if (!leader) {
    // Closest candidate is whichever has the most samples so far — that's the
    // one the countdown should track.
    const closest = [...rows].sort((a, b) => b.sampleSize - a.sampleSize)[0];
    return {
      rows,
      leader: null,
      status: "gathering",
      samplesNeeded: Math.max(0, MIN_FORMAT_SAMPLES - closest.sampleSize),
      leadMultiple: null,
    };
  }

  const runnerUp = rows.find((r) => r !== leader && r.score > 0);
  return {
    rows,
    leader,
    status: "active",
    samplesNeeded: 0,
    leadMultiple: runnerUp ? leader.score / runnerUp.score : null,
  };
}
