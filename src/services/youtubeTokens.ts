/** Per-page YouTube OAuth tokens.
 *
 *  Before this, tokens lived in three global configStore keys, so connecting a
 *  second theme page silently overwrote the first page's channel. Instagram
 *  and Canva already store per page; YouTube was the odd one out.
 */
import { query } from "../db/pool.js";
import { configStore } from "../config/configStore.js";
import { needsRefresh, interpretChannelResponse } from "../domain/youtube.js";
import type { ChannelLookup } from "../domain/youtube.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface YouTubeToken {
  pageId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scope: string | null;
  channelId: string | null;
  channelTitle: string | null;
}

function mapRow(r: any): YouTubeToken {
  return {
    pageId: r.page_id,
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? null,
    expiresAt: r.expires_at ? new Date(r.expires_at) : null,
    scope: r.scope ?? null,
    channelId: r.channel_id ?? null,
    channelTitle: r.channel_title ?? null,
  };
}

/** Ask Google which channel these credentials belong to.
 *
 *  Costs 1 quota unit against the 10,000/day budget — next to nothing beside
 *  the 1,600 an upload costs.
 *
 *  Three outcomes, deliberately distinguished. A Google account with no
 *  YouTube channel authorises perfectly happily and then fails every upload
 *  with youtubeSignupRequired, which is a miserable thing to learn hours later
 *  from a scheduled post. Collapsing that into "unknown" would hide it, so
 *  no_channel is its own answer and the caller warns at connect time. */
export async function fetchChannel(accessToken: string): Promise<ChannelLookup> {
  try {
    const res = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      { headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000) }
    );
    return interpretChannelResponse(res.ok, res.ok ? await res.json() : null);
  } catch {
    return { status: "unknown" };
  }
}

export async function getToken(pageId: string): Promise<YouTubeToken | null> {
  const { rows } = await query("SELECT * FROM youtube_tokens WHERE page_id = $1", [pageId]);
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function saveToken(pageId: string, t: {
  accessToken: string; refreshToken?: string | null;
  expiresAt?: Date | null; scope?: string | null;
  channelId?: string | null; channelTitle?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO youtube_tokens (page_id, access_token, refresh_token, expires_at, scope,
                                 channel_id, channel_title)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (page_id) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       -- Google omits refresh_token on refresh responses; keep the stored one
       -- rather than nulling it, or the next refresh would be impossible.
       refresh_token = COALESCE(EXCLUDED.refresh_token, youtube_tokens.refresh_token),
       expires_at = EXCLUDED.expires_at,
       scope = COALESCE(EXCLUDED.scope, youtube_tokens.scope),
       -- A token refresh does not re-fetch the channel, so keep what is stored.
       channel_id = COALESCE(EXCLUDED.channel_id, youtube_tokens.channel_id),
       channel_title = COALESCE(EXCLUDED.channel_title, youtube_tokens.channel_title),
       updated_at = now()`,
    [pageId, t.accessToken, t.refreshToken ?? null, t.expiresAt ?? null, t.scope ?? null,
     t.channelId ?? null, t.channelTitle ?? null]
  );
}

export async function deleteToken(pageId: string): Promise<void> {
  await query("DELETE FROM youtube_tokens WHERE page_id = $1", [pageId]);
}

/**
 * Move a pre-existing global token into the per-page table.
 *
 * An install that already had YouTube connected must not be silently
 * disconnected by this change. Runs once at boot, after migrations.
 */
export async function adoptLegacyToken(): Promise<void> {
  const accessToken = configStore.get("YOUTUBE_ACCESS_TOKEN" as any);
  const pageId = configStore.get("YOUTUBE_PAGE_ID" as any);
  if (!accessToken || !pageId) return;

  const existing = await getToken(pageId);
  if (existing) return;

  // The page may have been deleted since; a FK violation here must not stop boot.
  try {
    await saveToken(pageId, {
      accessToken,
      refreshToken: configStore.get("YOUTUBE_REFRESH_TOKEN" as any) || null,
      // Unknown expiry — needsRefresh() treats that as "refresh before use".
      expiresAt: null,
    });
    configStore.set({
      YOUTUBE_ACCESS_TOKEN: "", YOUTUBE_REFRESH_TOKEN: "", YOUTUBE_PAGE_ID: "",
    } as any);
    console.log(`[youtube] adopted existing token into youtube_tokens for page ${pageId}`);
  } catch (err: any) {
    console.warn(`[youtube] could not adopt legacy token: ${err?.message}`);
  }
}

/**
 * Return a usable access token, refreshing first if it is expired or close to
 * it.
 *
 * Google access tokens last about an hour. The refresh token has been captured
 * since OAuth was written and never used, which means a post scheduled for
 * 21:00 on a channel connected at 09:00 has always failed.
 */
export async function ensureFreshToken(pageId: string): Promise<string> {
  const row = await getToken(pageId);
  if (!row) {
    throw new Error("YouTube isn't connected for this page. Connect it in Settings.");
  }
  if (!needsRefresh(row.expiresAt)) return row.accessToken;

  if (!row.refreshToken) {
    throw new Error("YouTube access expired and cannot be renewed. Reconnect YouTube in Settings.");
  }

  const clientId = configStore.get("YOUTUBE_CLIENT_ID" as any) || process.env.YOUTUBE_CLIENT_ID || "";
  const clientSecret = configStore.get("YOUTUBE_CLIENT_SECRET" as any) || process.env.YOUTUBE_CLIENT_SECRET || "";
  if (!clientId || !clientSecret) {
    throw new Error("YouTube client credentials are missing. Add them in Settings → YouTube.");
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: row.refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const body = await res.text();
  if (!res.ok) {
    // invalid_grant means the user revoked access. Name the fix rather than
    // showing Google's payload — the publisher puts this text in front of them.
    if (body.includes("invalid_grant")) {
      throw new Error("YouTube access was revoked. Reconnect YouTube in Settings.");
    }
    throw new Error(`Could not refresh YouTube access (${res.status}).`);
  }

  const token = JSON.parse(body);
  await saveToken(pageId, {
    accessToken: token.access_token,
    // Google omits refresh_token here; saveToken keeps the stored one.
    refreshToken: token.refresh_token ?? null,
    expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
  });
  console.log(`[youtube] refreshed access token for page ${pageId}`);
  return token.access_token;
}
