import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot, ConfigStatus } from "@/state/store";
import { WorksOnControl, worksOnMode, WorksOnSetting, worksOnTip, type WorksOnMode } from "./WorksOnSetting";
import { SettingsSurfaceProvider } from "../SettingsPrimitives";

const fixture = vi.hoisted(() => ({ config: null as unknown, organization: false }));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/perspicax-org")>(),
  usePerspicaxOrg: () => (fixture.organization ? { org: { identity: { kind: "perspicax" } } } : null),
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, config: fixture.config ?? original.initialState.config },
      dispatch: vi.fn(),
    }),
  };
});
vi.mock("../DesktopCapabilities", () => ({
  useDesktopCapabilities: () => ({
    capabilities: {
      host: { packaged: true, platform: "darwin" },
      localComputer: { available: true, support: "supported", enabled: true, status: "enabled" },
    },
    ready: true,
  }),
}));

beforeEach(() => { vi.stubGlobal("window", {}); fixture.config = null; fixture.organization = false; });
afterEach(() => vi.unstubAllGlobals());

const labels = (markup: string) => [...markup.matchAll(/data-works-on-choice="([^"]+)"[^>]*>([^<]*)</g)].map((match) => match[2]);

function control(organization: boolean, value: WorksOnMode = null) {
  return renderToStaticMarkup(createElement(WorksOnControl, { value, organization, onChange: () => {} }));
}

describe("Works on: Auto, this computer or the cloud computer, never Off", () => {
  it("offers this computer and the cloud computer on a solo or an organization server", () => {
    expect(labels(control(false))).toEqual(["Auto", "This computer", "Cloud computer"]);
    expect(labels(control(true))).toEqual(["Auto · picks per task", "This computer", "Cloud (server environment)"]);
  });

  it("says the bot picks the place for each task, and never offers Off", () => {
    const markup = control(true);
    expect(markup).toMatch(/<p id="works-on-setting-hint"[^>]*>The bot picks where each task runs/);
    expect(markup).not.toContain('data-works-on-choice="off"');
    expect(worksOnTip(null)).toMatch(/^Picks the place for each task among the available ones\. Never a place you or your organization did not allow/);
  });

  it("keeps this computer and the cloud computer, and reads a Local VM or the browser as Auto", () => {
    expect(worksOnMode(undefined)).toBeNull();
    expect(worksOnMode("local")).toBe("local");
    expect(worksOnMode("cloud")).toBe("cloud");
    for (const place of ["vm", "browser"] as const) expect(worksOnMode(place)).toBeNull();
    expect(worksOnMode("off")).toBeNull();
    expect(control(false, worksOnMode("local"))).toMatch(/aria-checked="true"[^>]*data-works-on-choice="local"/);
    expect(control(false, worksOnMode("off"))).toMatch(/aria-checked="true"[^>]*data-works-on-choice="auto"/);
  });

  it("hides the control from an organization member who cannot save where the bot works", () => {
    const bot = {
      id: "bot-1", threadId: "thread-1", name: "Scout", title: "Scout", description: "",
      notifications: false, color: "green", unread: false, messages: [],
      modelSelection: { instanceId: "local", model: "test-model" },
      ownerUserId: "owner",
    } as Bot;
    fixture.config = { viewer: { role: "member", operator: false, principalId: "ada" } } as Partial<ConfigStatus>;
    expect(renderToStaticMarkup(createElement(WorksOnSetting, { bot }))).toBe("");
    fixture.config = null;
    expect(renderToStaticMarkup(createElement(WorksOnSetting, { bot }))).toContain('data-works-on-setting="auto"');
  });
});

// The bot's profile page (#2313): the card's grey label names the place, the
// explanation is its first line and the four places are the page's segmented
// control, with no outline, underline or primary pill.
describe("Works on, on the profile page (plain surface)", () => {
  const plain = (value: WorksOnMode) => renderToStaticMarkup(createElement(SettingsSurfaceProvider, { surface: "plain", children: createElement(WorksOnControl, { value, organization: false, onChange: () => {} }) }));

  it("labels its card and keeps every place, the hint and the selection", () => {
    const markup = plain("local");
    expect(markup).toContain(">Workspace<");
    expect(labels(markup)).toEqual(["Auto", "This computer", "Cloud computer"]);
    expect(markup).toMatch(/<p id="works-on-setting-hint"[^>]*>The bot picks where each task runs/);
    expect(markup).toMatch(/role="radiogroup"[^>]*class="[^"]*bg-control/);
    expect(markup).toMatch(/aria-checked="true"[^>]*data-works-on-choice="local"/);
    expect(markup).not.toMatch(/\bborder(-\[|-border|-hairline|-accent)/);
    expect(markup).not.toContain("underline");
    expect(markup).not.toContain("ui-button-primary");
  });
});
