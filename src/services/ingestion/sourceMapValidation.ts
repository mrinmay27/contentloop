/** Validates a partial PageSourceMap patch from the Sources UI. */

const STRING_ARRAY_KEYS = [
  "mediumTags", "hackernewsTerms", "substackSlugs", "redditSubreddits",
  "devtoTags", "arxivCategories", "googleNewsQueries",
] as const;
const URL_ARRAY_KEYS = ["financeFeeds", "cryptoFeeds"] as const;

type Patch = Record<string, unknown>;
export type ValidationResult =
  | { ok: true; patch: Patch }
  | { ok: false; error: string };

function isHttpUrl(value: string): boolean {
  try { const u = new URL(value); return u.protocol === "http:" || u.protocol === "https:"; }
  catch { return false; }
}

function cleanStrings(arr: unknown): string[] | null {
  if (!Array.isArray(arr) || !arr.every((v) => typeof v === "string")) return null;
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))];
}

export function validateSourcePatch(body: Patch): ValidationResult {
  const patch: Patch = {};

  if (body.sourceEnabled !== undefined) {
    const se = body.sourceEnabled;
    if (typeof se !== "object" || se === null || Array.isArray(se)) return { ok: false, error: "sourceEnabled must be an object" };
    for (const v of Object.values(se)) if (typeof v !== "boolean") return { ok: false, error: "sourceEnabled values must be booleans" };
    patch.sourceEnabled = se;
  }

  for (const key of STRING_ARRAY_KEYS) {
    if (body[key] === undefined) continue;
    const cleaned = cleanStrings(body[key]);
    if (!cleaned) return { ok: false, error: `${key} must be an array of strings` };
    patch[key] = cleaned;
  }

  for (const key of URL_ARRAY_KEYS) {
    if (body[key] === undefined) continue;
    const cleaned = cleanStrings(body[key]);
    if (!cleaned) return { ok: false, error: `${key} must be an array of URLs` };
    const bad = cleaned.find((u) => !isHttpUrl(u));
    if (bad) return { ok: false, error: `invalid URL in ${key}: ${bad}` };
    patch[key] = cleaned;
  }

  if (body.rssFeeds !== undefined) {
    const feeds = body.rssFeeds;
    if (!Array.isArray(feeds)) return { ok: false, error: "rssFeeds must be an array" };
    const out: Array<{ name: string; url: string }> = [];
    for (const f of feeds) {
      const name = typeof (f as any)?.name === "string" ? (f as any).name.trim() : "";
      const url = typeof (f as any)?.url === "string" ? (f as any).url.trim() : "";
      if (!isHttpUrl(url)) return { ok: false, error: `invalid feed URL: ${url || "(empty)"}` };
      out.push({ name: name || url, url });
    }
    patch.rssFeeds = out;
  }

  return { ok: true, patch };
}
