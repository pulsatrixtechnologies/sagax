import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  org: { id: "org-1", name: "Demo", viewerRole: "member" as const },
  api: vi.fn(),
}));

vi.mock("@/lib/perspicax-org", () => ({
  usePerspicaxOrg: () => fixture.org,
}));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: fixture.api,
}));

describe("PhoneCallsCard (#2080)", () => {
  beforeEach(() => {
    fixture.org = { id: "org-1", name: "Demo", viewerRole: "member" };
    fixture.api.mockReset();
    fixture.api.mockResolvedValue({ settings: { enabled: true, callbackNumber: "+15145550100", doNotCall: [] } });
  });

  it("draws the same read-only card for a member (no admin form)", async () => {
    const { PhoneCallsCard } = await import("./PhoneCallsCard");
    const html = renderToStaticMarkup(createElement(PhoneCallsCard));
    expect(html).toContain('data-settings-card="voice.phoneCalls"');
    expect(html).toContain('data-settings-row="phoneCalls"');
    expect(html).not.toContain("data-org-calls-enabled");
    expect(html).not.toContain('data-settings-row="phoneCallsCallback"');
  });

  it("names the card once and keeps the state on the row's grey line", async () => {
    const { PhoneCallsCard } = await import("./PhoneCallsCard");
    const html = renderToStaticMarkup(createElement(PhoneCallsCard));
    expect(html.split("Phone calls (pilot)").length - 1).toBe(1);
    expect(html).toContain("Allow phone calls");
    expect(html).toContain("Set by your organization.");
    expect(html).not.toContain("On · callback");
  });

  it("never shows a callback number row nor its warning: calls no longer say one (#4193)", async () => {
    const { PhoneCallsCard } = await import("./PhoneCallsCard");
    const html = renderToStaticMarkup(createElement(PhoneCallsCard));
    expect(html).not.toContain("Callback number");
    expect(html).not.toContain("No callback number yet");
    expect(html).not.toContain('data-settings-row="phoneCalls.callback"');
    expect(html).toContain('data-settings-keywords="Do not call"');
  });

  it("draws nothing outside an organization", async () => {
    fixture.org = null as never;
    const { PhoneCallsCard } = await import("./PhoneCallsCard");
    expect(renderToStaticMarkup(createElement(PhoneCallsCard))).toBe("");
  });
});
