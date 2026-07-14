import { query } from "../db/pool.js";

/** Thin JSONB vector cache on topics/niches. Only gemini vectors are stored. */

function asVector(value: unknown): number[] | null {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "number" && Number.isFinite(v))
    ? (value as number[])
    : null;
}

export async function getNicheEmbedding(nicheId: string): Promise<number[] | null> {
  const r = await query(`SELECT embedding FROM niches WHERE id = $1`, [nicheId]);
  return r.rows[0] ? asVector(r.rows[0].embedding) : null;
}

export async function saveNicheEmbedding(nicheId: string, vec: number[]): Promise<void> {
  await query(`UPDATE niches SET embedding = $2 WHERE id = $1`, [nicheId, JSON.stringify(vec)]);
}

export async function getTopicEmbeddings(topicIds: string[]): Promise<Map<string, number[]>> {
  if (topicIds.length === 0) return new Map();
  const r = await query(
    `SELECT id, embedding FROM topics WHERE id = ANY($1::uuid[]) AND embedding IS NOT NULL`,
    [topicIds]
  );
  const map = new Map<string, number[]>();
  for (const row of r.rows) {
    const vec = asVector(row.embedding);
    if (vec) map.set(row.id, vec);
  }
  return map;
}

export async function saveTopicEmbedding(topicId: string, vec: number[]): Promise<void> {
  await query(`UPDATE topics SET embedding = $2 WHERE id = $1`, [topicId, JSON.stringify(vec)]);
}

/** Recent same-niche topic vectors for paraphrase-novelty comparison. */
export async function listRecentTopicEmbeddings(
  nicheId: string,
  excludeTopicId: string,
  limit = 25
): Promise<number[][]> {
  const r = await query(
    `SELECT embedding FROM topics
     WHERE niche_id = $1 AND id <> $2 AND embedding IS NOT NULL
     ORDER BY last_seen_at DESC LIMIT $3`,
    [nicheId, excludeTopicId, limit]
  );
  return r.rows
    .map((row: any) => asVector(row.embedding))
    .filter((v: number[] | null): v is number[] => v !== null);
}
