// @vitest-environment happy-dom
// Connect GitHub in Connect apps (#2109): the link plus a pairing code by
// default, the personal access token only under Advanced.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { MyConnections } from "@/lib/my-connections";
import { MyGithubConnection, PersonalServerForm } from "./MyConnectionsSettings";

const fixture = vi.hoisted(() => ({
  data: null as unknown,
  startGithubDevice: vi.fn(async () => ({})),
  connectGithubToken: vi.fn(async () => ({})),
}));
vi.mock("@/lib/my-connections", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/my-connections")>()),
  loadMyConnections: vi.fn(async () => fixture.data),
  startGithubDevice: fixture.startGithubDevice,
  connectGithubToken: fixture.connectGithubToken,
}));

const none: MyConnections = { github: { state: "none", deviceFlow: true }, servers: [], sandbox: true };

let host: HTMLDivElement;
let root: Root;
const render = (element: ReturnType<typeof createElement>) => flushSync(() => root.render(element));
const $ = <T extends Element = HTMLElement>(selector: string) => host.querySelector<T>(selector);

beforeEach(() => {
  vi.clearAllMocks();
  setLocale("en");
  fixture.data = none;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  setLocale("en");
});

describe("Connect GitHub (#2109)", () => {
  it("leads with Connect GitHub (link and code) and keeps the token under a closed Advanced", async () => {
    render(createElement(MyGithubConnection, { initial: none }));
    expect($("[data-github-connect]")!.getAttribute("data-github-connect")).toBe("device");
    expect(host.textContent).not.toContain("Use a token");
    const toggle = $<HTMLButtonElement>("[data-github-advanced-toggle]")!;
    expect(toggle.textContent).toContain("Advanced");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect($("input[type=password]")).toBeNull();
    fixture.data = { ...none, github: { state: "pending", userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresAt: Date.now() + 600_000, deviceFlow: true } };
    flushSync(() => $<HTMLButtonElement>("[data-github-connect]")!.click());
    expect(fixture.startGithubDevice).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect($("[data-github-code]")?.textContent).toContain("ABCD-1234"));
  });

  it("opens the token form from Advanced", () => {
    render(createElement(MyGithubConnection, { initial: none }));
    flushSync(() => $<HTMLButtonElement>("[data-github-advanced-toggle]")!.click());
    expect($("[data-github-advanced-toggle]")!.getAttribute("aria-expanded")).toBe("true");
    expect($("input[type=password]")).not.toBeNull();
  });

  // owner 2026-11-08: "every github connection should be done with a link and
  // the code to enter. and personnal token should be alternative solution if
  // needed but never presented first". With no OAuth App of the organization
  // nor SAGAX_GITHUB_CLIENT_ID, the built-in one runs the device flow.
  it("with no organization OAuth App, Connect GitHub still starts the link and code, and no default text names a token", async () => {
    const noApp: MyConnections = { ...none, github: { state: "none", deviceFlow: false } };
    fixture.data = noApp;
    render(createElement(MyGithubConnection, { initial: noApp }));
    expect($("[data-github-connect]")!.getAttribute("data-github-connect")).toBe("device");
    expect(host.textContent).not.toMatch(/personal access token|OAuth App/i);
    expect($("[data-github-no-device-flow]")).toBeNull();
    fixture.data = { ...none, github: { state: "pending", userCode: "WXYZ-5678", verificationUri: "https://github.com/login/device", expiresAt: Date.now() + 600_000, deviceFlow: true } };
    flushSync(() => $<HTMLButtonElement>("[data-github-connect]")!.click());
    expect(fixture.startGithubDevice).toHaveBeenCalledTimes(1);
    expect($("[data-github-advanced-toggle]")!.getAttribute("aria-expanded")).toBe("false");
    await vi.waitFor(() => expect($("[data-github-code]")?.textContent).toContain("WXYZ-5678"));
  });

  it("a device flow that fails says so with Try again, and the token stays the fallback under Advanced", async () => {
    fixture.startGithubDevice.mockRejectedValueOnce(new Error("GitHub sign-in by link and code is not available on this server right now."));
    render(createElement(MyGithubConnection, { initial: none }));
    flushSync(() => $<HTMLButtonElement>("[data-github-connect]")!.click());
    await vi.waitFor(() => expect($("[data-github-device-error]")?.textContent).toContain("not available"));
    expect($("[data-github-connect]")!.textContent).toBe("Try again");
    expect($("[data-github-fallback-hint]")).not.toBeNull();
    expect($("[data-github-advanced-toggle]")!.getAttribute("aria-expanded")).toBe("false");
    flushSync(() => $<HTMLButtonElement>("[data-github-connect]")!.click());
    expect(fixture.startGithubDevice).toHaveBeenCalledTimes(2);
  });

  it("an expired or refused code offers Try again", () => {
    const expired: MyConnections = { ...none, github: { state: "error", deviceFlow: true, error: "The code expired. Start again." } };
    render(createElement(MyGithubConnection, { initial: expired }));
    expect($("[data-github-auth-error]")!.textContent).toContain("expired");
    expect($("[data-github-connect]")!.textContent).toBe("Try again");
    expect($("[data-github-connect]")!.getAttribute("data-github-connect")).toBe("device");
  });

  it("the GitHub MCP preset uses the GitHub account, not a pasted token, even before it is connected", () => {
    render(createElement(PersonalServerForm, { data: none, onDone: async () => {}, onCancel: () => {} }));
    const preset = [...host.querySelectorAll<HTMLButtonElement>("[data-add-personal-server] button")].find((button) => /GitHub/.test(button.textContent ?? ""))!;
    flushSync(() => preset.click());
    const pill = $<HTMLButtonElement>("[data-add-personal-server] [data-pill-select]")!;
    expect(pill.textContent).toBe("My GitHub account");
    flushSync(() => pill.click());
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent?.includes("My GitHub account"))!;
    expect(option.getAttribute("aria-disabled")).toBeNull();
    expect($("[data-github-auth-hint]")).not.toBeNull();
    expect($("[data-add-personal-server] input[type=password]")).toBeNull();
  });
});
