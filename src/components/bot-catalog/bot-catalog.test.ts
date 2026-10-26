// Browse Bots: the catalogue's sections, search and actions (src/lib/bot-catalog.ts),
// the home pane, the detail pane and the modal's shell, drawn to markup.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), target: null as null | { section: "templates"; installUrl?: string } }));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: { ...original.initialState, botCatalogOpen: true, botCatalogTarget: fixture.target }, dispatch: fixture.dispatch }) };
});

import {
  catalogActions,
  catalogCategories,
  catalogSections,
  catalogTemplates,
  matchesCatalogQuery,
  templateApps,
  type BotCatalogEntry,
  type CommunityTemplate,
  type CatalogActionContext,
  type CatalogItem,
} from "@/lib/bot-catalog";
import { BOT_ROLES } from "@/lib/bot-roles";
import { orgSectionMenuItems } from "../OrgSectionMenu";
import { BotCatalogView, SECTION_PREVIEW, type BotCatalogViewProps } from "./BotCatalogView";
import { BotCatalogDetailView, templateDetail } from "./BotCatalogDetailView";
import { BotCatalogModal, teamImportedText } from "./BotCatalogModal";
import { CATEGORY_MODAL } from "../category-modal";
import type { OrgLibraryPackage } from "@/lib/org-library";

const ME = "pr_00000000-0000-4000-8000-00000000000a";
const BEN = "pr_00000000-0000-4000-8000-00000000000b";

function entry(id: string, extra: Partial<BotCatalogEntry> = {}): BotCatalogEntry {
  return {
    id, name: id, title: "", description: `${id} does things`, look: { color: "blue" }, owner: { principalId: ME, name: "Me" },
    source: "mine", archived: false, primary: false, ...extra,
  };
}

const ben = { principalId: BEN, name: "Ben Tremblay" };
const entries: BotCatalogEntry[] = [
  entry("Notes"),
  entry("Old", { archived: true }),
  entry("Closer", { owner: ben, source: "shared" }),
  entry("Pixel", { owner: ben, source: "organization", catalog: { published: true, category: "design", featured: true } }),
  entry("Ledger", { owner: ben, source: "organization", catalog: { published: true, category: "Field ops" } }),
  entry("Mine published", { catalog: { published: true, category: "sales" } }),
];
const templates = catalogTemplates([]);
const filter = { category: "all", query: "", showArchived: false };
const ids = (items: CatalogItem[]) => items.map((item) => item.kind === "bot" ? item.entry.id : item.template.id);

describe("catalogue sections", () => {
  it("are Featured, Shared with me, My Bots, Organization and Templates on an organization server", () => {
    const sections = catalogSections({ organization: true, entries }, templates, filter);
    expect(sections.map((section) => section.id)).toEqual(["featured", "shared", "mine", "organization", "templates"]);
    const by = Object.fromEntries(sections.map((section) => [section.id, ids(section.items)]));
    expect(by.featured).toEqual(["Pixel"]);
    expect(by.shared).toEqual(["Closer"]);
    expect(by.mine).toEqual(["Notes", "Mine published"]);
    expect(by.organization).toEqual(["Pixel", "Ledger", "Mine published"]);
    expect(by.templates).toEqual(BOT_ROLES.map((role) => `role:${role.id}`));
  });

  it("are My Bots and Templates only on a solo server", () => {
    const sections = catalogSections({ organization: false, entries: [entry("Notes")] }, templates, filter);
    expect(sections.map((section) => section.id)).toEqual(["mine", "templates"]);
  });

  it("show archived bots in My Bots only with the filter on", () => {
    const sections = catalogSections({ organization: true, entries }, templates, { ...filter, showArchived: true });
    expect(ids(sections.find((section) => section.id === "mine")!.items)).toEqual(["Notes", "Old", "Mine published"]);
  });

  it("filter by category chip, the publisher's own text included", () => {
    const design = catalogSections({ organization: true, entries }, templates, { ...filter, category: "design" });
    expect(design.flatMap((section) => ids(section.items))).toEqual(["Pixel", "Pixel"]);
    const custom = catalogSections({ organization: true, entries }, templates, { ...filter, category: "Field ops" });
    expect(custom.flatMap((section) => ids(section.items))).toEqual(["Ledger"]);
    const engineering = catalogSections({ organization: true, entries }, templates, { ...filter, category: "engineering" });
    expect(engineering.flatMap((section) => ids(section.items))).toEqual(["role:coder"]);
  });

  it("search by bot name or creator, case and accents ignored", () => {
    const byCreator = catalogSections({ organization: true, entries }, templates, { ...filter, query: "tremblay" });
    expect([...new Set(byCreator.flatMap((section) => ids(section.items)))]).toEqual(["Pixel", "Closer", "Ledger"]);
    const pixel: CatalogItem = { kind: "bot", key: "bot:Pixel", entry: entries[3]! };
    expect(matchesCatalogQuery(pixel, "PÌXEL")).toBe(true);
    expect(matchesCatalogQuery(pixel, "nobody")).toBe(false);
  });

  it("offer the default chips first, then the categories publishers typed", () => {
    const items = catalogSections({ organization: true, entries }, templates, filter).flatMap((section) => section.items);
    expect(catalogCategories(items)).toEqual(["all", "engineering", "sales", "marketing", "design", "personal", "people", "product", "operations", "Field ops"]);
  });
});

describe("catalogue actions", () => {
  const member: CatalogActionContext = { organization: true, admin: false, canCreate: true, inSidebar: (id) => id !== "Hidden" };
  const admin: CatalogActionContext = { ...member, admin: true };
  const bot = (value: BotCatalogEntry): CatalogItem => ({ kind: "bot", key: `bot:${value.id}`, entry: value });

  it("show or hide a shared bot in the sidebar first, then open and copy it", () => {
    expect(catalogActions(bot(entries[2]!), member)).toEqual(["removeFromSidebar", "open", "import"]);
    expect(catalogActions(bot(entry("Hidden", { source: "shared", owner: ben })), member)).toEqual(["addToSidebar", "open", "import"]);
  });

  it("import an organization bot or use a template, unless the viewer may not create bots", () => {
    expect(catalogActions(bot(entries[4]!), member)).toEqual(["import"]);
    expect(catalogActions({ kind: "template", key: "role:coder", template: templates[3]! }, member)).toEqual(["useTemplate"]);
    expect(catalogActions(bot(entries[4]!), { ...member, canCreate: false })).toEqual([]);
  });

  it("open and publish or withdraw one's own bot; only on an organization server", () => {
    expect(catalogActions(bot(entries[0]!), member)).toEqual(["open", "publish"]);
    expect(catalogActions(bot(entries[5]!), member)).toEqual(["open", "unpublish"]);
    expect(catalogActions(bot(entries[1]!), member)).toEqual([]);
    expect(catalogActions(bot(entries[0]!), { ...member, organization: false })).toEqual(["open"]);
  });

  it("let an admin feature and withdraw any published bot", () => {
    expect(catalogActions(bot(entries[4]!), admin)).toEqual(["import", "feature", "unpublish"]);
    expect(catalogActions(bot(entries[3]!), admin)).toEqual(["import", "unfeature", "unpublish"]);
    expect(catalogActions(bot(entries[5]!), admin)).toEqual(["open", "unpublish", "feature"]);
  });
});

function view(props: Partial<BotCatalogViewProps> = {}): string {
  const sections = props.sections ?? catalogSections({ organization: true, entries }, templates, filter);
  return renderToStaticMarkup(createElement(BotCatalogView, {
    organization: true,
    categories: catalogCategories(sections.flatMap((section) => section.items)),
    category: "all",
    onCategory: () => {},
    query: "",
    onQuery: () => {},
    sections,
    expanded: null,
    onExpand: () => {},
    showArchived: false,
    onShowArchived: () => {},
    hasArchived: true,
    creatorAvatar: () => undefined,
    onOpen: () => {},
    renderAction: (item) => createElement("button", { "data-test-action": item.key }, "Add"),
    ...props,
  }));
}

describe("the home pane", () => {
  it("shows the title, the chips, the search, the Featured row and one section per source", () => {
    const html = view();
    expect(html).toContain("Browse Bots");
    expect(html).toContain('placeholder="Search by creator or bot name"');
    for (const label of ["All", "Engineering", "Sales", "Recruiting &amp; People", "Operations", "Field ops"]) expect(html).toContain(`>${label}</button>`);
    expect(html).toContain('data-catalog-section="featured"');
    expect(html).toContain('data-catalog-featured="bot:Pixel"');
    for (const title of ["Featured", "Shared with me", "My Bots", "Organization", "Templates"]) expect(html).toContain(`>${title}</h3>`);
    expect(html).toContain("by Ben Tremblay");
    expect(html).toContain("Show archived");
    expect(html).toContain("data-catalog-creator-badge");
  });

  it("shows View all past the preview and every row in the expanded section", () => {
    const many = Array.from({ length: SECTION_PREVIEW + 2 }, (_, index) => entry(`Bot ${index}`));
    const sections = catalogSections({ organization: false, entries: many }, [], filter);
    const home = view({ organization: false, sections });
    expect(home).toContain('data-catalog-view-all="mine"');
    expect(home.match(/data-catalog-row="bot:/g)).toHaveLength(SECTION_PREVIEW);
    expect(home).not.toContain("Shared with me");
    const all = view({ organization: false, sections, expanded: "mine" });
    expect(all.match(/data-catalog-row="bot:/g)).toHaveLength(SECTION_PREVIEW + 2);
    expect(all).toContain("data-catalog-back");
  });

  it("opened alone keeps its title without a breadcrumb; inside Connect apps it shows Connect apps > Browse Bots (2026-10-16)", () => {
    const alone = view();
    expect(alone).not.toContain("data-breadcrumb");
    expect(alone).toMatch(/id="bot-catalog-title"[^>]*>Browse Bots</);
    const inside = view({ trail: [{ label: "Connect apps", onSelect: () => {} }] });
    expect(inside).toMatch(/data-breadcrumb[\s\S]*?aria-label="Back"[\s\S]*?>Connect apps<[\s\S]*?aria-current="page"[^>]*>Browse Bots</);
    expect(inside).toMatch(/id="bot-catalog-title"[^>]*>Browse Bots</);
    // View all inside: Connect apps > Browse Bots > the section
    const all = view({ trail: [{ label: "Connect apps", onSelect: () => {} }], expanded: "templates" });
    expect(all).toMatch(/>Connect apps<[\s\S]*?>Browse Bots<[\s\S]*?aria-current="page"[^>]*>Templates</);
  });

  it("says so when a search finds nothing", () => {
    const sections = catalogSections({ organization: true, entries }, templates, { ...filter, query: "zzz" });
    expect(view({ sections, query: "zzz" })).toContain("No bot matches this search.");
  });
});

describe("the detail pane", () => {
  const pixel: CatalogItem = { kind: "bot", key: "bot:Pixel", entry: entries[3]! };

  it("shows the bot, by whom, its actions and the instructions first, read only", () => {
    const html = renderToStaticMarkup(createElement(BotCatalogDetailView, {
      item: pixel,
      content: { soul: "You design screens.", memories: null, skills: [{ name: "mockup", description: "Draws a mockup" }], routines: [], integrations: [{ name: "figma-mcp", kind: "mcp" }] },
      tab: "soul",
      onTab: () => {},
      onBack: () => {},
      actions: createElement("button", { "data-test": "import" }, "Import Bot"),
    }));
    expect(html).toContain("By Ben Tremblay");
    expect(html).toContain("Pixel does things");
    expect(html).toContain("Import Bot");
    for (const tab of ["Instructions", "Memories", "Skills", "Routines", "Integrations"]) expect(html).toContain(`>${tab}</span>`);
    for (const hint of ["Facts it already knows", "Playbooks it can run", "Jobs that run on their own", "Apps it can use"]) expect(html).toContain(hint);
    expect(html).toContain("You design screens.");
    expect(html).toContain("Everything here is read only.");
    expect(html).not.toContain("<textarea");
  });

  it("draws the instructions as markdown, not as raw text", () => {
    const soul = "# Responsabilités\n\n- Répondre **vite**\n- Garder un ton *clair*\n\n1. Accuser réception\n\nAvec `une date`.";
    const html = renderToStaticMarkup(createElement(BotCatalogDetailView, {
      item: pixel, content: { soul, memories: null, skills: [], routines: [], integrations: [] }, tab: "soul", onTab: () => {}, onBack: () => {}, actions: null,
    }));
    const body = html.slice(html.indexOf("data-catalog-soul"));
    expect(body).toMatch(/role="heading" aria-level="1"[^>]*>Responsabilités/);
    expect(body).toContain("<li>");
    expect(body).toContain("<strong>vite</strong>");
    expect(body).toContain("<em>clair</em>");
    expect(body).toContain("<ol");
    expect(body).toContain("<code");
    expect(body).not.toContain("# Responsabilités");
    expect(body).not.toContain("**vite**");
    expect(body).not.toContain("whitespace-pre-wrap");
  });

  it("keeps each block of the page from shrinking over the next, and the rail scrolls on a phone", () => {
    const html = renderToStaticMarkup(createElement(BotCatalogDetailView, {
      item: pixel, content: { soul: "x", memories: null, skills: [], routines: [], integrations: [] }, tab: "soul", onTab: () => {}, onBack: () => {}, actions: null,
    }));
    const layout = html.match(/<div class="([^"]*)" data-catalog-tabs-layout/)?.[1] ?? "";
    expect(layout).toContain("shrink-0");
    expect(layout).toContain("sm:flex-row");
    expect(html.match(/<p class="([^"]*)" data-catalog-readonly/)?.[1]).toContain("shrink-0");
    const rail = html.match(/<div role="tablist"[^>]*class="([^"]*)"/)?.[1] ?? "";
    expect(rail).toContain("overflow-x-auto");
    expect(rail).toContain("sm:sticky");
    // the selected tab, the counts and no id
    expect(html).toMatch(/aria-selected="true"[^>]*data-catalog-tab="soul"/);
    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("shows a clean empty state on every tab", () => {
    const content = { soul: "  ", memories: [], skills: [], routines: [], integrations: [] };
    for (const tab of ["soul", "memories", "skills", "routines", "integrations"] as const) {
      const html = renderToStaticMarkup(createElement(BotCatalogDetailView, { item: pixel, content, tab, onTab: () => {}, onBack: () => {}, actions: null }));
      expect(html, tab).toContain("data-catalog-tab-empty");
      expect(html, tab).toContain("Everything here is read only.");
    }
  });

  it("explains hidden memories on a published bot, and lists integrations", () => {
    const content = { soul: "", memories: null, skills: [], routines: [], integrations: [{ name: "figma-mcp", kind: "mcp" as const }, { name: "browser", kind: "browser" as const }] };
    const memories = renderToStaticMarkup(createElement(BotCatalogDetailView, { item: pixel, content, tab: "memories", onTab: () => {}, onBack: () => {}, actions: null }));
    expect(memories).toContain("shown only to the people this bot is shared with");
    const integrations = renderToStaticMarkup(createElement(BotCatalogDetailView, { item: pixel, content, tab: "integrations", onTab: () => {}, onBack: () => {}, actions: null }));
    expect(integrations).toContain("figma-mcp");
    expect(integrations).toContain("MCP server");
    expect(integrations).toContain("Built-in browser");
  });

  it("shows a template's own instructions", () => {
    const coder = { kind: "template" as const, key: "role:coder", template: templates.find((template) => template.id === "role:coder")! };
    const html = renderToStaticMarkup(createElement(BotCatalogDetailView, { item: coder, content: templateDetail(coder), tab: "soul", onTab: () => {}, onBack: () => {}, actions: null }));
    expect(html).toContain("By Sagax");
    expect(html).toContain("careful engineer");
    expect(html).not.toContain("data-catalog-creator-badge");
  });
});

describe("the modal", () => {
  it("is a full-height dialog with its title, loading the catalogue", () => {
    const html = renderToStaticMarkup(createElement(BotCatalogModal));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-labelledby="bot-catalog-title"');
    expect(html).toContain("data-bot-catalog-modal");
    expect(html).toContain("Loading the catalog");
  });

  it("is not in the sidebar section menu", () => {
    expect(orgSectionMenuItems({ named: false, canMoveUp: false, canMoveDown: false, anyExpanded: true })).toEqual(["onCollapseAll"]);
  });
});

// The Templates library's content, now in Browse Bots > Templates.
const sales: CommunityTemplate = {
  slug: "sales-desk", name: "Sales desk", summary: "Qualifies leads and drafts outreach.", category: "Sales",
  outcome: "A pipeline that writes its own follow-ups", setupMinutes: 10, members: 3, skills: ["lead-scoring"], requires: { apps: ["HubSpot", "Gmail"] },
};
const field: CommunityTemplate = {
  slug: "field-ops", name: "Field ops", summary: "Schedules crews.", category: "Field service", members: 2, skills: [], requires: { apps: ["gmail", "Google Calendar"] },
};
function pkg(patch: Partial<OrgLibraryPackage> = {}): OrgLibraryPackage {
  return {
    packageId: "22222222-2222-4222-8222-222222222222", ref: "acme/support", name: "Support desk", tagline: "Answers tickets.", kind: "team",
    publisher: { organizationId: "o", name: "Acme Partners", self: false }, mode: "available",
    release: { version: "1.0.0", sha256: "a".repeat(64), sizeBytes: 10, formatVersion: 2, publishedAt: 0, notes: "" },
    contents: { bots: 2, skills: 1, presets: 0, rooms: 1, routines: 0, connections: 0, botNames: ["A", "B"] },
    scanFindings: 0, blob: "ready", installed: null, ...patch,
  };
}
const rich = catalogTemplates([], BOT_ROLES, { community: [sales, field], orgPackages: [pkg()] });
const template = (id: string): CatalogItem => ({ kind: "template", key: id, template: rich.find((entry) => entry.id === id)! });

describe("the Templates section (the old Templates library)", () => {
  it("lists the organization's packages, the community teams and the built-in roles, with descriptions and the apps they use", () => {
    expect(rich.map((entry) => entry.id)).toEqual([
      "package:22222222-2222-4222-8222-222222222222", "community:sales-desk", "community:field-ops", ...BOT_ROLES.map((role) => `role:${role.id}`),
    ]);
    const desk = rich[1]!;
    expect(desk).toMatchObject({ source: "community", description: "A pipeline that writes its own follow-ups", category: "sales", apps: ["HubSpot", "Gmail"], members: 3, creator: "Community" });
    expect(desk.notes).toEqual(["Bots: 3", "About 10 min to set up"]);
    expect(rich[2]!.category).toBe("Field service");
    expect(rich[0]).toMatchObject({ source: "organization", description: "Answers tickets.", creator: "Acme Partners", members: 2 });
    expect(rich[0]!.notes[0]).toBe("Bots: 2 · Skills: 1 · Group chats: 1");
  });

  it("filters templates by an app they use, case ignored, and searches descriptions and apps", () => {
    expect(templateApps(rich)).toEqual(["Gmail", "Google Calendar", "HubSpot"]);
    const byApp = catalogSections({ organization: false, entries: [] }, rich, { ...filter, app: "GMAIL" });
    expect(ids(byApp.find((section) => section.id === "templates")!.items)).toEqual(["community:sales-desk", "community:field-ops"]);
    const hub = catalogSections({ organization: false, entries: [] }, rich, { ...filter, app: "HubSpot" });
    expect(ids(hub.find((section) => section.id === "templates")!.items)).toEqual(["community:sales-desk"]);
    expect(matchesCatalogQuery(template("community:sales-desk"), "follow-ups")).toBe(true);
    expect(matchesCatalogQuery(template("community:field-ops"), "calendar")).toBe(true);
  });

  it("offers Use this template on every template that can be added, and nothing to a viewer who may not create bots", () => {
    const member: CatalogActionContext = { organization: true, admin: false, canCreate: true, inSidebar: () => true };
    expect(catalogActions(template("community:sales-desk"), member)).toEqual(["useTemplate"]);
    expect(catalogActions(template("role:coder"), member)).toEqual(["useTemplate"]);
    expect(catalogActions(template("package:22222222-2222-4222-8222-222222222222"), member)).toEqual(["useTemplate"]);
    const added = catalogTemplates([], [], { orgPackages: [pkg({ installed: { installId: "b".repeat(32), release: "1.0.0", status: "installed" } })] })[0]!;
    expect(catalogActions({ kind: "template", key: added.id, template: added }, member)).toEqual([]);
    expect(catalogActions(template("community:sales-desk"), { ...member, canCreate: false })).toEqual([]);
  });

  it("shows the apps on the rows, the tools and the app chips in its own view", () => {
    const sections = catalogSections({ organization: false, entries: [] }, rich, filter);
    const home = view({ organization: false, sections, onTemplateTool: () => {}, templateApps: templateApps(rich) });
    expect(home).toContain('data-catalog-app="HubSpot"');
    for (const tool of ["Import", "From a folder", "Share a team"]) expect(home).toContain(`>${tool}</button>`);
    expect(home).toContain('data-catalog-view-all="templates"');
    expect(home).not.toContain("data-catalog-app-chips");
    const own = view({ organization: false, sections, expanded: "templates", onTemplateTool: () => {}, templateApps: templateApps(rich), templateApp: "Gmail", repositoryUrl: "https://github.com/pulsatrixtechnologies/sagax" });
    expect(own).toContain("data-catalog-app-chips");
    expect(own).toMatch(/aria-pressed="true"[^>]*data-catalog-app-chip="Gmail"/);
    expect(own).toContain(">Any app</button>");
    expect(own).toContain("Community repo");
    expect(view({ organization: false, sections })).not.toContain("data-catalog-template-tools");
  });

  it("shows a template's apps and small print in its detail, and a team's preview in place of the tabs", () => {
    const desk = template("community:sales-desk") as Extract<CatalogItem, { kind: "template" }>;
    const html = renderToStaticMarkup(createElement(BotCatalogDetailView, {
      item: desk, content: templateDetail(desk), tab: "soul", onTab: () => {}, onBack: () => {}, actions: null,
      preview: createElement("p", { "data-test-preview": "" }, "3 bots join"),
    }));
    expect(html).toContain("A pipeline that writes its own follow-ups");
    expect(html).toContain('data-catalog-app="Gmail"');
    expect(html).toContain("About 10 min to set up");
    expect(html).toContain("3 bots join");
    expect(html).not.toContain('role="tablist"');
  });

  it("says what an import added", () => {
    expect(teamImportedText({ name: "Sales desk", members: 3, connections: 1 })).toBe("3 bots added · existing bots and chats kept · Connections to finish in Plugins → MCP servers: 1");
    expect(teamImportedText({ name: "Presets", members: 0, presets: 2 })).toBe("Preset bots added to New bot: 2");
  });
});

describe("the modal shell", () => {
  it("is the shared category modal shell, as Achievements and the persona editor", () => {
    fixture.target = null;
    const html = renderToStaticMarkup(createElement(BotCatalogModal));
    for (const classes of [CATEGORY_MODAL.backdrop, CATEGORY_MODAL.frame, CATEGORY_MODAL.content, CATEGORY_MODAL.close]) {
      expect(html).toContain(`class="${classes}"`);
    }
    expect(html).toContain(`class="${CATEGORY_MODAL.title}"`);
  });

  it("opens on its Templates section for the old library's entry points", () => {
    fixture.target = { section: "templates" };
    const html = renderToStaticMarkup(createElement(BotCatalogModal));
    expect(html).toMatch(/<h2 id="bot-catalog-title"[^>]*>Templates<\/h2>/);
    expect(html).toContain('data-catalog-section="templates"');
    expect(html).not.toContain('data-catalog-section="mine"');
    fixture.target = null;
  });
});
