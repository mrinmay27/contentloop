import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../config/env.js";

export const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null
});

export const queues = {
  ingest: new Queue("ingest", { connection }),
  score: new Queue("score", { connection }),
  generate: new Queue("generate", { connection }),
  media: new Queue("media", { connection }),
  render: new Queue("render", { connection }),
  schedule: new Queue("schedule", { connection }),
  post: new Queue("post", { connection }),
  analyze: new Queue("analyze", { connection })
};

export async function enqueueDailyPipeline(): Promise<void> {
  await queues.ingest.add("daily-ingest", {}, { repeat: { pattern: "0 7 * * *" }, removeOnComplete: 50 });
  await queues.score.add("score-topics", {}, { repeat: { pattern: "15 7 * * *" }, removeOnComplete: 50 });
  await queues.generate.add("generate-content", {}, { repeat: { pattern: "30 7 * * *" }, removeOnComplete: 50 });
  await queues.media.add("synthesize-audio", {}, { repeat: { pattern: "35 7 * * *" }, removeOnComplete: 50 });
  await queues.render.add("render-videos", {}, { repeat: { pattern: "45 7 * * *" }, removeOnComplete: 50 });
  await queues.schedule.add("schedule-approved", {}, { repeat: { pattern: "*/30 * * * *" }, removeOnComplete: 50 });
  await queues.post.add("publish-due", {}, { repeat: { pattern: "*/10 * * * *" }, removeOnComplete: 50 });
  await queues.analyze.add("analyze-posts", {}, { repeat: { pattern: "0 * * * *" }, removeOnComplete: 50 });
}
