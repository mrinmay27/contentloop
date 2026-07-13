import { withTransaction } from "../db/pool.js";
import { snapshotSignals } from "../domain/learning.js";
import {
  deleteSignalsForNiche,
  listUnlearnedDailySnapshots,
  markSnapshotsLearned,
  nicheHasLearnedRealRows,
  upsertLearningSignal,
  type UnlearnedSnapshot,
} from "./learningRepo.js";

async function foldSnapshot(row: UnlearnedSnapshot): Promise<void> {
  await withTransaction(async (client) => {
    for (const sig of snapshotSignals(row.keywords, row.contentType, row.engagementRate)) {
      await upsertLearningSignal(row.nicheId, sig, client);
    }
    await markSnapshotsLearned([row.id], client);
  });
}

/** Folds unlearned 24h snapshots into learning_signals.
 *
 *  Source discipline: a niche learns from real (instagram) rows once any
 *  exist; before that, from simulated rows. The first real row triggers a
 *  rebuild — simulated history is discarded and signals recomputed from
 *  real rows only. */
export async function runLearningStep(): Promise<void> {
  const rows = await listUnlearnedDailySnapshots();
  if (rows.length === 0) return;

  const byNiche = new Map<string, UnlearnedSnapshot[]>();
  for (const row of rows) {
    const list = byNiche.get(row.nicheId) ?? [];
    list.push(row);
    byNiche.set(row.nicheId, list);
  }

  for (const [nicheId, nicheRows] of byNiche) {
    const hasRealHistory = await nicheHasLearnedRealRows(nicheId);
    const realRows = nicheRows.filter((r) => r.source === "instagram");

    if (!hasRealHistory && realRows.length > 0) {
      // First real data for this niche: drop simulated-built signals, replay real only.
      console.log(`[learn] First real metrics for niche ${nicheId} — rebuilding signals from real data`);
      await deleteSignalsForNiche(nicheId);
      await markSnapshotsLearned(nicheRows.filter((r) => r.source === "simulated").map((r) => r.id));
      for (const row of realRows) await foldSnapshot(row);
      continue;
    }

    const mode: UnlearnedSnapshot["source"] = hasRealHistory ? "instagram" : "simulated";
    for (const row of nicheRows) {
      if (row.source === mode) await foldSnapshot(row);
      else await markSnapshotsLearned([row.id]); // off-mode rows: consumed, not folded
    }
  }
}
