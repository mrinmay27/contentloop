/**
 * Instagram / Meta OAuth service
 *
 * Uses the Meta Business Login flow (OAuth 2.0) to obtain a long-lived
 * access token for posting to Instagram via the Graph API.
 *
 * Scopes requested:
 *   - instagram_basic           (read profile)
 *   - instagram_content_publish (create posts/reels)
 *   - pages_read_engagement     (needed for IG Graph API)
 *   - pages_show_list           (list connected pages)
 *
 * Docs: https://developers.facebook.com/docs/instagram-api/getting-started
 */

import crypto from "crypto";
import { query } from "../db/pool.js";

const META_AUTH_URL  = "https://www.facebook.com/v19.0/dialog/oauth";
const META_TOKEN_URL = "https://graph.facebook.com/v19.0/oauth/access_token";
const GRAPH_BASE     = "https://graph.facebook.com/v19.0";

const IG_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_read_engagement",
  "pages_show_list",
].join(",");

// ─── PKCE (state param for CSRF protection) ───────────────────────────────────

export function generateState(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function buildAuthUrl(state: string, clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    scope:         IG_SCOPES,
    response_type: "code",
    state,
  });
  return `${META_AUTH_URL}?${params}`;
}

// ─── Token exchange ───────────────────────────────────────────────────────────

export async function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<{ accessToken: string; expiresIn?: number }> {
  const params = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    redirect_uri:  redirectUri,
    code,
  });

  const res = await fetch(`${META_TOKEN_URL}?${params}`);
  if (!res.ok) throw new Error(`Meta token exchange failed: ${await res.text()}`);
  const data: any = await res.json();

  // Exchange short-lived token for long-lived (60-day) token
  const longLivedRes = await fetch(
    `${GRAPH_BASE}/oauth/access_token?grant_type=fb_exchange_token` +
    `&client_id=${clientId}&client_secret=${clientSecret}` +
    `&fb_exchange_token=${data.access_token}`
  );
  if (!longLivedRes.ok) {
    // Fall back to short-lived if exchange fails
    return { accessToken: data.access_token, expiresIn: data.expires_in };
  }
  const longLived: any = await longLivedRes.json();
  return { accessToken: longLived.access_token, expiresIn: longLived.expires_in };
}

// ─── DB storage (reuse pages table extra_data column or simple JSON file) ──────
// We store per-page tokens in a simple table: instagram_tokens

export async function ensureTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS instagram_tokens (
      page_id      TEXT PRIMARY KEY,
      access_token TEXT NOT NULL,
      ig_user_id   TEXT,
      username     TEXT,
      expires_at   TIMESTAMPTZ,
      updated_at   TIMESTAMPTZ DEFAULT now()
    )
  `);
}

export async function upsertToken(
  pageId: string,
  accessToken: string,
  expiresIn?: number,
  igUserId?: string,
  username?: string
): Promise<void> {
  await ensureTable();
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
  await query(
    `INSERT INTO instagram_tokens (page_id, access_token, ig_user_id, username, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (page_id) DO UPDATE
       SET access_token = EXCLUDED.access_token,
           ig_user_id   = COALESCE(EXCLUDED.ig_user_id, instagram_tokens.ig_user_id),
           username     = COALESCE(EXCLUDED.username, instagram_tokens.username),
           expires_at   = EXCLUDED.expires_at,
           updated_at   = now()`,
    [pageId, accessToken, igUserId ?? null, username ?? null, expiresAt]
  );
}

export async function getToken(pageId: string): Promise<{
  access_token: string; ig_user_id: string | null; username: string | null; expires_at: Date | null;
} | null> {
  await ensureTable();
  const result = await query(
    "SELECT access_token, ig_user_id, username, expires_at FROM instagram_tokens WHERE page_id = $1",
    [pageId]
  );
  return (result.rows[0] as any) ?? null;
}

export async function deleteToken(pageId: string): Promise<void> {
  await ensureTable();
  await query("DELETE FROM instagram_tokens WHERE page_id = $1", [pageId]);
}

export async function isConnected(pageId: string): Promise<false | { username: string | null; igUserId: string | null }> {
  const row = await getToken(pageId);
  if (!row) return false;
  return { username: row.username, igUserId: row.ig_user_id };
}

// ─── Graph API helpers ────────────────────────────────────────────────────────

/** Fetch the IG business account linked to the user's FB pages */
export async function fetchIgUser(accessToken: string): Promise<{ igUserId: string; username: string } | null> {
  // 1. Get FB pages
  const pagesRes = await fetch(`${GRAPH_BASE}/me/accounts?fields=id,name,instagram_business_account&access_token=${accessToken}`);
  if (!pagesRes.ok) return null;
  const pages: any = await pagesRes.json();

  for (const page of (pages.data ?? [])) {
    const igAccount = page.instagram_business_account;
    if (!igAccount?.id) continue;

    // 2. Get IG username
    const igRes = await fetch(`${GRAPH_BASE}/${igAccount.id}?fields=id,username&access_token=${accessToken}`);
    if (igRes.ok) {
      const ig: any = await igRes.json();
      return { igUserId: ig.id, username: ig.username };
    }
  }
  return null;
}
