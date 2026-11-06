import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { resetOrgMemoryForTests, type OrgMemoryBridge, type OrgMemoryState } from "@/lib/org-memory";

vi.mock("@/lib/perspicax-org", () => ({ usePerspicaxOrg: () => null }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: {}, dispatch: vi.fn() }),
}));
import { OrgMemoryPanel, OrgMemorySettings } from "./OrgMemorySettings";

const state = (over: Partial<OrgMemoryState> = {}): OrgMemoryState => ({
  connected: true,
  server: "https://px.example.com",
  mode: "auto",
  vault: "/Users/example/Library/Application Support/sagax/org-memory/vault",
  cloned: true,
  obsidianConfigured: false,
  obsidianUrl: "obsidian://open?path=%2Fvault",
  cloudFolder: null,
  busy: false,
  tiers: [
    { name: "me", label: "Moi", push: "direct", status: "pushed", messages: [] },
    { name: "org", label: "Organisation", push: "review", status: "refused", messages: ["notes.txt is not a memory path"] },
  ],
  pending: [
    { id: "01k9", tier: "org", title: "Onboarding", state: "pending", path: "org/_pending/01k9.md", edit_of: "01k8" },
    { id: "01ka", tier: "team-01m2s7h970xc76btmekfvvh5r4", title: "Hourly new tickets", state: "approved" },
    { id: "01kb", tier: "org", title: "Dispatch journal", state: "refused", reason: "not the right place" },
  ],
  pendingCount: 1,
  lastSyncAt: 1_760_000_000_000,
  lastError: null,
  autoError: null,
  ...over,
});

const bridge = (): OrgMemoryBridge => ({
  state: vi.fn(async () => state()),
  auto: vi.fn(async () => state()),
  sync: vi.fn(async () => state()),
  erase: vi.fn(async () => state({ connected: false, cloned: false, tiers: [], pending: [], pendingCount: 0 })),
  writeObsidianConfig: vi.fn(async () => state({ obsidianConfigured: true })),
  openInObsidian: vi.fn(async () => ({ ok: true as const })),
  showFolder: vi.fn(async () => true),
});

const render = (initial: OrgMemoryState, orgName: string | null = "Acme", initialOpenProblem: "not_installed" | "add_vault" | "failed" | null = null) =>
  renderToStaticMarkup(createElement(OrgMemoryPanel, { bridge: bridge(), orgName, initial, initialOpenProblem }));

describe("Settings > Memory", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => {
    vi.unstubAllGlobals();
    resetOrgMemoryForTests();
  });

  it("asks for nothing: no address, no token, no Connect", () => {
    for (const initial of [state(), state({ connected: false, cloned: false, mode: null, tiers: [], pending: [], pendingCount: 0, lastSyncAt: null })]) {
      const html = render(initial);
      expect(html).not.toContain("<input");
      expect(html).not.toContain("<form");
      expect(html).not.toContain("pxat1");
      expect(html).not.toContain("Perspicax address");
      expect(html).not.toContain("Memory sync token");
      expect(html).not.toContain("Connect");
    }
  });

  it("shows one row: pending count in grey, Open, and a menu for the rest", () => {
    const html = render(state());
    expect(html).toContain("Organization memory");
    expect(html).toContain("1 pending");
    expect(html).toContain(">Open<");
    expect(html).toContain("More memory actions");
    expect(html).not.toContain("Try again");
    expect(html).not.toContain("Erase");
    // Obsidian and Show folder stay behind the menu until opened
    expect(html).not.toContain("Open in Obsidian");
  });

  it("never lists the memory: no proposal title, reason, state history or team id", () => {
    const html = render(state());
    for (const hidden of ["Onboarding", "Hourly new tickets", "Dispatch journal", "not the right place", "team-01m2s7h970xc76btmekfvvh5r4", "Approved", "notes.txt is not a memory path", "(org"]) {
      expect(html).not.toContain(hidden);
    }
    expect(html).not.toContain("<li");
  });

  it("says why Obsidian did not open", () => {
    const missing = render(state(), "Acme", "not_installed");
    expect(missing).toContain("Obsidian is not installed");
    const chooser = render(state(), "Acme", "add_vault");
    expect(chooser).toContain("Open folder as vault");
    expect(missing).not.toContain("Vault not found");
  });

  it("says it is setting up before the first sync", () => {
    const html = render(state({ connected: false, cloned: false, mode: null, tiers: [], pending: [], pendingCount: 0, lastSyncAt: null }));
    expect(html).toContain("Setting up the memory sync");
    expect(html).not.toContain("Open in Obsidian");
  });

  it("states a failure in one clear line; Retry stays in the menu", () => {
    const html = render(state({ autoError: "unreachable", pendingCount: 0 }));
    expect(html).toContain("could not be reached");
    expect(html).toContain(">Open<");
    expect(html).not.toContain("Try again");
    const gone = render(state({ connected: false, cloned: false, autoError: "not_member", tiers: [], pending: [], pendingCount: 0 }));
    expect(gone).toContain("no longer in this organization");
    expect(gone).not.toContain("<input");
    const older = render(state({ connected: false, cloned: false, autoError: "unsupported", tiers: [], pending: [], pendingCount: 0 }));
    expect(older).toContain("1.8.27");
    expect(older).not.toContain("<input");
  });

  it("speaks French", () => {
    setLocale("fr");
    expect(render(state())).toContain("Mémoire de l&#x27;organisation");
    expect(render(state())).toContain("Ouvrir");
    expect(render(state({ autoError: "unreachable", pendingCount: 0 }))).toContain("injoignable");
  });

  it("warns when the vault sits in a cloud folder", () => {
    const html = render(state({ connected: false, cloudFolder: "iCloud Drive", autoError: "cloud_folder" }));
    expect(html).toContain("iCloud Drive");
  });

  it("says the cache is the desktop app's outside it", () => {
    vi.stubGlobal("window", {});
    const html = renderToStaticMarkup(createElement(OrgMemorySettings));
    expect(html).toContain("desktop app");
  });
});
