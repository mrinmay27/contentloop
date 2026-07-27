# Media Source Spine — Design Spec

> Status: Draft for approval, 2026-07-27
> Goal: one pipeline, many ways in. Every way a creator can make content
> converges on the same downstream path, so no route can be half-wired.
> Supersedes the media portion of `2026-07-27-publishing-and-remix-design.md`;
> that spec's YouTube publishing half still stands and follows this.

---

## The problem this solves

Creators don't work the same way. Some film themselves, some run faceless
stock-footage pages, some want AI-generated concept video, some live in Canva.
ContentLoop should serve all of them.

The failure mode to avoid is the one this codebase already demonstrated: at
v0.1.0 the app offered caption tones, logo upload, built-in niches, name
suggestions, two Regenerate buttons, an "✓ Available" badge, and quality
sliders for two sources — none of which did anything. Every one was *a route
offered but never finished*. Adding five media routes carelessly multiplies
that failure by five, and a creator hitting a dead end concludes the product
is broken, not that one route is unfinished.

**Rule this spec enforces:** a route is either complete end-to-end, or it
reports itself unavailable with a reason. Never a dead end.

BYOK makes breadth safe on *cost* — users only pay for keys they hold — but
not on *completeness*. Key-absence must render as "needs a key", never as a
failure.

---

## The spine

Everything converges:

```
  ┌─ generated stills  (works today)
  ├─ stock video       (searchVideos() exists, never called)
  ├─ your own upload   (not built)          →  [ MediaAsset ]
  ├─ AI-generated video(not built)                  ↓
  └─ external editor   (Canva OAuth exists)   captions + branding
                                                    ↓
                                              approval  ← always
                                                    ↓
                                                publisher
```

Only the left column varies. One `MediaAsset` contract, one downstream.

### The contract

```ts
export type MediaKind = 'image' | 'video';

export interface MediaAsset {
  kind:        MediaKind;
  url:         string;        // /uploads/... served by express.static
  absPath:     string;        // for ffprobe / Remotion
  durationSec: number | null; // null for stills
  width:       number;
  height:      number;
  bytes:       number;
  origin:      MediaOrigin;   // provenance — drives UI labelling
}

export type MediaOrigin =
  | 'generated_image' | 'stock_video' | 'user_upload'
  | 'ai_video' | 'external_editor';
```

`origin` is not decoration: the editor must be able to tell a creator where a
clip came from, and publishing rules may differ (an AI-generated clip may need
disclosure on some platforms).

### Availability, not dead ends

Mirrors `generationProviders.ts`, which already gets this right:

```ts
export interface MediaSourceDef {
  id: string; name: string; icon: string;
  kind: MediaKind;
  keyName?: string;          // absent ⇒ always available
  freeProvider?: boolean;
  models?: ModelOption[];
  docsUrl: string;
  note?: string;
}
```

`resolveAvailability(def)` returns `available | needs_key | unsupported`, and
the UI renders `needs_key` as a "Connect" affordance with the docs link —
never a broken button. A source with no complete implementation is not listed
at all.

---

## Route 1 — Real stock video *(smallest, free, do first)*

`stockFootage.ts` already contains a complete `searchVideos()` hitting Pexels'
video API and parsing `video_files` by resolution. **It is called from
nowhere.** `sourceReelBackgrounds()` calls `searchImages()` only, which is why
every reel is a slideshow.

- `sourceReelBackgrounds` gains a preference: try `searchVideos()` first, fall
  back to stills when no clip is found or no Pexels key exists.
- `ReelComposition` renders `<OffthreadVideo>` for video assets and keeps
  `<Img>` for stills. Both already exist in Remotion; only `Img` is used today.
- Clip shorter than its slide → freeze last frame rather than a black gap.

Free, no new dependency, and it removes the "slideshow" quality ceiling.

## Route 2 — Bring your own footage *(highest value)*

The route most serious creators need, and the one that makes YouTube Shorts
publishing genuinely useful.

**Blocking constraint, verified:** the existing upload helpers
(`saveBrandImage` / `saveContentImage`) take a **base64 data URL** through a
JSON body capped at 25 MB. Base64 inflates ~4/3, and a 60-second 1080p clip is
routinely 50–150 MB. **Video cannot use this path.** There is no multipart
handling in the app today (`multer`/`busboy`/`formidable` all absent).

- Add streaming multipart upload for video only — `POST /api/content/:id/video`
  — writing to disk as it arrives rather than buffering in memory. Desktop mode
  runs on a laptop; buffering a 500 MB upload would exhaust it.
- Accept `mp4`, `mov`, `webm`. Reject by **sniffing the container**, not by
  filename extension.
- Cap configurable (`MAX_UPLOAD_MB`, default 500) and enforced *during* the
  stream, aborting early — not after the whole file has landed.
- `ffprobe` the result for duration/dimensions/codec → `MediaAsset`.
- Reject with a plain sentence what cannot be published: "This video is 4:3 —
  Shorts and Reels need vertical (9:16). Crop it or pick another file."

## Route 3 — Captions and light edits *(what makes Route 2 useful)*

Uploading is only half of it; the ask was captions plus light edits.

**Transcription** — an uploaded video has no script, so subtitles must come
from the audio. Route through the existing LLM provider chain (Groq hosts
Whisper — `whisper-large-v3` appeared in the live model list I pulled from the
user's own Groq key, so this needs no new provider). No key ⇒ the creator can
type or paste a caption file instead. Never fabricate a transcript.

**Editing scope, deliberately narrow:**
- trim start/end
- crop / pad to 9:16, 1:1, 16:9
- burn in captions using the existing subtitle styling
- optional brand overlay (logo, accent) reusing `pages.brand`

**Tooling — corrected 2026-07-27 after measuring it.** `@remotion/compositor-*`
does ship `ffmpeg` and `ffprobe`, but it is a **stripped build with 42 filters**.
It has `scale`, `crop`, `libx264` and `aac` — but **not `subtitles`, `drawtext`,
`overlay` or `pad`**. So the earlier claim that captions could be burned in with
it was wrong.

Split the work by tool:
- **trim / crop / probe** → bundled ffmpeg + ffprobe (`scale`, `crop` present).
- **caption burn-in and brand overlay** → **Remotion compositing**, not ffmpeg.
  An uploaded clip renders as `<OffthreadVideo>` with caption components on
  top — exactly the mechanism Phase A just built and verified. This is cleaner
  than shelling out anyway, and reuses the existing subtitle styling.

Two operational notes, both learned the hard way in Phase A:
- The bundled binaries need `DYLD_LIBRARY_PATH` (macOS) / `LD_LIBRARY_PATH`
  (Linux) pointed at the compositor directory, or they fail with
  "Library not loaded: libavdevice.dylib".
- Remotion rejects both absolute filesystem paths and `file://` URLs for
  assets. Anything it renders must sit under the bundle's `publicDir` and be
  referenced relative to it via `staticFile()`.

System ffmpeg still must not be assumed — it is absent on most machines and
would break the one-click bundle.

Anything beyond this (multi-clip timeline, transitions, colour) is out of
scope — that is a video editor, and Route 5 exists for people who want one.

## Route 4 — AI-generated video, two lanes

Confirmed with the user 2026-07-27: **Veo billing is not enabled**, so the API
lane is not the default. The subscription bridge is.

### 4a — Subscription bridge *(primary; no API cost)*

The app already does exactly this for images: `ManualGenerateBridge.tsx` builds
an enriched prompt, copies it to the clipboard, deep-links the tool, and
captures the result. Creators pay for ChatGPT Plus / Gemini Advanced / Canva
Pro anyway, and those subscriptions include video generation. Using them costs
nothing extra.

Mirror that component's conventions rather than inventing a second one:
- enriched prompt → clipboard **always** (the only 100% reliable step)
- open the tool in a new tab
- honest per-tool labelling, exactly as the image bridge already distinguishes
  "ChatGPT auto-submits" from "Gemini doesn't auto-fill — paste with Cmd+V"

**Prompt enrichment differs from images.** Video needs: 9:16 vertical, a target
duration, motion described explicitly, and "no on-screen text, no watermark,
no captions" — ContentLoop burns its own captions in Route 3, and generated
text would collide with them.

**The critical difference from images — the return path is a file, not a paste.**
A browser can put an *image* on the clipboard; it cannot put a *video* there.
So Route 4a cannot reuse the paste listener. The creator downloads the clip and
brings it back via **drag-drop or file picker — i.e. Route 2's multipart
upload**. The UI must say "download it, then drop it here", not imply Cmd+V
works. Getting this wrong would produce exactly the kind of control that looks
functional and isn't.

This makes 4a nearly free once Route 2 exists: a prompt builder, deep links,
and a drop zone pointed at an endpoint that already exists.

**Tool list** (order = suggested, all user-editable):

| Tool | Prefill support |
|---|---|
| Gemini (Veo) | `?q=` opens with prompt; needs manual paste — **verified pattern, already used for images** |
| ChatGPT (Sora) | `?q=` auto-submits for text/images; **video behaviour unverified** |
| Canva | open + paste — no documented prompt parameter |
| Higgsfield | open + paste — no documented prompt parameter |
| Runway / Luma | open + paste |

I verified only that these domains resolve. **Whether any accepts a prefill
parameter for video cannot be verified without a real browser session**, so
every tool defaults to "copy + open + paste manually", which always works.
Auto-fill is claimed only where it is actually known to work.

### 4b — API providers *(BYOK, opt-in)*

A `VideoProvider` chain mirroring `getProviderChain()`: ordered, each gated on
its key, first available wins. Off by default; appears as `needs_key`.

- **Google Veo** — `veo-3.1-generate-preview` / `-fast-` are exposed on the
  user's existing Google AI Studio key (verified live), but **billing is not
  enabled on that project**, so it will fail until the user turns it on. The
  provider must surface that as "Veo needs billing enabled on your Google Cloud
  project", never a raw 403.
- Async by nature: Veo uses `predictLongRunning`, so the chain polls an
  operation and persists a job id. Unlike image generation, which returns
  inline, the render job needs a "generating" state that survives a restart —
  in desktop mode the app may be closed mid-generation, so the poll must resume
  at launch like the scheduler's catch-up pass.
- Runway / Luma / Higgsfield are config entries against the same interface.
  **Higgsfield's public API terms are unverified** — it goes in only after its
  docs are read, not on assumption.
- Cost warning before generation. Video is billed per second; a surprise bill
  is a betrayal of trust.

## Route 5 — External editor round-trip

Canva OAuth, design listing and autofill already exist (`CanvaPanel`). Missing
is the export path back in: export a finished design/video from Canva, land it
as a `MediaAsset` with `origin: 'external_editor'`.

Lowest priority, and honestly labelled: if Canva's Connect API does not expose
video export, this route is **not offered at all** rather than shipped broken.
To be confirmed against their docs before any implementation.

---

## Explicit non-goals

- **Auto-publishing.** Approval stays mandatory. Nothing reaches a platform
  without a human pressing approve — decided with the user, 2026-07-27.
- Multi-clip timeline editing, transitions, colour grading, keyframes.
- Re-encoding to every platform's ideal spec — one vertical master output.
- Storing media anywhere but local disk (no S3/CDN).
- Any source requiring scraping or violating a platform's terms.

## Testing

- **Pure/unit (vitest):** availability resolution (`available | needs_key |
  unsupported`), aspect-ratio classification and the crop/pad decision,
  duration guards, upload size/type validation, provider-chain ordering. This
  is where the real logic sits and none of it needs a network.
- **Live, this machine:** stock-video route end to end (Pexels key permitting),
  a real multipart upload of a large file including the mid-stream abort,
  ffprobe metadata extraction, caption burn-in.
- **Cannot be verified here, and must be reported as such:** Veo generation
  (needs billing confirmation and costs money — I will not spend the user's
  money without explicit approval), and any Canva video export.

## Order

```
1. Spine contract + availability model   ← everything else depends on it
2. Route 1 stock video                   ← free, small, proves the spine
3. Route 2 upload  →  Route 3 captions/edits   ← the highest-value pair
4. Route 4a subscription bridge   ← nearly free once Route 2 lands
5. Route 4b API providers (Veo, billing-gated) — opt-in
6. Route 5 Canva export — only if the API supports it
```

Routes 1–3 need no key beyond what the app already uses and deliver the
biggest quality jump. Route 4a needs none either — it rides the subscriptions
creators already pay for, and reuses Route 2's upload as its return path.
Route 4b is where BYOK breadth pays off for those who want full automation.
