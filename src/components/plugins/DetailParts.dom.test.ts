// @vitest-environment happy-dom
// The pieces every detail page shares (#4453): one name in the header and a
// back link that says where the person came from; "New" only when known; the
// panel says "Can send data to other services" only when it is true; Contents
// is a file tree (folders fold) and the selected file read from what the
// server lists; a README is formatted text with a Rendered | Source switch.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";

const api = vi.fn();
vi.mock("@/state/store", () => ({ api: (...args: unknown[]) => api(...args), useStore: () => ({ state: {}, dispatch: vi.fn() }) }));

const parts = await import("./DetailParts");
const { PluginPageHeader } = await import("./PluginParts");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { setLocale("en"); api.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async (node: unknown) => { await act(async () => { root.render(node as never); }); await act(async () => { await Promise.resolve(); }); return host; };
const click = async (element: Element | null) => { expect(element).not.toBeNull(); await act(async () => { (element as HTMLElement).click(); }); await act(async () => { await Promise.resolve(); }); };

describe("the tree", () => {
  const files = [{ path: "skills/review/SKILL.md" }, { path: "README.md" }, { path: "agents/critic.md" }, { path: "skills/review/notes.md" }];
  it("puts folders first, then files by name, and nests by path", () => {
    const tree = parts.buildTree(files);
    expect(tree.map((node) => `${node.dir ? "dir" : "file"}:${node.name}`)).toEqual(["dir:agents", "dir:skills", "file:README.md"]);
    expect(tree[1]!.children[0]!.children.map((node) => node.name)).toEqual(["notes.md", "SKILL.md"]);
  });
  it("reads a README first, else a SKILL.md, else the shallowest file", () => {
    expect(parts.firstFile(files)).toBe("README.md");
    expect(parts.firstFile([{ path: "a/b/c.md" }, { path: "SKILL.md" }])).toBe("SKILL.md");
    expect(parts.firstFile([{ path: "a/b/c.md" }, { path: "d.md" }])).toBe("d.md");
    expect(parts.firstFile([])).toBeNull();
  });
});

describe("a SKILL.md read rendered", () => {
  it("leaves its front matter to the Source view", () => {
    expect(parts.withoutFrontMatter("---\nname: x\ndescription: y\n---\n\nBody text\n")).toBe("Body text\n");
    expect(parts.withoutFrontMatter("# Title\n\n---\nnot front matter")).toBe("# Title\n\n---\nnot front matter");
  });
});

describe("the header and its back link", () => {
  it("names the view the person came from and draws no second title", async () => {
    const view = await render(createElement(PluginPageHeader, { title: "Harbor Suite", named: true, onBack: vi.fn(), trail: [{ label: "Skills", onSelect: vi.fn() }] }));
    expect(view.querySelector("[data-plugins-back-label]")?.textContent).toBe("Skills");
    expect(view.querySelector("[data-plugins-page-title]")).toBeNull();
    expect(view.querySelector("[data-plugins-back]")?.getAttribute("aria-label")).toBe("Back to Skills");
  });
  it("a page with no name of its own keeps its centred title", async () => {
    const view = await render(createElement(PluginPageHeader, { title: "GitHub", onBack: vi.fn() }));
    expect(view.querySelector("[data-plugins-page-title]")?.textContent).toBe("GitHub");
  });
  it("shows the name once, the grey line, and the New badge only when it is known", async () => {
    const make = (isNew?: boolean) => createElement(parts.DetailHeader, { icon: createElement("i"), name: "Code Review", line: "from source · 1.0.0 · 2 skills", isNew, actions: createElement("button", { type: "button" }, "Update") });
    const view = await render(make());
    expect(view.querySelectorAll("[data-plugins-detail-name]")).toHaveLength(1);
    expect(view.querySelector("[data-plugins-detail-meta]")?.textContent).toBe("from source · 1.0.0 · 2 skills");
    expect(view.querySelector("[data-detail-new]")).toBeNull();
    await render(make(true));
    expect(view.querySelector("[data-detail-new]")?.textContent).toBe("New");
  });
  it("builds the source line from what is known only", () => {
    expect(parts.sourceLine(["from a", undefined, "1.0", false, "2 skills"])).toBe("from a · 1.0 · 2 skills");
  });
});

describe("the Overview", () => {
  const rows = [{ key: "a", name: "Notes", icon: createElement("i") }];
  it("says the item can send data to other services only when that is known to be true", async () => {
    const yes = await render(createElement(parts.ReachPanel, { network: true, rows }));
    expect(yes.querySelector("[data-detail-network]")?.textContent).toContain("Can send data to other services");
    await render(createElement(parts.ReachPanel, { network: false, rows }));
    expect(host.querySelector("[data-detail-network]")).toBeNull();
    expect(host.textContent).toContain("Notes");
  });
  it("lists every category as a chip and leaves the block out when there is none", async () => {
    const view = await render(createElement(parts.OverviewColumns, { description: "Full text", categories: ["development", "security"] }));
    expect([...view.querySelectorAll("[data-detail-categories] li")].map((node) => node.textContent)).toEqual(["development", "security"]);
    expect(view.querySelector("[data-detail-description] p")?.textContent).toBe("Full text");
    await render(createElement(parts.OverviewColumns, { description: "Only text" }));
    expect(host.querySelector("[data-detail-categories]")).toBeNull();
  });
});

describe("Contents", () => {
  const listed = { files: [{ path: "README.md", bytes: 40, kind: "text" }, { path: "scripts/run.sh", bytes: 20, kind: "text" }, { path: "logo.png", bytes: 9, kind: "image" }] };
  const texts: Record<string, string> = { "README.md": "# Title\n\nHello **world**", "scripts/run.sh": "echo hi\n" };
  beforeEach(() => {
    api.mockImplementation(async (url: string) => {
      const path = new URL(url, "http://x").searchParams.get("path");
      return path ? { path, kind: "text", text: texts[path] ?? "" } : listed;
    });
  });
  const explorer = () => createElement(parts.FileExplorer, { listUrl: "/api/me/plugins/kit%40market/files", pill: createElement(parts.VersionPill, { name: "kit", version: "1.0.0", current: true }) });

  it("opens on the README, rendered, and the Source switch shows its text", async () => {
    const view = await render(explorer());
    expect(api).toHaveBeenCalledWith("/api/me/plugins/kit%40market/files");
    expect(view.querySelector("[data-contents-pill]")?.textContent).toBe("kit 1.0.0·current");
    expect(view.querySelector("[data-file-rendered]")?.textContent).toContain("Hello world");
    await click(view.querySelector('[data-file-switch] [role="radio"]:last-child'));
    expect(view.querySelector("[data-file-rendered]")).toBeNull();
    expect(view.querySelector("[data-file-source]")?.textContent).toContain("# Title");
  });

  it("folds folders, reads a code file as a styled block, and says a binary file cannot be shown", async () => {
    const view = await render(explorer());
    expect(view.querySelector('[data-file-row="scripts/run.sh"]')).toBeNull();
    await click(view.querySelector('[data-file-row="scripts"]'));
    await click(view.querySelector('[data-file-row="scripts/run.sh"]'));
    expect(api).toHaveBeenCalledWith("/api/me/plugins/kit%40market/files?path=scripts%2Frun.sh");
    expect(view.querySelector("[data-file-source]")?.textContent).toContain("echo hi");
    expect(view.querySelector("[data-file-switch]")).toBeNull();
    await click(view.querySelector('[data-file-row="logo.png"]'));
    expect(view.querySelector('[data-file-note="binary"]')).not.toBeNull();
    expect(api).not.toHaveBeenCalledWith(expect.stringContaining("logo.png"));
  });

  it("offers the download only when the app can export the item", async () => {
    const view = await render(explorer());
    expect(view.querySelector("[data-contents-download]")).toBeNull();
    const onDownload = vi.fn();
    await render(createElement(parts.FileExplorer, { listUrl: "/x/files", onDownload }));
    await click(host.querySelector("[data-contents-download]"));
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it("adds the files the list leaves out (a skill's SKILL.md) and says so when the server fails", async () => {
    api.mockImplementation(async (url: string) => (url.includes("path=") ? { kind: "text", text: "---\nname: x\n---" } : { files: [{ path: "notes/a.md", kind: "text" }] }));
    const view = await render(createElement(parts.FileExplorer, { listUrl: "/s/files", extra: [{ path: "SKILL.md", kind: "text" }] }));
    expect(view.querySelector('[data-file-row="SKILL.md"]')).not.toBeNull();
    api.mockRejectedValue(new Error("boom"));
    await render(createElement(parts.FileExplorer, { listUrl: "/other/files" }));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe("the Connectors rows", () => {
  it("say the state in words and offer the action that fixes it; a connector whose state is not known says none", async () => {
    const open = vi.fn();
    const view = await render(createElement(parts.ConnectorRows, { connectors: [
      { key: "a", name: "Tickets", item: { kind: "mcp", name: "Tickets" }, word: "needsSignIn", onOpen: open },
      { key: "b", name: "Notes", item: { kind: "mcp", name: "Notes" }, word: "connected", onOpen: open },
      { key: "c", name: "Search", item: { kind: "mcp", name: "Search" }, word: "notAdded", onOpen: open },
      { key: "d", name: "Declared", item: { kind: "mcp", name: "Declared" } },
    ] }));
    const text = (word: string) => view.querySelector(`[data-detail-connector="${word}"]`)?.textContent ?? "";
    expect(text("needsSignIn")).toContain("Needs sign-in");
    expect(text("needsSignIn")).toContain("Sign in");
    expect(text("connected")).toContain("Connected");
    expect(view.querySelector('[data-detail-connector="connected"] [data-detail-connector-fix]')).toBeNull();
    expect(text("notAdded")).toContain("Not added");
    expect(text("notAdded")).toContain("Add");
    expect(text("unknown")).toContain("Declared");
    expect(view.querySelector('[data-detail-connector="unknown"] button')).toBeNull();
  });
});

describe("pages built on these pieces", () => {
  it("a bundle has a Skills tab only when the console offers skills that go with the vendor", async () => {
    const { VendorPage } = await import("./VendorPage");
    const { groupByVendor } = await import("@/lib/capability-kinds");
    const { parsePersonProduct } = await import("../../../shared/person-products");
    const suite = { id: "harbor", name: "Harbor Suite" };
    const products = [parsePersonProduct({ id: "desk", name: "Service Desk", state: "connected", group: suite })!];
    const vendor = groupByVendor(products)[0]!;
    const ctx = { bots: [{ id: "bot-a", name: "Rocket" }], setProducts: vi.fn(), onOpen: vi.fn() };
    const view = await render(createElement(VendorPage, { vendor, ctx, onBack: vi.fn(), consoleName: "Perspicax · Example Org" }));
    expect([...view.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute("data-vendor-tab"))).toEqual(["overview", "connectors"]);
    expect(view.querySelector("[data-plugins-detail-meta]")?.textContent).toContain("from Perspicax");
    await render(createElement(VendorPage, { vendor, ctx, onBack: vi.fn(), skills: [{ name: "desk-macros", description: "Canned replies" }] }));
    expect([...host.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute("data-vendor-tab"))).toEqual(["overview", "skills", "connectors"]);
    await click(host.querySelector('[data-vendor-tab="skills"]'));
    expect(host.querySelector("[data-plugin-detail-panel='skills']")?.textContent).toContain("/desk-macros");
  });

  it("an organization skill is a vendor's only when the console names the vendor", async () => {
    const { vendorSkillsOf } = await import("./OrgCapabilitiesSection");
    const item = (id: string, vendor?: string) => ({ id, mount: id, form: "skill" as const, name: id, description: `${id} line`, mode: "offered" as const, enabled: true, state: "installed" as const, on: true, canToggle: true, ...(vendor ? { vendor } : {}) });
    const state = { items: [item("macros", "harbor"), item("recap"), item("other", "beacon")] } as never;
    expect(vendorSkillsOf(state, "vendor:harbor")).toEqual([{ name: "macros", description: "macros line" }]);
    expect(vendorSkillsOf(state, "vendor:none")).toEqual([]);
  });

  it("a connector's page has Overview and Tools · N (its endpoints), the vendor icon when it has none of its own", async () => {
    const { ProductDetailView } = await import("./ProductDetailView");
    const { parsePersonProduct } = await import("../../../shared/person-products");
    const product = parsePersonProduct({ id: "desk", name: "Service Desk", state: "connected", endpoints: ["Tickets", "Time"], group: { id: "harbor", name: "Harbor Suite", icon: { url: "https://cdn.example.test/h.svg" } } })!;
    const view = await render(createElement(ProductDetailView, { product, onChanged: vi.fn(), onBack: vi.fn() }));
    expect(view.querySelector("[data-remote-image]")?.getAttribute("src")).toBe("https://cdn.example.test/h.svg");
    expect(view.querySelector("[data-plugins-detail-meta]")?.textContent).toBe("from Harbor Suite · 2 tools");
    expect([...view.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute("data-product-tab"))).toEqual(["overview", "tools"]);
    await click(view.querySelector('[data-product-tab="tools"]'));
    expect([...view.querySelectorAll("[data-plugin-detail-panel='tools'] li")].map((li) => li.textContent)).toEqual(["Tickets", "Time"]);
  });

  it("Discover lists a bundle the person has not turned on as a card that opens it", async () => {
    const { DiscoverView } = await import("./DiscoverView");
    const onOpen = vi.fn();
    const item = { key: "vendor:vendor:harbor", kind: "plugin" as const, id: "vendor:harbor", name: "Harbor Suite", description: "Service desk", category: "other" as const, installed: false, status: "available" as const, action: "add" as const, source: "console" };
    const props = { items: [], filter: "all" as const, onFilter: vi.fn(), type: "any" as const, onType: vi.fn(), sourceLabel: (s: string) => s, onOpenItem: vi.fn(), renderAction: () => null, kind: "plugins" as const, bundleCards: [{ item, from: "2 connectors · 0 on", title: "From Perspicax", onOpen, action: createElement("button", { type: "button", "data-test-go": "" }, "See") }] };
    const view = await render(createElement(DiscoverView, props));
    const card = view.querySelector('[data-plugins-section="bundles"] [data-discover-card]');
    expect(card?.textContent).toContain("Harbor Suite");
    await click(card!.querySelector("button"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(view.querySelector("[data-test-go]")).not.toBeNull();
    await render(createElement(DiscoverView, { ...props, kind: "skills" as const }));
    expect(host.querySelector('[data-plugins-section="bundles"]')).toBeNull();
  });
});

describe("a skill's page (#4504)", () => {
  const skill = { name: "weekly-summary", description: "Friday recap", source: "local-import", enabled: true, tags: [], version: "a1b2c3d", importedAt: "", warnings: [], assignedBots: [] };
  beforeEach(() => {
    api.mockImplementation(async (url: string) => {
      if (url.includes("/files")) return url.includes("path=") ? { kind: "text", text: "---\nname: weekly-summary\n---" } : { files: [{ path: "notes/format.md", kind: "text" }] };
      return { text: "---\nname: weekly-summary\ndescription: Friday recap\n---\n\nWrite the recap.\n" };
    });
  });
  const page = async (extra: Record<string, unknown> = {}) => {
    const { SkillPage } = await import("./SkillPage");
    const { ConfirmProvider } = await import("../ConfirmProvider");
    return render(createElement(ConfirmProvider, null, createElement(SkillPage, { skill, basePath: "/api/me/skills-library", onBack: vi.fn(), onSaved: vi.fn(), onDeleted: vi.fn(), sourceLabel: "Added by you", ...extra })));
  };

  it("has one name, the source and version on one grey line, Overview and Contents tabs", async () => {
    const view = await page();
    expect(view.querySelectorAll("[data-plugins-detail-name]")).toHaveLength(1);
    expect(view.querySelector("[data-plugins-detail-meta]")?.textContent).toBe("Added by you · a1b2c3d");
    expect([...view.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute("data-skill-tab"))).toEqual(["overview", "contents"]);
    expect(view.querySelector("[data-skill-savebar]")).not.toBeNull();
  });

  it("Contents lists its folder through the person's own skill route, SKILL.md first, and the save bar leaves", async () => {
    const view = await page();
    await click(view.querySelector('[data-skill-tab="contents"]'));
    expect(api).toHaveBeenCalledWith("/api/me/skills-library/weekly-summary/files");
    expect(view.querySelector('[data-file-row="SKILL.md"]')).not.toBeNull();
    expect(view.querySelector('[data-file-row="notes"]')).not.toBeNull();
    expect(view.querySelector("[data-contents-download]")).not.toBeNull();
    expect(view.querySelector("[data-skill-savebar]")).toBeNull();
  });

  it("an update waiting: Update in the header, its versions and notes in Details", async () => {
    const onUpdate = vi.fn();
    const view = await page({ update: { from: "a1b2c3d", to: "e4f5a6b", notes: "Adds a Friday section", running: false, onUpdate } });
    await click(view.querySelector('[data-plugin-action="update"]'));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    const details = view.querySelector("[data-plugin-details-block]")!.textContent!;
    expect(details).toContain("a1b2c3d → e4f5a6b");
    expect(details).toContain("Adds a Friday section");
  });
});

describe("the plugin page is tight and has no orphan disclosure (coordinator's review of after-v8)", () => {
  const item = { key: "plugin:kit@market", kind: "plugin" as const, id: "kit@market", name: "kit", description: "", category: "other" as const, installed: true, status: "connected" as const, action: null, source: "market" };
  const page = async (props: Record<string, unknown> = {}) => {
    const { PluginDetailView } = await import("./PluginDetailView");
    return render(createElement(PluginDetailView, { item, displayName: "Kit", subtitle: "from market \u00b7 1.0.0 \u00b7 2 skills", busy: false, onBack: vi.fn(), details: [{ label: "Source", value: "market" }, { label: "Identifier", value: "kit@market", mono: true }, { label: "Repository", value: "acme/kit" }], ...props }));
  };
  it("the grey line is what is known, never the raw id; the id is in Details, in monospace, alone", async () => {
    const view = await page();
    expect(view.querySelector("[data-plugins-detail-meta]")?.textContent).toBe("from market \u00b7 1.0.0 \u00b7 2 skills");
    const mono = [...view.querySelectorAll("[data-plugin-details] dd")].filter((node) => node.className.includes("font-mono")).map((node) => node.textContent);
    expect(mono).toEqual(["kit@market"]);
    // the id of a page whose name people read is a row of Details too
    expect(view.querySelector("[data-plugin-details]")?.textContent).toContain("kit@market");
  });
  it("shows what the page holds as labelled sections, never a lone disclosure row, and Details is not behind anything", async () => {
    const view = await page({ more: createElement("section", { "data-test-more": "" }, "More content"), installState: [{ id: "everyone", label: "Installed for everyone", on: true }] });
    expect(view.querySelector("details")).toBeNull();
    expect(view.querySelector("[data-test-more]")).not.toBeNull();
    expect(view.querySelector("[data-plugin-install-section]")?.textContent).toContain("Where it is installed");
    expect(view.querySelector("[data-plugin-details-block]")).not.toBeNull();
  });
  it("Details is a compact list of pairs in two columns, label and value together", async () => {
    const view = await page();
    const list = view.querySelector("[data-plugin-details]")!;
    expect(list.className).toContain("md:grid-cols-2");
    expect(list.querySelector("dd")?.className).not.toContain("text-right");
  });
  it("the back bar is a short line and the content starts right under it", async () => {
    const view = await page();
    expect(view.querySelector("[data-plugins-page-bar]")?.className).toContain("h-10");
    expect(view.querySelector("[data-plugins-detail]")?.className).toMatch(/\bpt-1\b/);
    expect(view.querySelector("[data-plugins-detail]")?.className).not.toMatch(/\bpt-6\b/);
  });
  it("an update waiting is the button; the \"...\" carries no dot", async () => {
    const view = await page({ onUpdate: vi.fn() });
    expect(view.querySelector('[data-plugin-action="update"]')).not.toBeNull();
    expect(view.querySelector("[data-plugin-update-dot]")).toBeNull();
  });
  it("a connector with no mark of its own is the one neutral tile, never the same generic glyph", async () => {
    const { PluginIcon } = await import("./PluginParts");
    const view = await render(createElement("div", null, createElement(PluginIcon, { item: { kind: "mcp", name: "review-notes" } }), createElement(PluginIcon, { item: { kind: "mcp", name: "ticket-search" } })));
    expect([...view.querySelectorAll("[data-letter-tile]")].map((tile) => tile.textContent)).toEqual(["R", "T"]);
  });
});
