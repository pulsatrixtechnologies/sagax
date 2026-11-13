// The foot's update progress beside Connect apps: which updater states show
// it and what it says. A downloaded update is not one of them (#4093): the
// account menu's first row offers it, told once.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpdaterState } from "@/lib/updater";
import { setLocale } from "@/lib/i18n";

vi.mock("@/lib/brand", () => ({ brand: () => ({ name: "Sagax" }) }));

import { updatePillView, UpdatePillButton } from "./SidebarUpdatePill";
import { footPillCovers } from "./SidebarProfileMenu";

const tag = (html: string) => /<button[^>]*>/.exec(html)?.[0] ?? "";

afterEach(() => setLocale("en"));

describe("updatePillView", () => {
  it("stays away with no bridge, while idle, checking, failed or handed off", () => {
    expect(updatePillView(null)).toBeNull();
    for (const status of ["idle", "checking", "error", "handed-off"] as const) {
      expect(updatePillView({ status })).toBeNull();
    }
  });

  it("reports a download's progress, clamped and rounded", () => {
    expect(updatePillView({ status: "downloading", percent: 41.6 })).toMatchObject({ kind: "progress", percent: 42, text: "42%", aria: "Downloading… 42%" });
    expect(updatePillView({ status: "downloading", percent: 140 })).toMatchObject({ percent: 100 });
    expect(updatePillView({ status: "downloading" })).toMatchObject({ kind: "progress", percent: null, text: "0%", aria: "Starting download…" });
  });

  it("spins while the update is staged or installs", () => {
    expect(updatePillView({ status: "preparing" })).toMatchObject({ kind: "busy", text: "Preparing…", aria: "Preparing update…" });
    expect(updatePillView({ status: "installing" })).toMatchObject({ kind: "busy", text: "Restarting…", aria: "Restarting to update…" });
    expect(updatePillView({ status: "installing", installMode: "handoff" })).toMatchObject({ aria: "Opening a terminal…" });
  });

  it("stays away for a downloaded update: the account menu's first row offers it (#4093)", () => {
    expect(updatePillView({ status: "downloaded", version: "0.5.21" })).toBeNull();
    expect(updatePillView({ status: "downloaded" })).toBeNull();
  });

  it("covers exactly the phases the avatar's dot leaves to it", () => {
    for (const status of ["downloading", "preparing", "installing"] as const) {
      expect(updatePillView({ status } as UpdaterState)).not.toBeNull();
      expect(footPillCovers(status)).toBe(true);
    }
    for (const phase of ["idle", "checking", "downloaded", "error", "handed-off", "up-to-date"] as const) {
      expect(footPillCovers(phase)).toBe(false);
    }
  });
});

describe("UpdatePillButton", () => {
  it("draws the download as a ring and takes no click", () => {
    const view = updatePillView({ status: "downloading", percent: 40 })!;
    const html = renderToStaticMarkup(createElement(UpdatePillButton, { view }));
    expect(tag(html)).toContain('data-percent="40"');
    expect(tag(html)).toContain('aria-disabled="true"');
    expect(tag(html)).toContain('aria-busy="true"');
    expect(html).toContain("data-update-ring");
  });

  it("takes no click: the work is under way", () => {
    const view = updatePillView({ status: "preparing" })!;
    const html = renderToStaticMarkup(createElement(UpdatePillButton, { view }));
    expect(tag(html)).toContain('aria-disabled="true"');
    expect(html).not.toContain("lucide-cloud-download");
  });
});
