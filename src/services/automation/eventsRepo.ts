import { query } from "../../db/pool.js";

export type AutomationKind = "cross_post" | "fast_track" | "recycle" | "trend_alert";

export interface AutomationEvent {
  id: string;
  kind: AutomationKind;
  subjectId: string;
  nicheId: string | null;
  pageId: string | null;
  title: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  seenAt: Date | null;
}

/** Claim the right to perform an automation action exactly once.
 *  Returns true when this call inserted the row (caller may act),
 *  false when the (kind, subject) was already claimed. */
export async function claimEvent(opts: {
  kind: AutomationKind;
  subjectId: string;
  nicheId?: string | null;
  pageId?: string | null;
  title: string;
  payload?: Record<string, unknown>;
}): Promise<boolean> {
  const result = await query(
    `INSERT INTO automation_events (kind, subject_id, niche_id, page_id, title, payload)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (kind, subject_id) DO NOTHING`,
    [opts.kind, opts.subjectId, opts.nicheId ?? null, opts.pageId ?? null, opts.title,
     JSON.stringify(opts.payload ?? {})]
  );
  return (result.rowCount ?? 0) === 1;
}

/** Merge extra data into a claimed event's payload (e.g. record an error). */
export async function annotateEvent(kind: AutomationKind, subjectId: string, extra: Record<string, unknown>): Promise<void> {
  await query(
    `UPDATE automation_events SET payload = payload || $3::jsonb
     WHERE kind = $1 AND subject_id = $2`,
    [kind, subjectId, JSON.stringify(extra)]
  );
}

export async function listEvents(limit = 30): Promise<{ events: AutomationEvent[]; unseen: number }> {
  const [rows, unseen] = await Promise.all([
    query(
      `SELECT * FROM automation_events ORDER BY created_at DESC LIMIT $1`,
      [limit]
    ),
    query(`SELECT count(*)::int AS n FROM automation_events WHERE seen_at IS NULL`),
  ]);
  return {
    events: rows.rows.map((r: any) => ({
      id: r.id, kind: r.kind, subjectId: r.subject_id, nicheId: r.niche_id,
      pageId: r.page_id, title: r.title, payload: r.payload ?? {},
      createdAt: new Date(r.created_at), seenAt: r.seen_at ? new Date(r.seen_at) : null,
    })),
    unseen: unseen.rows[0].n,
  };
}

export async function markAllSeen(): Promise<void> {
  await query(`UPDATE automation_events SET seen_at = now() WHERE seen_at IS NULL`);
}

/** True when any 'recycle' event was created in the last N hours —
 *  the recycler's cheap once-a-day guard. */
export async function recycleRanRecently(hours = 20): Promise<boolean> {
  const r = await query(
    `SELECT 1 FROM automation_events
     WHERE kind = 'recycle' AND created_at > now() - ($1 || ' hours')::interval
     LIMIT 1`,
    [String(hours)]
  );
  return r.rows.length > 0;
}
