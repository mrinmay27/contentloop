#!/usr/bin/env node
/**
 * End-to-end lifecycle smoke test.
 *
 * Boots a real ContentLoop on a throwaway data dir and drives it through the
 * HTTP API the way the dashboard does, then asserts that the screens agree
 * with each other.
 *
 * Why this exists: the suite is 150+ pure unit tests and not one of them could
 * have caught the bugs that shipped. Those lived in SQL and in wiring — a
 * topic state that nothing ever wrote, a dry run counted as a post in five
 * different queries, YouTube missing from the publish targets, an "approved"
 * count that kept counting after publication. None of them crashed. They were
 * numbers disagreeing across screens, which is exactly what an assertion can
 * check and eyeballing cannot.
 *
 * Run: npm run check:lifecycle
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";

const failures = [];
let passed = 0;

function check(label, condition, detail = "") {
  if (condition) { passed += 1; console.log(`  ok    ${label}`); }
  else { failures.push(label); console.log(`  FAIL  ${label}${detail ? "  — " + detail : ""}`); }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

const dataDir = mkdtempSync(path.join(tmpdir(), "cl-lifecycle-"));
const port = await freePort();
const base = `http://127.0.0.1:${port}/api`;

const child = spawn(process.execPath, ["dist/src/desktop/main.js"], {
  env: { ...process.env, CONTENTLOOP_DATA_DIR: dataDir, PORT: String(port), CONTENTLOOP_MODE: "desktop" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
child.stdout.on("data", d => { serverLog += d; });
child.stderr.on("data", d => { serverLog += d; });

async function api(p, opts) {
  const res = await fetch(base + p, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { /* empty body is fine */ }
  return { status: res.status, body };
}

async function waitForBoot() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

function cleanup() {
  child.kill("SIGTERM");
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
}

try {
  if (!await waitForBoot()) {
    console.error("Server never became healthy. Log:\n" + serverLog.slice(-1500));
    cleanup();
    process.exit(1);
  }
  console.log(`\nBooted on :${port} with a fresh database.\n`);

  // ── A fresh install must be safe by default ────────────────────────────────
  const health = await api("/health");
  check("a new install starts in dry-run mode",
    health.body?.postingDryRun === true,
    `postingDryRun=${health.body?.postingDryRun} — config is leaking in from another install`);

  // ── Set up a page ──────────────────────────────────────────────────────────
  const niche = await api("/niches/preset", { method: "POST", body: JSON.stringify({ presetId: "n1" }) });
  const nicheId = niche.body?.niche?.id;
  check("a built-in niche can be created", !!nicheId, `status ${niche.status}`);

  const page = await api("/pages", {
    method: "POST",
    body: JSON.stringify({ nicheId, name: "Lifecycle Page", platform: "instagram" }),
  });
  const pageId = page.body?.page?.id;
  check("a page can be created", !!pageId, `status ${page.status}`);

  // ── Publish targets must reflect what actually works ───────────────────────
  const targets = (await api(`/pages/${pageId}/publish-platforms`)).body?.platforms ?? {};
  check("YouTube Shorts is offered as a publish target",
    "youtube_shorts" in targets,
    "it was missing entirely, making the whole feature unreachable");
  check("unbuilt platforms are marked unavailable, not merely disconnected",
    targets.facebook?.unavailable === true && targets.linkedin?.unavailable === true,
    "Facebook once reported connected whenever Instagram was, then failed on publish");

  // ── A topic through to approval ────────────────────────────────────────────
  const topic = await api("/topics/manual", {
    method: "POST",
    body: JSON.stringify({ nicheId, title: "Lifecycle probe topic", suggestedFormat: "reel" }),
  });
  const topicId = topic.body?.topic?.id ?? topic.body?.id;
  check("a topic can be added by hand", !!topicId, `status ${topic.status} ${JSON.stringify(topic.body).slice(0, 120)}`);

  // A manual topic has no content until the editor opens it — the dashboard
  // calls this find-or-create route, so the test does too.
  const draft = await api("/content/draft", {
    method: "POST",
    body: JSON.stringify({ topicId, pageId, type: "reel" }),
  });
  const item = draft.body?.content;
  check("opening a topic in the editor produces a content item", !!item,
    `status ${draft.status} ${JSON.stringify(draft.body).slice(0, 120)}`);

  if (item) {
    check("generated content carries a hook",
      typeof item.payload?.hook === "string" && item.payload.hook.length > 0,
      "an empty hook uploads Shorts under a placeholder title");

    await api(`/content/${item.id}/approve`, { method: "POST" });
    const afterApprove = (await api(`/stats?pageId=${pageId}`)).body ?? {};
    check("approving is reflected in the approved count", afterApprove.approved === 1,
      `approved=${afterApprove.approved}`);

    // ── A dry run must not be counted as a post, anywhere ───────────────────
    const dry = await api(`/content/${item.id}/publish`, {
      method: "POST", body: JSON.stringify({ platforms: ["youtube_shorts"] }),
    });
    check("publishing returns a job", dry.status === 200, `status ${dry.status}`);
    await new Promise(r => setTimeout(r, 2500));

    const stats = (await api(`/stats?pageId=${pageId}`)).body ?? {};
    check("a dry run is not counted on the POSTED card", stats.posted === 0, `posted=${stats.posted}`);

    const inbox = (await api("/inbox")).body ?? {};
    check("a dry run does not appear in the activity feed",
      (inbox.activity ?? []).filter(a => a.kind === "posted").length === 0);
    check("a dry run is not counted in the digest",
      (inbox.digest?.postedSinceYesterday ?? 0) === 0);

    const now = new Date();
    const cal = (await api(`/pages/${pageId}/schedule?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)).body ?? [];
    check("a dry run does not appear on the calendar", cal.length === 0,
      `${cal.length} entries: ${JSON.stringify(cal.map(j => ({ s: j.status, d: j.dry_run })))}`);

    const analytics = (await api(`/pages/${pageId}/analytics`)).body ?? {};
    check("a dry run is not counted as a post in Performance",
      (analytics.posts ?? []).length === 0, `${(analytics.posts ?? []).length} posts`);

    const t1 = ((await api("/topics")).body ?? []).find(t => t.id === topicId);
    check("a dry run does not move the topic to POSTED", t1?.state !== "POSTED", `state=${t1?.state}`);

    // ── Scheduling and cancelling must move the topic and move it back ──────
    const when = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const sched = await api(`/content/${item.id}/publish`, {
      method: "POST", body: JSON.stringify({ platforms: ["youtube_shorts"], scheduledAt: when }),
    });
    const jobId = sched.body?.jobs?.[0]?.id;
    const t2 = ((await api("/topics")).body ?? []).find(t => t.id === topicId);
    check("scheduling moves the topic to SCHEDULED", t2?.state === "SCHEDULED", `state=${t2?.state}`);

    const future = new Date(Date.now() + 7 * 86_400_000);
    const cal2 = (await api(`/pages/${pageId}/schedule?year=${future.getFullYear()}&month=${future.getMonth() + 1}`)).body ?? [];
    const scheduledEntries = cal2.filter(j => j.status === "scheduled");
    check("a scheduled post appears on the calendar", scheduledEntries.length === 1,
      `${scheduledEntries.length} scheduled of ${cal2.length} — dry_run defaults to true before dispatch, so filtering on that flag alone hides real scheduled posts`);

    const statsSched = (await api(`/stats?pageId=${pageId}`)).body ?? {};
    check("a scheduled item stops counting as awaiting review", statsSched.approved === 0,
      `approved=${statsSched.approved}`);
    check("a scheduled item is counted as scheduled", statsSched.scheduled === 1,
      `scheduled=${statsSched.scheduled}`);

    if (jobId) {
      await api(`/publish-jobs/${jobId}`, { method: "PATCH", body: JSON.stringify({ action: "cancel" }) });
      const t3 = ((await api("/topics")).body ?? []).find(t => t.id === topicId);
      check("cancelling moves the topic back out of SCHEDULED", t3?.state !== "SCHEDULED",
        `state=${t3?.state} — left stuck, it sits in the Scheduled tab with no job behind it`);
    }
  }

  // ── Expected states must not present as server faults ──────────────────────
  const canva = await api(`/pages/${pageId}/canva/templates`);
  check("an unconnected integration answers 4xx, not 500", canva.status < 500, `status ${canva.status}`);

  const badPlatform = await api(`/content/${item?.id}/publish`, {
    method: "POST", body: JSON.stringify({ platforms: ["youtube"] }),
  });
  check("an unknown publish platform is rejected with 400", badPlatform.status === 400,
    `status ${badPlatform.status}`);

} catch (err) {
  console.error("\nUnexpected error:", err?.message);
  console.error(serverLog.slice(-1200));
  failures.push("unexpected error");
} finally {
  cleanup();
}

console.log(`\n${passed} passed, ${failures.length} failed.`);
if (failures.length) {
  console.log("Failed:\n" + failures.map(f => "  - " + f).join("\n"));
  process.exit(1);
}
