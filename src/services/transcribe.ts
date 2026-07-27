/** Transcribe an uploaded video so captions can be burned in.
 *
 *  Uses Groq's OpenAI-compatible audio endpoint — whisper-large-v3 is already
 *  available on the same key used for scoring and generation, so this needs no
 *  new provider. With no key the creator types or pastes their own captions
 *  instead; we never fabricate a transcript.
 */
import fs from "node:fs";
import { llmConfigStore } from "../config/llmConfigStore.js";

export interface TranscriptSegment { start: number; end: number; text: string }

export function srtTimestamp(seconds: number): string {
  const s = Math.max(0, seconds);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(Math.floor(s % 60)).padStart(2, "0");
  const ms = String(Math.round((s % 1) * 1000)).padStart(3, "0");
  return `${hh}:${mm}:${ss},${ms}`;
}

export function segmentsToSrt(segments: TranscriptSegment[]): string {
  const cues: string[] = [];
  let n = 1;
  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;
    cues.push(`${n++}\n${srtTimestamp(seg.start)} --> ${srtTimestamp(seg.end)}\n${text}\n`);
  }
  return cues.join("\n");
}

/** Groq keys live in data/llm_configs.json via llmConfigStore, NOT configStore. */
export function resolveGroqKey(): string {
  return (
    llmConfigStore.list().find((c) => c.provider === "groq" && c.apiKey)?.apiKey
    ?? process.env.GROQ_API_KEY
    ?? ""
  );
}

/** Returns null when no key is configured — the caller falls back to manual
 *  captions rather than inventing a transcript. */
export async function transcribeVideo(absPath: string): Promise<TranscriptSegment[] | null> {
  const apiKey = resolveGroqKey();
  if (!apiKey) return null;

  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(absPath)]), "source.mp4");
  form.append("model", "whisper-large-v3");
  form.append("response_format", "verbose_json");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${await res.text()}`);

  const data: any = await res.json();
  return (data.segments ?? []).map((s: any) => ({
    start: Number(s.start) || 0,
    end: Number(s.end) || 0,
    text: String(s.text ?? ""),
  }));
}
