import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConnectorSetupView } from "../../../shared/connector-setup";
import { setLocale } from "@/lib/i18n";

const opened: string[] = [];
vi.mock("@/lib/app-links", () => ({ openExternalLink: vi.fn(async (url: string) => { opened.push(url); }) }));
vi.mock("@/state/store", () => ({ api: vi.fn(async () => ({})) }));

const { ConnectorSetupBody, openConnectorSetup } = await import("./ConnectorSetupCard");

const view = (over: Partial<ConnectorSetupView> = {}): ConnectorSetupView => ({
  id: "cs_0123456789abcdef01",
  connector: "microsoft-teams",
  label: "Microsoft Teams",
  provider: "grok",
  url: "https://grok.com/connectors",
  status: "waiting",
  owner: "0123456789abcdef",
  createdAt: 1,
  ...over,
});

const noop = () => {};
const render = (props: Partial<Parameters<typeof ConnectorSetupBody>[0]> = {}) =>
  renderToStaticMarkup(createElement(ConnectorSetupBody, { view: view(), checking: false, opened: false, onConnect: noop, onDone: noop, ...props }));
const visibleText = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

afterEach(() => {
  setLocale("en");
  opened.length = 0;
});

describe("Connect card", () => {
  it("one primary button named after the connector, and where the sign-in happens (fr)", () => {
    setLocale("fr");
    const html = render();
    const text = visibleText(html);
    expect(text).toContain("Connecter Microsoft Teams");
    expect(text).toContain("grok.com");
    expect(text).toContain("Sagax détectera la connexion");
    expect(html.match(/data-connector-setup-connect/g)).toHaveLength(1);
    // never the card id, the owner digest or a person id on screen
    expect(text).not.toContain("cs_");
    expect(text).not.toContain("0123456789abcdef");
  });

  it("Claude: claude.ai", () => {
    expect(visibleText(render({ view: view({ provider: "claude", url: "https://claude.ai/customize/connectors" }) }))).toContain("claude.ai");
  });

  it("after the button: I'm done checks; pending says so without claiming anything", () => {
    expect(render()).not.toContain("data-connector-setup-done");
    expect(render({ opened: true })).toContain("data-connector-setup-done");
    const pending = visibleText(render({ view: view({ status: "pending" }) }));
    expect(pending).toContain("Not confirmed yet");
    expect(pending).not.toMatch(/\bConnected\b/);
  });

  it("connected only from the card's status, folded into one line", () => {
    const text = visibleText(render({ view: view({ status: "connected" }) }));
    expect(text).toContain("Microsoft Teams");
    expect(text).toContain("Connected");
    expect(text).not.toContain("Connect Microsoft Teams");
  });

  it("desktop: the card's own channel, which main checks again; refused there, the app's link path", async () => {
    const openConnectorSetup2 = vi.fn(async () => true);
    vi.stubGlobal("window", { ogb: { openConnectorSetup: openConnectorSetup2 } });
    expect(await openConnectorSetup(view())).toBe(true);
    expect(openConnectorSetup2).toHaveBeenCalledWith("https://grok.com/connectors");
    expect(opened).toEqual([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("window", { ogb: { openConnectorSetup: vi.fn(async () => { throw new Error("not this window"); }) } });
    expect(await openConnectorSetup(view())).toBe(true);
    expect(opened).toEqual(["https://grok.com/connectors"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    vi.unstubAllGlobals();
  });

  it("the button opens the page through the app's own link path, only for grok.com or claude.ai", async () => {
    vi.stubGlobal("window", {});
    expect(await openConnectorSetup(view())).toBe(true);
    expect(opened).toEqual(["https://grok.com/connectors"]);
    expect(await openConnectorSetup(view({ url: "https://evil.example/connectors" }))).toBe(false);
    expect(opened).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});
