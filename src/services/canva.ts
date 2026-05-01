/**
 * Canva Connect API service
 * Handles OAuth 2.0 + PKCE, design listing, autofill, and export.
 *
 * Docs: https://www.canva.dev/docs/connect/
 */
import crypto from "crypto";
import { query } from "../db/pool.js";
import { env } from "../config/env.js";

const CANVA_AUTH_URL    = "https://www.canva.com/api/oauth/code";
const CANVA_TOKEN_URL   = "https://api.canva.com/rest/v1/oauth/token";
const CANVA_API_BASE    = "https://api.canva.com/rest/v1";
const CANVA_SCOPES      = [
  "design:content:read",
  "design:content:write",
  "design:meta:read",
  "asset:read",
  "brandtemplate:content:read",
  "brandtemplate:meta:read",
].join(" ");

// ─── PKCE helpers ────────────────────────────────────────────────────────────

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier  = crypto.randomBytes(64).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildAuthUrl(
  state: string,
  codeChallenge: string
): string {
  if (!env.CANVA_CLIENT_ID) throw new Error("CANVA_CLIENT_ID is not set");
  const params = new URLSearchParams({
    response_type:          "code",
    client_id:              env.CANVA_CLIENT_ID,
    redirect_uri:           env.CANVA_REDIRECT_URI,
    scope:                  CANVA_SCOPES,
    state,
    code_challenge:         codeChallenge,
    code_challenge_method:  "S256",
  });
  return `${CANVA_AUTH_URL}?${params}`;
}

// ─── Token exchange + refresh ─────────────────────────────────────────────────

export async function exchangeCode(
  code: string,
  codeVerifier: string
): Promise<TokenResponse> {
  if (!env.CANVA_CLIENT_ID || !env.CANVA_CLIENT_SECRET) {
    throw new Error("CANVA_CLIENT_ID / CANVA_CLIENT_SECRET not set");
  }
  const body = new URLSearchParams({
    grant_type:    "authorization_code",
    code,
    redirect_uri:  env.CANVA_REDIRECT_URI,
    client_id:     env.CANVA_CLIENT_ID,
    client_secret: env.CANVA_CLIENT_SECRET,
    code_verifier: codeVerifier,
  });
  const res = await fetch(CANVA_TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Canva token exchange failed: ${text}`);
  }
  return res.json();
}

export async function refreshToken(pageId: string): Promise<string> {
  const row = await getToken(pageId);
  if (!row?.refresh_token) throw new Error("No refresh token stored for page");
  if (!env.CANVA_CLIENT_ID || !env.CANVA_CLIENT_SECRET) {
    throw new Error("CANVA_CLIENT_ID / CANVA_CLIENT_SECRET not set");
  }
  const body = new URLSearchParams({
    grant_type:    "refresh_token",
    refresh_token: row.refresh_token,
    client_id:     env.CANVA_CLIENT_ID,
    client_secret: env.CANVA_CLIENT_SECRET,
  });
  const res = await fetch(CANVA_TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Canva refresh failed: ${await res.text()}`);
  const token: TokenResponse = await res.json();
  await upsertToken(pageId, token);
  return token.access_token;
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

type TokenResponse = {
  access_token:  string;
  refresh_token?: string;
  expires_in?:   number;
  token_type:    string;
};

export async function upsertToken(pageId: string, token: TokenResponse): Promise<void> {
  const expiresAt = token.expires_in
    ? new Date(Date.now() + token.expires_in * 1000)
    : null;
  await query(
    `INSERT INTO canva_tokens (page_id, access_token, refresh_token, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (page_id) DO UPDATE
       SET access_token  = EXCLUDED.access_token,
           refresh_token = COALESCE(EXCLUDED.refresh_token, canva_tokens.refresh_token),
           expires_at    = EXCLUDED.expires_at,
           updated_at    = now()`,
    [pageId, token.access_token, token.refresh_token ?? null, expiresAt]
  );
}

export async function getToken(pageId: string): Promise<{
  access_token: string; refresh_token: string | null; expires_at: Date | null;
} | null> {
  const result = await query(
    "SELECT access_token, refresh_token, expires_at FROM canva_tokens WHERE page_id = $1",
    [pageId]
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0] as { access_token: string; refresh_token: string | null; expires_at: Date | null };
  return row;
}

export async function deleteToken(pageId: string): Promise<void> {
  await query("DELETE FROM canva_tokens WHERE page_id = $1", [pageId]);
}

export async function isConnected(pageId: string): Promise<boolean> {
  const result = await query(
    "SELECT 1 FROM canva_tokens WHERE page_id = $1",
    [pageId]
  );
  return result.rows.length > 0;
}

// ─── Access token with auto-refresh ──────────────────────────────────────────

async function getValidAccessToken(pageId: string): Promise<string> {
  const row = await getToken(pageId);
  if (!row) throw new Error("Canva not connected for this page");
  if (row.expires_at && row.expires_at.getTime() - Date.now() < 60_000) {
    return refreshToken(pageId);
  }
  return row.access_token;
}

// ─── Canva REST API wrappers ──────────────────────────────────────────────────

async function canvaFetch(
  pageId: string,
  path: string,
  opts: RequestInit = {}
): Promise<any> {
  const token = await getValidAccessToken(pageId);
  const res = await fetch(`${CANVA_API_BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Canva API ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

/** List the user's designs (most recent 20) */
export async function listDesigns(pageId: string): Promise<CanvaDesign[]> {
  const data = await canvaFetch(pageId, "/designs?ownership=owned&limit=20");
  return (data.items ?? []) as CanvaDesign[];
}

/** List brand templates the user can autofill */
export async function listBrandTemplates(pageId: string): Promise<CanvaDesign[]> {
  const data = await canvaFetch(pageId, "/brand-templates?limit=20");
  return (data.items ?? []) as CanvaDesign[];
}

/** Get the autofillable dataset fields for a brand template */
export async function getTemplateDataset(
  pageId: string,
  templateId: string
): Promise<TemplateField[]> {
  const data = await canvaFetch(pageId, `/brand-templates/${templateId}/dataset`);
  return (data.dataset ?? []) as TemplateField[];
}

/**
 * Kick off an autofill job — fills a brand template with provided text/image data.
 * Returns the job ID to poll.
 */
export async function startAutofill(
  pageId: string,
  templateId: string,
  data: Record<string, { type: "text"; text: string } | { type: "image"; asset_id: string }>
): Promise<string> {
  const result = await canvaFetch(pageId, "/autofills", {
    method: "POST",
    body: JSON.stringify({
      brand_template_id: templateId,
      title:             `TPCE-${Date.now()}`,
      data,
    }),
  });
  return result.job?.id as string;
}

/** Poll autofill job until done (or timeout) */
export async function pollAutofill(
  pageId: string,
  jobId: string,
  maxWaitMs = 30_000
): Promise<{ designId: string; editUrl: string }> {
  const interval = 2000;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const result = await canvaFetch(pageId, `/autofills/${jobId}`);
    const job = result.job;
    if (job?.status === "success") {
      return { designId: job.result?.design?.id, editUrl: job.result?.design?.urls?.edit_url };
    }
    if (job?.status === "failed") {
      throw new Error(`Canva autofill job ${jobId} failed: ${JSON.stringify(job.error)}`);
    }
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error("Canva autofill timed out");
}

/**
 * Start an export job for a design (PNG, PDF, or MP4 for reels).
 * Returns job ID.
 */
export async function startExport(
  pageId: string,
  designId: string,
  format: "png" | "pdf" | "mp4" = "png"
): Promise<string> {
  const formatMap = {
    png: { type: "png" },
    pdf: { type: "pdf" },
    mp4: { type: "mp4" },
  };
  const result = await canvaFetch(pageId, "/exports", {
    method: "POST",
    body: JSON.stringify({ design_id: designId, format: formatMap[format] }),
  });
  return result.job?.id as string;
}

/** Poll export job and return download URLs */
export async function pollExport(
  pageId: string,
  jobId: string,
  maxWaitMs = 30_000
): Promise<string[]> {
  const interval = 2000;
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const result = await canvaFetch(pageId, `/exports/${jobId}`);
    const job = result.job;
    if (job?.status === "success") {
      return (job.result?.urls ?? []) as string[];
    }
    if (job?.status === "failed") {
      throw new Error(`Canva export job ${jobId} failed`);
    }
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error("Canva export timed out");
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type CanvaDesign = {
  id:        string;
  title:     string;
  thumbnail?: { url: string };
  urls?:     { edit_url?: string; view_url?: string };
  created_at?: string;
  updated_at?: string;
};

export type TemplateField = {
  name:    string;
  type:    "text" | "image";
  label?:  string;
};
