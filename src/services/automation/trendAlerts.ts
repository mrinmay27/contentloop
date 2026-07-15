import { isTrendSpike } from "../../domain/automation.js";
import type { Topic } from "../../domain/types.js";
import { claimEvent } from "./eventsRepo.js";

/** Detect source-velocity spikes among just-scored topics; one alert per
 *  topic ever (UNIQUE claim). Returns the number of new alerts. */
export async function detectTrendSpikes(topics: Topic[], now: Date = new Date()): Promise<number> {
  let alerts = 0;
  for (const topic of topics) {
    if (!isTrendSpike(topic.sourceCount, topic.firstSeenAt, topic.lastSeenAt, topic.velocity, now)) continue;
    const hours = Math.max(1, Math.round((topic.lastSeenAt.getTime() - topic.firstSeenAt.getTime()) / 3_600_000));
    const claimed = await claimEvent({
      kind: "trend_alert", subjectId: topic.id,
      nicheId: topic.nicheId,
      title: `🔥 Trending: "${topic.title}" (${topic.sourceCount} sources in ${hours}h)`,
      payload: { sourceCount: topic.sourceCount, velocity: topic.velocity },
    });
    if (claimed) alerts += 1;
  }
  return alerts;
}
