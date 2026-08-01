import { describe, expect, it } from "vitest";
import { buildTitle } from "../src/domain/youtube.js";

/** Regression guard for a payload shape, expressed through what depended on it.
 *
 *  Only the 'post' branch wrote payload.hook, so every generated reel and
 *  carousel carried an empty one. Seven consumers read it — the editor's Hook
 *  field, the Inbox card, caption formatting, the Reddit title and the YouTube
 *  title — and each silently got "". Shorts uploaded titled "New Short".
 */
describe("hook must survive into the payload", () => {
  it("an empty hook becomes a placeholder YouTube title", () => {
    expect(buildTitle("")).toBe("New Short");
    expect(buildTitle("   ")).toBe("New Short");
  });

  it("a real hook is used as the title", () => {
    expect(buildTitle("Stop ignoring this AI Tools trend")).toBe("Stop ignoring this AI Tools trend");
  });
});
