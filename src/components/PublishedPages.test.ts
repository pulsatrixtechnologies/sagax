// The approval card's request (src/components/PublishedPages.tsx): the access
// and expiry are the person's choices, sent as given; the preview frame never
// has same-origin.
import { describe, expect, it } from "vitest";

import { pageFrameSandbox } from "../../shared/published-pages";
import { pageCardOpenVersion, pageCardStatusWithThreadLatest } from "@/lib/page-chat-layout";
import { expiryFromHours, pageCardState, previewSrc, publishBody } from "./PublishedPages";

describe("published page card", () => {
  it("publishBody carries the version, the access the person picked and the expiry", () => {
    const now = 1_000_000;
    expect(publishBody(3, "private", 0, now)).toEqual({ version: 3, access: "private", expiresAt: null });
    expect(publishBody(1, "link", 24, now)).toEqual({ version: 1, access: "link", expiresAt: now + 24 * 3_600_000 });
    expect(expiryFromHours(0, now)).toBeNull();
  });

  it("previews in a sandbox with scripts only, never popups (#1799)", () => {
    expect(pageFrameSandbox("html")).toBe("allow-scripts");
    expect(pageFrameSandbox("markdown")).toBe("allow-scripts");
    expect(pageFrameSandbox("presentation")).toBe("allow-scripts");
    expect(pageFrameSandbox("markdown")).not.toContain("allow-popups");
  });

  it("frames only this server's own preview wrapper path, never srcdoc or another address", () => {
    expect(previewSrc("/pages/preview/abcdefgh12345678/2")).toBe("/pages/preview/abcdefgh12345678/2");
    for (const bad of ["https://evil.example/pages/preview/abcdefgh12345678/2", "//evil.example/x", "javascript:alert(1)", "/pages/preview/../api/config", "/pages/frame/x.y", ""]) {
      expect(previewSrc(bad)).toBeNull();
    }
  });
});

describe("the page card's line (2026-10-28)", () => {
  const v = (n: number, state = "proposed") => ({ n, state });
  it("says where this version stands", () => {
    expect(pageCardState(null, 1)).toBeNull();
    expect(pageCardState({ status: "draft", currentVersion: null, versions: [v(1)] } as never, 1)).toBe("draft");
    expect(pageCardState({ status: "published", currentVersion: 1, versions: [v(1, "published")] } as never, 1)).toBe("published");
    expect(pageCardState({ status: "published", currentVersion: 1, versions: [v(1, "published"), v(2)] } as never, 2)).toBe("proposed");
    expect(pageCardState({ status: "draft", currentVersion: null, versions: [v(1), v(2)] } as never, 1)).toBe("superseded");
    expect(pageCardState({ status: "draft", currentVersion: null, versions: [v(1, "declined")] } as never, 1)).toBe("declined");
    expect(pageCardState({ status: "revoked", currentVersion: null, versions: [v(1)] } as never, 1)).toBe("revoked");
  });

  it("opens the latest page from an Updated-below card", () => {
    expect(pageCardOpenVersion(pageCardState({ status: "draft", currentVersion: null, versions: [v(1), v(2)] } as never, 1), 1)).toBeUndefined();
    expect(pageCardOpenVersion(pageCardState({ status: "published", currentVersion: 2, versions: [v(1, "published"), v(2, "published")] } as never, 2), 2)).toBe(2);
  });

  it("a thread-newer version marks Updated below before the summary catches up", () => {
    const stale = pageCardState({ status: "draft", currentVersion: null, versions: [v(1)] } as never, 1);
    expect(stale).toBe("draft");
    expect(pageCardStatusWithThreadLatest(stale, 1, 2)).toBe("superseded");
    expect(pageCardOpenVersion(pageCardStatusWithThreadLatest(stale, 1, 2), 1)).toBeUndefined();
  });
});
