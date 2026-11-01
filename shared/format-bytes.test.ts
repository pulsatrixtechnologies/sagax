import { describe, expect, it } from "vitest";
import { formatArchiveBytes, formatBytes, formatDebuggerBytes, formatPanelBytes } from "./format-bytes";

describe("format-bytes", () => {
  it("keeps the archive wording", () => {
    expect(formatArchiveBytes(512)).toBe("512 B");
    expect(formatArchiveBytes(1536)).toBe("1.5 KB");
    expect(formatArchiveBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  it("keeps the debugger wording", () => {
    expect(formatDebuggerBytes(null)).toBe("");
    expect(formatDebuggerBytes(1536)).toBe("1.5 kB");
  });

  it("keeps the environment panel wording", () => {
    expect(formatPanelBytes(undefined)).toBe("?");
    expect(formatPanelBytes(5 * 1024 * 1024)).toBe("5 MiB");
    expect(formatPanelBytes(1.5 * 1024 ** 3)).toBe("1.5 GiB");
  });

  it("folds bytes into readable units, French and English", () => {
    expect(formatBytes(0, "fr")).toBe("0 o");
    expect(formatBytes(1536, "fr")).toBe("1,5 Ko");
    expect(formatBytes(16 * 1024 ** 3, "fr")).toBe("16 Go");
    expect(formatBytes(3.25 * 1024 ** 4, "en")).toBe("3.3 TB");
    expect(formatBytes(512, "en")).toBe("512 B");
  });
});
