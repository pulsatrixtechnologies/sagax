// @vitest-environment happy-dom
// #4154: a plugin's detail draws Accounts only when an account applies and
// Tools only when it has a tool (the owner: an empty section wastes space),
// and each section is one card: the account blocks sit in the section's card
// with no second border or padding of their own.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PluginItem } from "@/lib/plugins-model";
import type { McpServers } from "../McpServersPanel";
import type { McpServerListing, ProbeResult } from "../mcpServersModel";
import { detailProps } from "../PluginsPanel.tsx-parts/detailBuilders";
import type { DetailContext, MarketplaceListing } from "../PluginsPanel.tsx-parts/types";
import { GithubAccountSection } from "./GithubAccountSection";
import { PluginDetailView, type PluginDetailProps } from "./PluginDetailView";

vi.mock("@/state/store", () => ({ api: vi.fn(() => new Promise(() => {})), useStore: () => ({ state: {}, dispatch: vi.fn() }) }));

const noop = () => {};
const later = async () => {};
const MARKET = "example-market";
const plugin = (name: string): PluginItem => ({
  key: `plugin:${name}@${MARKET}`, kind: "plugin", id: `${name}@${MARKET}`, name, description: "",
  category: "productivity", installed: true, status: "connected", action: null, source: MARKET,
});
const child = (parent: PluginItem, kind: PluginItem["kind"], name: string, extra: Partial<PluginItem> = {}): PluginItem => ({
  key: `${kind}:${name}`, kind, id: name, name, description: "", category: "productivity", installed: true,
  status: "connected", action: null, source: MARKET, parent: parent.key, ...extra,
});
const neither = plugin("release-kit");
const toolsOnly = plugin("design-kit");
const both = plugin("issues-kit");
const github = plugin("github");
const usesGithub = plugin("repo-tools");
const items = [
  neither, toolsOnly, both, github, usesGithub,
  child(toolsOnly, "skill", "interface-review"),
  child(both, "mcp", "issues"),
  child(both, "skill", "triage"),
  child(github, "mcp", "github-github", { githubAccount: "missing", status: "needs_auth" }),
  child(usesGithub, "mcp", "repo-chores", { githubAccount: "missing", status: "needs_auth" }),
];
const marketplaces: MarketplaceListing[] = [{ name: MARKET, source: "example-org/example-market", plugins: [] }];

const servers: McpServerListing[] = [
  { name: "docs-search", type: "http", url: "https://docs.example.test/mcp", headerKeys: ["Authorization"], enabled: true, auth: "none" },
  { name: "tickets", type: "http", url: "https://tickets.example.test/mcp", headerKeys: [], enabled: true, auth: "required", authIssuer: "tickets.example.test" },
  { name: "local-notes", command: "notes-server", args: [], envKeys: [], enabled: true } as McpServerListing,
  { name: "open-api", type: "http", url: "https://open.example.test/mcp", headerKeys: [], enabled: true, auth: "none" },
];
const mcpItem = (name: string): PluginItem => ({
  key: `mcp:${name}`, kind: "mcp", id: name, name, description: "", category: "productivity",
  installed: true, status: "connected", action: null, source: "manual",
});
const mcp = (probe: Record<string, ProbeResult>, extra: Record<string, unknown> = {}) => ({
  servers, probe, busy: null, waiting: {}, oauthError: {}, clientDraft: {}, editing: null, error: null, notice: null,
  signIn: later, signOut: later, remove: later, test: later, toggle: later, setDisabledTools: later,
  startEdit: noop, startFixKeys: noop, setClientDraft: noop, forgetClientDraft: noop, ...extra,
}) as unknown as McpServers;
const context = (overrides: Partial<DetailContext> = {}): DetailContext => ({
  mcp: mcp({}), openGithub: noop, githubKey: github.key, githubSection: null, mcpAccountDraft: null, setMcpAccountDraft: noop,
  items, marketplaces, installing: null, openItem: noop, uninstallPlugin: noop, updatePlugin: noop,
  scope: "workspace", botCard: null, ...overrides,
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});
function render(props: Omit<PluginDetailProps, "onBack">): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(PluginDetailView, { ...props, onBack: noop })));
  return host;
}
const detail = (item: PluginItem, overrides: Partial<DetailContext> = {}) => render(detailProps(item, context(overrides)));
/** The section cards by their title (PluginCard: a heading, then its card). */
const titles = (page: HTMLElement) => [...page.querySelectorAll("section > div > h3")].map((heading) => heading.textContent);
const card = (page: HTMLElement, title: string) => {
  const heading = [...page.querySelectorAll("section > div > h3")].find((candidate) => candidate.textContent === title);
  return heading?.closest("section")?.lastElementChild as HTMLElement | undefined;
};
/** A box inside a card: an element with its own rounded border or fill. */
const BOX = /\brounded[\w-[\]]*\b/;
const FRAME = /(?:^|\s)(?:border(?:-\[[^\]]+\])?|border-hairline\S*|bg-inset|bg-raised\S*|bg-ink\/\[[^\]]+\])(?:\s|$)/;
const boxesIn = (element: HTMLElement) => [...element.querySelectorAll("div, section, form")]
  .filter((node) => BOX.test(node.getAttribute("class") ?? "") && FRAME.test(node.getAttribute("class") ?? ""));

describe("plugin detail sections (#4154)", () => {
  it("a plugin with neither an account nor a tool draws neither section, and still its Details under the head", () => {
    const page = detail(neither);
    expect(titles(page)).toEqual(["Details"]);
    expect(page.textContent).not.toContain("No account needed");
    expect(page.textContent).not.toMatch(/0 of 0/);
    expect(page.querySelector("[data-plugins-detail-head]")).not.toBeNull();
    expect(page.querySelector("[data-plugin-details]")?.textContent).toContain("release-kit@example-market");
  });

  it("only tools: Tools without Accounts; both: Accounts then Tools", () => {
    expect(titles(detail(toolsOnly))).toEqual(["Tools", "Details"]);
    act(() => root?.unmount());
    expect(titles(detail(both))).toEqual(["Accounts", "Tools", "Details"]);
  });

  it("only an account: a connector with keys that lists no tool draws Accounts, not Tools", () => {
    const page = detail(mcpItem("docs-search"), { mcp: mcp({ "docs-search": { ok: true, tools: [] } }) });
    expect(titles(page)).toEqual(["Accounts", "Details"]);
    expect(page.textContent).not.toMatch(/0 of 0/);
  });

  it("a connector with no sign-in and no key draws no Accounts; Tools comes back once it lists tools", () => {
    expect(titles(detail(mcpItem("local-notes")))).toEqual(["Tools", "Details"]);
    act(() => root?.unmount());
    expect(titles(detail(mcpItem("open-api"), { mcp: mcp({ "open-api": { ok: true, tools: [] } }) }))).toEqual(["Details"]);
    act(() => root?.unmount());
    expect(titles(detail(mcpItem("open-api"), { mcp: mcp({ "open-api": { ok: true, tools: [{ name: "search" }] } }) }))).toEqual(["Tools", "Details"]);
    // a refused key: an account (its keys) applies again
    act(() => root?.unmount());
    expect(titles(detail(mcpItem("open-api"), { mcp: mcp({ "open-api": { ok: false, reason: "keys", status: 401, error: "refused" } }) }))).toEqual(["Accounts", "Tools", "Details"]);
  });

  it("one card per section: the GitHub connection, the GitHub account line, a sign-in and its client form draw no box of their own", () => {
    const githubPage = detail(github, { githubSection: createElement(GithubAccountSection, { connection: createElement("div", null, "CONNECTION") }) });
    const githubCard = card(githubPage, "Accounts")!;
    expect(githubCard.querySelector("[data-accounts-github]")).not.toBeNull();
    expect(boxesIn(githubCard)).toEqual([]);
    expect(boxesIn(card(githubPage, "Tools")!)).toEqual([]);
    act(() => root?.unmount());

    const usesPage = detail(usesGithub);
    const usesCard = card(usesPage, "Accounts")!;
    expect(usesCard.querySelector("[data-plugin-github-account]")).not.toBeNull();
    expect(boxesIn(usesCard)).toEqual([]);
    act(() => root?.unmount());

    const signIn = detail(mcpItem("tickets"), { mcp: mcp({}, {
      waiting: { tickets: true },
      clientDraft: { tickets: { clientId: "", clientSecret: "", redirectUri: "http://127.0.0.1/callback" } },
    }) });
    const signInCard = card(signIn, "Accounts")!;
    expect(signInCard.querySelector("[data-mcp-client-form]")).not.toBeNull();
    expect(boxesIn(signInCard)).toEqual([]);
  });
});
