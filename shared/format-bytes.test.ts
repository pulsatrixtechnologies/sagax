import { describe, expect, it } from "vitest";
import { formatArchiveBytes, formatBytes, formatDebuggerBytes, formatFileBytes, formatMemoryBytes, formatPanelBytes } from "./format-bytes";

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

  it("keeps memory rounding, locale fallback and the kilobyte ceiling", () => {
    const words = { bytes: (count: number) => `${count} B`, kilobytes: (count: string) => `${count} KB` };
    expect(formatMemoryBytes(120, "en", words)).toBe("120 B");
    expect(formatMemoryBytes(1536, "fr", words)).toBe("1,5 KB");
    expect(formatMemoryBytes(1024 ** 2, "en", words)).toBe("1,024 KB");
    expect(formatMemoryBytes(1536, "invalid_locale", words)).toBe("1.5 KB");
  });

  it("folds bytes into readable units, French and English", () => {
    expect(formatBytes(0, "fr")).toBe("0 o");
    expect(formatBytes(1536, "fr")).toBe("1,5 Ko");
    expect(formatBytes(16 * 1024 ** 3, "fr")).toBe("16 Go");
    expect(formatBytes(3.25 * 1024 ** 4, "en")).toBe("3.3 TB");
    expect(formatBytes(512, "en")).toBe("512 B");
  });

  it("keeps one file wording, and does not borrow the archive scale", () => {
    expect(formatFileBytes(512)).toBe("512 B");
    expect(formatFileBytes(1536)).toBe("1.5 KB");
    expect(formatFileBytes(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatFileBytes(1024 ** 3)).toBe("1024.0 MB");
    expect(formatArchiveBytes(1024 ** 3)).toBe("1.0 GB");
    expect(formatDebuggerBytes(1536)).toBe("1.5 kB");
    expect(formatDebuggerBytes(1536)).not.toBe(formatFileBytes(1536));
    expect(formatPanelBytes(5 * 1024 * 1024)).not.toBe(formatFileBytes(5 * 1024 * 1024));
  });
});
