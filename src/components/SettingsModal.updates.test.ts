import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { UpdaterState } from "@/lib/updater";

// The desktop app answers only this computer's page and the person's own
// Cloud (on My Cloud, only once the saved sign-in has been restored). Until it
// answers, Settings says nothing about this app's updates.
const fixture = vi.hoisted(() => ({ state: null as UpdaterState | null }));
vi.mock("@/lib/updater", () => ({ useUpdaterState: () => fixture.state }));
import { UpdatesRow } from "./SettingsModal";

afterEach(() => vi.unstubAllGlobals());
function render(state: UpdaterState | null) {
  fixture.state = state;
  vi.stubGlobal("window", { ogb: { updater: { check: vi.fn(), install: vi.fn(), onState: vi.fn() } } });
  return renderToStaticMarkup(createElement(UpdatesRow));
}

it("says nothing about updates on a page the desktop app doesn't answer, such as another server's", () => {
  expect(render(null)).toBe("");
});

it("shows this app's update where the desktop app answers, with no Download step", () => {
  const idle = render({ status: "idle" });
  expect(idle).toContain("Check for updates");
  expect(idle).toContain("Up to date");
  expect(idle).toMatch(/Sagax\s/);
  const downloading = render({ status: "downloading", version: "0.2.0", percent: 40 });
  expect(downloading).toContain("Downloading 40%");
  expect(downloading).toContain("disabled");
  // Sagax's own wording (no OMB Cloud page to tell apart from this app).
  const ready = render({ status: "downloaded", version: "0.2.0" });
  expect(ready).toContain("0.2.0 ready. Restart to apply");
  expect(ready).toContain("Restart and install");
  expect(render({ status: "downloaded", version: "0.2.0", installMode: "handoff" })).toContain("0.2.0 ready. Install in a terminal");
});
