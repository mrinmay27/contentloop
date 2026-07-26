import { describe, expect, it } from "vitest";
import { MAX_LOGO_BYTES, validateLogoFile, approxDataUrlBytes } from "../src/web/lib/logoUpload.js";

const file = (type: string, size: number) => ({ type, size, name: "logo" });

describe("validateLogoFile", () => {
  it("accepts the image types the branding endpoint stores", () => {
    expect(validateLogoFile(file("image/png", 1000))).toBeNull();
    expect(validateLogoFile(file("image/jpeg", 1000))).toBeNull();
    expect(validateLogoFile(file("image/svg+xml", 1000))).toBeNull();
    expect(validateLogoFile(file("image/webp", 1000))).toBeNull();
  });

  it("rejects non-images with a message a normal person can act on", () => {
    const err = validateLogoFile(file("application/pdf", 1000));
    expect(err).toMatch(/image/i);
    expect(err).not.toMatch(/mime|dataurl|base64/i);
  });

  it("rejects files too large to survive the 25mb JSON body limit", () => {
    // base64 inflates by ~4/3, so the byte ceiling must sit well under 25mb.
    expect(MAX_LOGO_BYTES).toBeLessThan(25 * 1024 * 1024 * 0.75);
    expect(validateLogoFile(file("image/png", MAX_LOGO_BYTES + 1))).toMatch(/too large|smaller/i);
    expect(validateLogoFile(file("image/png", MAX_LOGO_BYTES))).toBeNull();
  });

  it("rejects an empty file", () => {
    expect(validateLogoFile(file("image/png", 0))).toMatch(/empty/i);
  });
});

describe("approxDataUrlBytes", () => {
  it("estimates the decoded size of a data URL", () => {
    // "AAAA" base64 -> 3 bytes
    expect(approxDataUrlBytes("data:image/png;base64,AAAA")).toBe(3);
  });
  it("accounts for base64 padding", () => {
    expect(approxDataUrlBytes("data:image/png;base64,AAA=")).toBe(2);
    expect(approxDataUrlBytes("data:image/png;base64,AA==")).toBe(1);
  });
  it("returns 0 for anything that is not a data URL", () => {
    expect(approxDataUrlBytes("https://example.com/a.png")).toBe(0);
    expect(approxDataUrlBytes("")).toBe(0);
  });
});
