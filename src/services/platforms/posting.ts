import { env } from "../../config/env.js";

export interface PublishInput {
  postId: string;
  platform: string;
  payload: unknown;
  pageHandle: string;
}

export async function publishPost(input: PublishInput): Promise<string> {
  if (env.POSTING_DRY_RUN) {
    return `dry-run-${input.platform}-${input.postId}`;
  }

  if (input.platform === "instagram") {
    return publishInstagram(input);
  }
  if (input.platform === "youtube_shorts") {
    return publishYoutubeShort(input);
  }
  throw new Error(`Unsupported platform: ${input.platform}`);
}

async function publishInstagram(input: PublishInput): Promise<string> {
  if (!env.INSTAGRAM_ACCESS_TOKEN) {
    throw new Error("INSTAGRAM_ACCESS_TOKEN is required when POSTING_DRY_RUN=false");
  }
  void input;
  throw new Error("Instagram live publishing adapter must be connected to Meta Graph API review credentials.");
}

async function publishYoutubeShort(input: PublishInput): Promise<string> {
  if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET) {
    throw new Error("YouTube OAuth credentials are required when POSTING_DRY_RUN=false");
  }
  void input;
  throw new Error("YouTube live publishing adapter must be connected to OAuth upload flow.");
}
