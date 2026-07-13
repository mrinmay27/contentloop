import { query } from "../db/pool.js";
import type { PoolClient } from "pg";
import { EMA_ALPHA, type LearnedSignals, type SignalUpdate } from "../domain/learning.js";
import type { FormatSignal } from "../domain/format-rules.js";

export interface UnlearnedSnapshot {
  id: string;
  nicheId: string;
  source: "simulated" | "instagram";
  engagementRate: number;
  keywords: string[];
  contentType: string;
  capturedAt: Date;
}

/** 24h snapshots not yet folded into learning_signals, with topic context. */
export async function listUnlearnedDailySnapshots(): Promise<UnlearnedSnapshot[]> {
  const result = await query(
    `
      SELECT pm.id, pm.source, pm.engagement_rate, pm.captured_at,
             t.keywords, t.niche_id, c.type
      FROM performance_metrics pm
      JOIN publish_jobs pj ON pj.id = pm.publish_job_id
      JOIN content_items c ON c.id = pj.content_item_id
      JOIN topics t ON t.id = c.topic_id
      WHERE pm.capture_point = '24h' AND pm.learned_at IS NULL
      ORDER BY pm.captured_at ASC
    `
  );
  return result.rows.map((row: any) => ({
    id: row.id,
    nicheId: row.niche_id,
    source: row.source,
    engagementRate: Number(row.engagement_rate),
    keywords: row.keywords ?? [],
    contentType: row.type,
    capturedAt: new Date(row.captured_at),
  }));
}

/** Has this niche already folded any REAL (instagram) snapshot into signals? */
export async function nicheHasLearnedRealRows(nicheId: string): Promise<boolean> {
  const result = await query(
    `
      SELECT 1 FROM performance_metrics pm
      JOIN publish_jobs pj ON pj.id = pm.publish_job_id
      JOIN content_items c ON c.id = pj.content_item_id
      JOIN topics t ON t.id = c.topic_id
      WHERE t.niche_id = $1 AND pm.source = 'instagram'
        AND pm.capture_point = '24h' AND pm.learned_at IS NOT NULL
      LIMIT 1
    `,
    [nicheId]
  );
  return result.rows.length > 0;
}

export async function deleteSignalsForNiche(nicheId: string): Promise<void> {
  await query(`DELETE FROM learning_signals WHERE niche_id = $1`, [nicheId]);
}

/** EMA upsert — first sample takes the raw value, later samples blend. */
export async function upsertLearningSignal(nicheId: string, sig: SignalUpdate, client?: PoolClient): Promise<void> {
  const exec = client ? client.query.bind(client) : query;
  await exec(
    `
      INSERT INTO learning_signals (niche_id, signal_type, label, score, sample_size, updated_at)
      VALUES ($1, $2, $3, $4, 1, now())
      ON CONFLICT (niche_id, signal_type, label)
      DO UPDATE SET
        score = $5 * EXCLUDED.score + (1 - $5) * learning_signals.score,
        sample_size = learning_signals.sample_size + 1,
        updated_at = now()
    `,
    [nicheId, sig.signalType, sig.label, sig.engagementRate, EMA_ALPHA]
  );
}

export async function markSnapshotsLearned(ids: string[], client?: PoolClient): Promise<void> {
  if (ids.length === 0) return;
  const exec = client ? client.query.bind(client) : query;
  await exec(`UPDATE performance_metrics SET learned_at = now() WHERE id = ANY($1::uuid[])`, [ids]);
}

/** Learned signals for scoring: keyword map + niche average. */
export async function getLearnedSignals(nicheId: string): Promise<LearnedSignals | undefined> {
  const result = await query(
    `SELECT label, score, sample_size FROM learning_signals
     WHERE niche_id = $1 AND signal_type = 'keyword'`,
    [nicheId]
  );
  if (result.rows.length === 0) return undefined;
  const keywordScores = new Map<string, { score: number; sampleSize: number }>(
    result.rows.map((r: any) => [r.label, { score: Number(r.score), sampleSize: Number(r.sample_size) }])
  );
  const nicheAvg =
    result.rows.reduce((s: number, r: any) => s + Number(r.score), 0) / result.rows.length;
  return { keywordScores, nicheAvg };
}

/** Format win-rate signals for the learned format tiebreak. */
export async function getFormatSignals(nicheId: string): Promise<FormatSignal[]> {
  const result = await query(
    `SELECT label, score, sample_size FROM learning_signals
     WHERE niche_id = $1 AND signal_type = 'format'`,
    [nicheId]
  );
  return result.rows.map((r: any) => ({
    label: r.label, score: Number(r.score), sampleSize: Number(r.sample_size),
  }));
}
