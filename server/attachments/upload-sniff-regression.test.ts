// Regression test for the disguised-executable upload hole.
//
// Before this change, saveImage() trusted the declared mime: an ELF binary
// sent as "image/png" was stored as a .png and served back. On main this test
// FAILS at the enforce assertion (the upload is accepted). With the content
// check, enforce refuses it with 415 and the default (warn) logs it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveImage } from "./attachments.ts";

const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), Buffer.alloc(64)]);
const saved = process.env.SAGAX_UPLOAD_SNIFF;

afterEach(() => {
  if (saved === undefined) delete process.env.SAGAX_UPLOAD_SNIFF; else process.env.SAGAX_UPLOAD_SNIFF = saved;
  vi.restoreAllMocks();
});

describe("disguised executable upload", () => {
  it("is refused when SAGAX_UPLOAD_SNIFF=enforce", () => {
    process.env.SAGAX_UPLOAD_SNIFF = "enforce";
    let error: unknown;
    try { saveImage(elf, "image/png"); } catch (e) { error = e; }
    expect(error, "an ELF binary declared as image/png was accepted").toBeInstanceOf(Error);
    expect((error as { status?: number }).status).toBe(415);
    expect((error as Error).message).toMatch(/executable/);
  });

  it("is logged, not refused, in the default observe mode", async () => {
    const { sniffModeFromEnv } = await import("./upload-content-check.ts");
    expect(sniffModeFromEnv({})).toBe("warn");
    process.env.SAGAX_UPLOAD_SNIFF = "warn";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => saveImage(elf, "image/png")).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/warn only.*executable/));
  });
});
