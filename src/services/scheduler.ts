import { addDays, format, isBefore, set } from "date-fns";
import { env, timeSlots } from "../config/env.js";

export function nextAvailableSlot(existingScheduledTimes: Date[], now = new Date()): Date {
  const sorted = [...existingScheduledTimes].sort((a, b) => a.getTime() - b.getTime());
  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const day = addDays(now, dayOffset);
    let postsForDay = 0;

    for (const slot of timeSlots) {
      const [hours, minutes] = slot.split(":").map(Number);
      const candidate = set(day, { hours, minutes, seconds: 0, milliseconds: 0 });
      if (!isBefore(now, candidate)) continue;
      if (format(candidate, "yyyy-MM-dd") === format(now, "yyyy-MM-dd")) {
        postsForDay = sorted.filter((time) => format(time, "yyyy-MM-dd") === format(candidate, "yyyy-MM-dd")).length;
      }
      if (postsForDay >= env.MAX_POSTS_PER_PAGE_PER_DAY) continue;
      if (respectsGap(candidate, sorted)) return candidate;
    }
  }
  return addDays(now, 14);
}

function respectsGap(candidate: Date, times: Date[]): boolean {
  const minMs = env.MIN_POST_GAP_HOURS * 36e5;
  return times.every((time) => Math.abs(candidate.getTime() - time.getTime()) >= minMs);
}
