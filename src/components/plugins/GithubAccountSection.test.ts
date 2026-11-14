// @vitest-environment happy-dom
// the GitHub plugin's page in Connect apps (2026-10-28): the one GitHub
// connection, and one list of other credentials beside it. A member changes
// their own with no admin, sees the organization's marked and read only; an
// admin may add one for the whole organization. No token is ever on the
// page: a label and a hint. A proxy's bare 502 is never shown.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setGithubCredentialsForTest, type GithubCredentialsView } from "@/lib/github-credentials";
import { setLocale } from "@/lib/i18n";
import { GithubAccountSection } from "./GithubAccountSection";
import { MyGithubConnection, MyGithubSummary } from "../settings/MyConnectionsSettings";

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(async () => { throw new Error("no server in this test"); }),
}));

afterEach(() => {
  setGithubCredentialsForTest(null);
  setLocale("en");
  document.body.innerHTML = "";
});

const view = (canManageOrg: boolean): GithubCredentialsView => ({
  canManageOrg,
  deviceFlow: false,
  credentials: [
    { id: "gt_0000000000000001", label: "Other organization", hint: "1111", owner: "mine", chosenBy: 0 },
    { id: "gt_0000000000000002", label: "example-org/team-market (Rocket)", hint: "2222", owner: "mine", onlyWhereChosen: true, chosenBy: 1 },
    { id: "gt_0000000000000003", label: "Repository group", hint: "saved", owner: "org", chosenBy: 2 },
  ],
});

describe("the GitHub plugin's page", () => {
  // #2109: Connect GitHub (link plus code) leads; the tokens wait under Advanced.
  it("shows the connection first and keeps the other tokens under a closed Advanced", () => {
    setGithubCredentialsForTest(view(false));
    const html = renderToStaticMarkup(createElement(GithubAccountSection, { connection: createElement("div", { "data-test-connection": "" }) }));
    expect(html).toMatch(/data-accounts-github[\s\S]*data-github-connection[\s\S]*data-test-connection[\s\S]*data-github-credentials-advanced/);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Advanced: tokens for other organizations or hosts");
    expect(html).not.toContain("More credentials");
  });

  // #4155: a list the server cannot open is said once, Advanced opens on it, and Add is the way back.
  it("a saved list the server cannot open says so under an open Advanced, with Add", () => {
    setGithubCredentialsForTest({ canManageOrg: false, deviceFlow: false, credentials: [], unreadable: "sealed" });
    const html = renderToStaticMarkup(createElement(GithubAccountSection, { connection: createElement("div") }));
    expect(html).toContain('aria-expanded="true"');
    expect(html.match(/data-github-credentials-sealed/g)).toHaveLength(1);
    expect(html).toContain("Your saved GitHub tokens can&#x27;t be opened on this server anymore. Add them again with Add a credential.");
    expect(html).toContain("data-github-credential-add-open");
    expect(html).not.toContain("data-github-credentials-empty");
  });

  it("shows one list with the organization's marked, and no token", () => {
    setGithubCredentialsForTest(view(false));
    const html = renderToStaticMarkup(createElement(GithubAccountSection, {}));
    expect(html).toContain('aria-expanded="true"');
    expect(html).toMatch(/data-accounts-github[\s\S]*data-github-credentials/);
    expect(html).toContain("private marketplaces, gh and git in your bots, and the GitHub plugin");
    expect(html).toContain("More credentials");
    expect(html).toContain('data-github-credential-owner="org"');
    expect(html).toContain("Organization");
    expect(html).toContain("Marketplace only");
    expect(html).toContain("Marketplaces that pick it: 2");
    expect(html).toContain("•••• 1111");
    expect(html).not.toContain('type="password"');
  });

  it("a member changes their own, not the organization's", () => {
    setGithubCredentialsForTest(view(false));
    const host = document.createElement("div");
    document.body.append(host);
    flushSync(() => createRoot(host).render(createElement(GithubAccountSection, {})));
    const mine = host.querySelector('[data-github-credential="gt_0000000000000001"]')!;
    expect(mine.textContent).toContain("Rename");
    expect(mine.textContent).toContain("Replace");
    expect(mine.textContent).toContain("Remove");
    const org = host.querySelector('[data-github-credential="gt_0000000000000003"]')!;
    expect(org.textContent).not.toContain("Rename");
    expect(org.querySelector("button")).toBeNull();
    // Add: the member's own list, no organization choice
    flushSync(() => (host.querySelector("[data-github-credential-add-open]") as HTMLElement).click());
    expect(host.querySelector("[data-github-credential-add]")).not.toBeNull();
    expect(host.querySelector("[data-github-credential-scope]")).toBeNull();
    expect(host.querySelector('[data-github-credential-add] input[type="password"]')).not.toBeNull();
  });

  it("an admin changes the organization's and may add one for everyone", () => {
    setGithubCredentialsForTest(view(true));
    const host = document.createElement("div");
    document.body.append(host);
    flushSync(() => createRoot(host).render(createElement(GithubAccountSection, {})));
    expect(host.querySelector('[data-github-credential="gt_0000000000000003"]')!.textContent).toContain("Rename");
    flushSync(() => (host.querySelector("[data-github-credential-add-open]") as HTMLElement).click());
    expect(host.querySelector('[data-github-credential-scope="mine"]')).not.toBeNull();
    expect(host.textContent).toContain("The whole organization");
  });

  it("one Connect GitHub for everyone: always the link and the code, never an admin step", () => {
    const initial = { github: { state: "none" as const, deviceFlow: false }, servers: [], sandbox: true };
    const member = renderToStaticMarkup(createElement(MyGithubConnection, { initial }));
    expect(member).toMatch(/<button[^>]*data-github-connect="device"/);
    expect(member).not.toMatch(/<button[^>]*data-github-connect="device"[^>]*disabled/);
    expect(member).not.toMatch(/personal access token|OAuth App/i);
    expect(member).not.toMatch(/admin/i);
    expect(member).not.toContain("Use a token");
    const withApp = renderToStaticMarkup(createElement(MyGithubConnection, { initial: { ...initial, github: { state: "none" as const, deviceFlow: true } } }));
    expect(withApp).toContain('data-github-connect="device"');
    expect(withApp).not.toContain("Use a token");
    expect(withApp).toContain(">Advanced<");
    expect(withApp).not.toMatch(/personal access token/i);
    expect(withApp).not.toMatch(/admin/i);
  });

  it("with no OAuth App reported, Connect GitHub still starts the link and the code, not the token form", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const initial = { github: { state: "none" as const, deviceFlow: false }, servers: [], sandbox: true };
    flushSync(() => createRoot(host).render(createElement(MyGithubConnection, { initial })));
    expect(host.querySelector("[data-github-connect]")!.getAttribute("data-github-connect")).toBe("device");
    expect(host.querySelector('input[type="password"]')).toBeNull();
  });

  it("the card's account line: connected as, or not connected", () => {
    const none = renderToStaticMarkup(createElement(MyGithubSummary, { initial: { github: { state: "none" as const, deviceFlow: false }, servers: [], sandbox: true } }));
    expect(none).toBe("GitHub is not connected.");
    const connected = renderToStaticMarkup(createElement(MyGithubSummary, { initial: { github: { state: "connected" as const, deviceFlow: false, login: "octo", via: "token" as const, connectedAt: 1 }, servers: [], sandbox: true } }));
    expect(connected).toBe("Connected as @octo");
    const refused = renderToStaticMarkup(createElement(MyGithubSummary, { initial: { github: { state: "error" as const, deviceFlow: false, error: "GitHub refused this token. Connect again.", login: "octo" }, servers: [], sandbox: true } }));
    expect(refused).toBe("Reconnect GitHub (@octo)");
    expect(refused).not.toContain("Connected as");
  });

  it("says it in French", () => {
    setLocale("fr");
    setGithubCredentialsForTest(view(false));
    const html = renderToStaticMarkup(createElement(GithubAccountSection, {}));
    expect(html).toContain("Identifiants supplémentaires");
    expect(html).toContain("Organisation");
  });

  it("a proxy's bare 502 while the server restarts is asked again, never shown", async () => {
    const { api } = await import("@/state/store");
    const mocked = vi.mocked(api);
    let calls = 0;
    mocked.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error("502 Bad Gateway"), { status: 502 });
      return { github: { state: "connected", deviceFlow: true, login: "octo", via: "device", connectedAt: 1 }, servers: [], sandbox: true };
    });
    vi.useFakeTimers();
    try {
      const host = document.createElement("div");
      document.body.append(host);
      flushSync(() => createRoot(host).render(createElement(MyGithubConnection, {})));
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.runOnlyPendingTimersAsync();
      expect(host.textContent).not.toMatch(/502|Bad Gateway/);
      expect(host.textContent).toContain("Connected as @octo");
    } finally {
      vi.useRealTimers();
      mocked.mockImplementation(async () => { throw new Error("no server in this test"); });
    }
  });

  it("a failure that stays is one plain line, never the status", async () => {
    const { api } = await import("@/state/store");
    const mocked = vi.mocked(api);
    mocked.mockImplementation(async () => { throw Object.assign(new Error("502 Bad Gateway"), { status: 502 }); });
    vi.useFakeTimers();
    try {
      const host = document.createElement("div");
      document.body.append(host);
      flushSync(() => createRoot(host).render(createElement(MyGithubConnection, {})));
      await vi.advanceTimersByTimeAsync(20_000);
      await vi.runOnlyPendingTimersAsync();
      expect(host.textContent).not.toMatch(/502|Bad Gateway/);
      expect(host.textContent).toContain("Something went wrong on the other end. Try again.");
    } finally {
      vi.useRealTimers();
      mocked.mockImplementation(async () => { throw new Error("no server in this test"); });
    }
  });
});
