import { query } from "../../db/pool.js";
import { isRecyclable } from "../../domain/automation.js";
import { llmConfigStore } from "../../config/llmConfigStore.js";
import { nextAvailableSlot } from "../scheduler.js";
import { formatCaption, type PublishPlatform } from "../platformFormatter.js";
import { listScheduledTimesForPage, scheduleContentBatch } from "../repositories.js";
import { annotateEvent, claimEvent, recycleRanRecently } from "./eventsRepo.js";

/** Cap on caption-regeneration ATTEMPTS per run (not successes) — the spec's
 *  ≤3/day intent is per-attempt LLM cost control. */
const MAX_RECYCLE_ATTEMPTS_PER_RUN = 3;

interface RecycleCandidate {
  publish_job_id: string;
  content_item_id: string;
  niche_id: string;
  page_id: string;
  platform: string;
  topic_title: string;
  published_at: Date;
  engagement_rate: number;
  niche_avg: number;
  sample_size: number;
  payload: any;
}

/** Intentional indefinite re-recycle: each recycle creates a NEW publish_job,
 *  and once that job is published its own id becomes a fresh recycle subject —
 *  so a perennial winner becomes eligible again ~30 days after each recycle,
 *  gated by continued 1.5x-average 24h performance. By design, not a loop.
 *
 *  Source discipline (spec §2, same as the learning loop): per niche, use real
 *  ('instagram') rows exclusively once any exist, else simulated — never mixed.
 *  Both the average AND the candidate's own snapshot must be in-mode. */
async function listRecycleCandidates(): Promise<RecycleCandidate[]> {
  const r = await query<Omit<RecycleCandidate, "published_at"> & { published_at: string | Date }>(
    `
    WITH niche_mode AS (
      SELECT t.niche_id,
             CASE WHEN bool_or(pm.source = 'instagram') THEN 'instagram' ELSE 'simulated' END AS mode
      FROM performance_metrics pm
      JOIN publish_jobs pj ON pj.id = pm.publish_job_id
      JOIN content_items c ON c.id = pj.content_item_id
      JOIN topics t ON t.id = c.topic_id
      WHERE pm.capture_point = '24h'
      GROUP BY t.niche_id
    ),
    niche_avg AS (
      SELECT t.niche_id, avg(pm.engagement_rate)::float8 AS avg_24h, count(*)::int AS samples
      FROM performance_metrics pm
      JOIN publish_jobs pj ON pj.id = pm.publish_job_id
      JOIN content_items c ON c.id = pj.content_item_id
      JOIN topics t ON t.id = c.topic_id
      JOIN niche_mode nm ON nm.niche_id = t.niche_id AND pm.source = nm.mode
      WHERE pm.capture_point = '24h'
      GROUP BY t.niche_id
    )
    SELECT pj.id AS publish_job_id, c.id AS content_item_id, t.niche_id,
           pj.page_id, pj.platform, t.title AS topic_title, pj.published_at,
           pm.engagement_rate::float8 AS engagement_rate,
           na.avg_24h AS niche_avg, na.samples AS sample_size, c.payload
    FROM performance_metrics pm
    JOIN publish_jobs pj ON pj.id = pm.publish_job_id
    JOIN content_items c ON c.id = pj.content_item_id
    JOIN topics t ON t.id = c.topic_id
    JOIN niche_avg na ON na.niche_id = t.niche_id
    JOIN niche_mode nm ON nm.niche_id = t.niche_id AND pm.source = nm.mode
    WHERE pm.capture_point = '24h'
      AND pj.status = 'published'
      AND pj.published_at <= now() - interval '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM automation_events ae
        WHERE ae.kind = 'recycle' AND ae.subject_id = pj.id
      )
    ORDER BY pm.engagement_rate DESC
    LIMIT 10
    `
  );
  return r.rows.map((row) => ({ ...row, published_at: new Date(row.published_at) }));
}

/** One LLM call to freshen the caption. Returns null on any failure. */
export async function regenerateCaption(originalCaption: string, hook: string, nicheName: string): Promise<string | null> {
  const cfg = llmConfigStore.forTask("generation") ?? llmConfigStore.forTask("all");
  if (!cfg) return null;
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl ?? undefined });
    const resp = await client.chat.completions.create({
      model: cfg.model,
      messages: [{
        role: "user",
        content: [
          `Rewrite this social media caption for a ${nicheName} page so it reads fresh,`,
          `keeping the same voice, message, and rough length. Do not mention reposting`,
          `or that it was rewritten. Return ONLY the caption text.`,
          ``,
          `Hook: ${hook}`,
          `Caption: ${originalCaption}`,
        ].join("\n"),
      }],
      temperature: 0.8,
    });
    const text = resp.choices?.[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : null;
  } catch (err: any) {
    console.warn(`[recycler] caption regen failed: ${err?.message}`);
    return null;
  }
}

/** Daily evergreen pass: re-queue proven winners with a fresh caption. */
export async function runRecycler(now: Date = new Date()): Promise<number> {
  if (await recycleRanRecently()) return 0;

  const candidates = await listRecycleCandidates();
  const nicheNames = new Map<string, string>();
  let recycled = 0;
  let attempts = 0;

  for (const cand of candidates) {
    if (attempts >= MAX_RECYCLE_ATTEMPTS_PER_RUN) break;
    if (!isRecyclable(cand.published_at, cand.engagement_rate, cand.niche_avg, cand.sample_size, now)) continue;

    const claimed = await claimEvent({
      kind: "recycle", subjectId: cand.publish_job_id,
      nicheId: cand.niche_id, pageId: cand.page_id,
      title: `♻ Recycled "${cand.topic_title}" (${(cand.engagement_rate * 100).toFixed(1)}% eng)`,
      payload: { engagementRate: cand.engagement_rate, nicheAvg: cand.niche_avg },
    });
    if (!claimed) continue;

    try {
      if (!nicheNames.has(cand.niche_id)) {
        const n = await query<{ name: string }>(`SELECT name FROM niches WHERE id = $1`, [cand.niche_id]);
        nicheNames.set(cand.niche_id, n.rows[0]?.name ?? "content");
      }
      const payload = cand.payload ?? {};
      attempts += 1; // count every LLM attempt, success or not — cost control
      const fresh = await regenerateCaption(payload.caption ?? "", payload.hook ?? "", nicheNames.get(cand.niche_id)!);
      if (!fresh) {
        await annotateEvent("recycle", cand.publish_job_id, { skipped: "caption regeneration unavailable" });
        continue; // claim kept — this winner is consumed, next winner recycles tomorrow
      }
      const existing = await listScheduledTimesForPage(cand.page_id);
      const slot = nextAvailableSlot(existing);
      const formattedCaption = formatCaption({
        platform: cand.platform as PublishPlatform,
        hook: payload.hook ?? "",
        caption: fresh,
        hashtags: payload.hashtags ?? [],
      });
      await scheduleContentBatch([{
        contentItemId: cand.content_item_id, pageId: cand.page_id,
        platform: cand.platform, scheduledAt: slot, formattedCaption,
      }]);
      recycled += 1;
    } catch (err: any) {
      console.warn(`[recycler] recycle failed for job ${cand.publish_job_id}: ${err?.message}`);
      await annotateEvent("recycle", cand.publish_job_id, { error: err?.message ?? "unknown" });
    }
  }
  return recycled;
}
