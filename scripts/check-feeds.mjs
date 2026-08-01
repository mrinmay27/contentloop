#!/usr/bin/env node
/**
 * Link-rot check for every RSS feed hardcoded as a default.
 *
 * Written after finding that feeds.feedburner.com/FastCompany had been
 * recycled and was serving an unrelated French blog to every tech and business
 * niche — boosted to engagementHint 78 and multiplied 1.15 by scoring. The
 * source comments said "✓ 200", which was true and useless: a 200 says nothing
 * about whether a feed still carries the content it is named for.
 *
 * So this checks for actual <item>/<entry> elements, not status codes. It
 * cannot detect a hijack on its own — a human still has to read the titles —
 * but it catches the dead and the empty, which was most of them.
 *
 * Network-dependent by nature, so it is a script rather than a unit test:
 * `npm run check:feeds`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36";

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const urls = new Set();
for (const file of walk("src")) {
  for (const m of readFileSync(file, "utf8").matchAll(/"(https?:\/\/[^"]+)"/g)) {
    const u = m[1];
    if (!/feed|rss|\.xml/i.test(u)) continue;
    // API endpoints and documented placeholders are not feeds.
    if (/googleapis|eutils|export\.arxiv|firebaseio|dev\.to\/api|example\.com/.test(u)) continue;
    urls.add(u);
  }
}

const results = await Promise.all([...urls].map(async (url) => {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { url, ok: false, why: `HTTP ${res.status}` };
    const body = await res.text();
    const items = [...body.matchAll(/<item[\s>]|<entry[\s>]/g)].length;
    return items > 0 ? { url, ok: true, items } : { url, ok: false, why: "no items" };
  } catch (err) {
    return { url, ok: false, why: err?.name === "TimeoutError" ? "timeout" : "unreachable" };
  }
}));

const broken = results.filter(r => !r.ok);
for (const r of results.sort((a, b) => Number(a.ok) - Number(b.ok))) {
  console.log(`  ${r.ok ? "ok  " : "DEAD"}  ${String(r.items ?? r.why).padEnd(10)} ${r.url}`);
}
console.log(`\n${results.length} feeds checked, ${broken.length} broken.`);
process.exit(broken.length > 0 ? 1 : 0);
