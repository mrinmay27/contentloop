/** Upload a rendered reel to YouTube as a Short.
 *
 *  Resumable upload: the simple endpoint is unreliable above a few MB and
 *  reels are routinely tens of MB.
 */
import fs from "node:fs";
import path from "node:path";
import { configStore } from "../config/configStore.js";
import { resolveMediaDir } from "../config/paths.js";
import { buildTitle, describeShortRejection } from "../domain/youtube.js";
import { ensureFreshToken } from "./youtubeTokens.js";
import { probeVideo } from "./mediaProbe.js";

const UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

export interface UploadResult { videoId: string; url: string }

/** Thrown when Google's daily quota is exhausted, so the caller can leave the
 *  job retryable instead of burning the attempt. */
export class QuotaExceededError extends Error {
  constructor() {
    super("YouTube daily upload limit reached — this will retry tomorrow.");
    this.name = "QuotaExceededError";
  }
}

/** Resolve a /media/... public URL to a path on disk. */
function resolveLocalPath(publicUrl: string): string {
  const rel = publicUrl.replace(/^\/media\//, "");
  return path.join(resolveMediaDir(), rel);
}

export async function uploadShort(opts: {
  pageId: string;
  videoUrl: string;
  hook: string;
  description: string;
  tags?: string[];
  /** Validation only — skips the actual upload. */
  dryRun?: boolean;
}): Promise<UploadResult> {
  const absPath = resolveLocalPath(opts.videoUrl);
  if (!fs.existsSync(absPath)) {
    throw new Error("The rendered video file is missing — run the render job again.");
  }

  // Check eligibility BEFORE uploading: failing after 20MB has gone up the
  // wire wastes the user's very limited daily quota.
  const probe = await probeVideo(absPath);
  if (probe) {
    const rejection = describeShortRejection(probe);
    if (rejection) throw new Error(rejection);
  }

  const accessToken = await ensureFreshToken(opts.pageId);

  const privacyStatus =
    (configStore.get("YOUTUBE_PRIVACY" as any) || "private").trim() || "private";

  const metadata = {
    snippet: {
      title: buildTitle(opts.hook),
      description: opts.description ?? "",
      tags: (opts.tags ?? []).slice(0, 15),
    },
    status: { privacyStatus, selfDeclaredMadeForKids: false },
  };

  // Dry run validates everything except the bytes, so a passing dry run means
  // a real run would work. A dry run that skips validation is worthless.
  if (opts.dryRun) {
    return { videoId: "dry-run", url: "https://youtube.com/shorts/dry-run" };
  }

  // 1. Start the resumable session — the upload URL comes back in a header.
  const start = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Type": "video/*",
    },
    body: JSON.stringify(metadata),
    signal: AbortSignal.timeout(60_000),
  });

  if (!start.ok) {
    const body = await start.text();
    if (body.includes("quotaExceeded")) throw new QuotaExceededError();
    throw new Error(`YouTube rejected the upload (${start.status}): ${body.slice(0, 200)}`);
  }

  const uploadUrl = start.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube did not return an upload URL.");

  // 2. Send the bytes.
  const stat = fs.statSync(absPath);
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "video/*",
      "Content-Length": String(stat.size),
    },
    body: fs.readFileSync(absPath),
    signal: AbortSignal.timeout(15 * 60_000),
  });

  if (!put.ok) {
    const body = await put.text();
    if (body.includes("quotaExceeded")) throw new QuotaExceededError();
    throw new Error(`YouTube upload failed (${put.status}): ${body.slice(0, 200)}`);
  }

  const created: any = await put.json();
  const videoId = created?.id;
  if (!videoId) throw new Error("YouTube accepted the upload but returned no video id.");

  return { videoId, url: `https://youtube.com/shorts/${videoId}` };
}
