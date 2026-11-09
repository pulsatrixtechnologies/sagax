import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  classifyPiExtensionFailure,
  leaveOutPiExtension,
  piExtensionFailureMessage,
  piExtensionLoadFailure,
  piSkippedNotice,
  resetPiExtensionFailures,
  skipFailedPiExtension,
} from "./pi-extension-failures.ts";

const kit = {
  args: ["-e", "/home/p/extensions/voice.ts", "-e", "/home/p/extensions/audit-guard.ts", "-e", "/opt/pkgs/tone"],
  guards: ["/home/p/extensions/audit-guard.ts"],
};

afterEach(() => resetPiExtensionFailures());

describe("pi extension load failures (#3063)", () => {
  it("finds pi's line in stderr", () => {
    expect(piExtensionLoadFailure("a\nFailed to load extension X /p/v.ts\nb")).toBe("Failed to load extension X /p/v.ts");
    expect(piExtensionLoadFailure("nothing")).toBeNull();
  });

  it("names a kit extension, a guard, a package file, the Sagax extension, or nothing", () => {
    expect(classifyPiExtensionFailure("Failed to load extension E /home/p/extensions/voice.ts", kit)).toEqual({ kind: "skip", arg: "/home/p/extensions/voice.ts" });
    expect(classifyPiExtensionFailure("Failed to load extension E /home/p/extensions/audit-guard.ts", kit)).toEqual({ kind: "guard", arg: "/home/p/extensions/audit-guard.ts" });
    expect(classifyPiExtensionFailure("Failed to load extension E /opt/pkgs/tone/index.ts", kit)).toEqual({ kind: "skip", arg: "/opt/pkgs/tone" });
    expect(classifyPiExtensionFailure("Failed to load extension E C:\\sx\\mcp.js", kit, "C:\\sx\\mcp.js")).toEqual({ kind: "guard", arg: "C:\\sx\\mcp.js" });
    expect(classifyPiExtensionFailure("Failed to load extension E /home/p/extensions/._x.ts", kit)).toEqual({ kind: "unknown" });
  });

  it("writes words the person can read", () => {
    expect(piExtensionFailureMessage({ kind: "guard", arg: "/x/audit-guard.ts" }, "L")).toMatch(/guard audit-guard\.ts.*never runs without its guards.*pi said: "L"/);
    expect(piExtensionFailureMessage({ kind: "unknown" }, "L")).toMatch(/cannot tell which one/);
    leaveOutPiExtension("/x/voice.ts", "Failed X");
    expect(piSkippedNotice(["/x/voice.ts"])).toMatch(/voice\.ts, so this turn runs without it.*pi said: "Failed X"/);
  });

  it("keeps an extension out until its kit file changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-pi-ext-"));
    const copy = join(dir, "copy.ts");
    const source = join(dir, "source.ts");
    writeFileSync(copy, "broken(");
    writeFileSync(source, "broken(");
    expect(skipFailedPiExtension(copy, source)).toBe(false);
    leaveOutPiExtension(copy, "Failed");
    expect(skipFailedPiExtension(copy, source)).toBe(true);
    writeFileSync(source, "export default () => {};");
    expect(skipFailedPiExtension(copy, source)).toBe(false);
    // forgotten once loaded again
    writeFileSync(source, "broken(");
    expect(skipFailedPiExtension(copy, source)).toBe(false);
  });
});
