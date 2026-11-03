// @vitest-environment happy-dom
// Browse Bots: the catalogue's sections, search and actions (src/lib/bot-catalog.ts),
// the home pane, the detail pane and the modal's shell, drawn to markup.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
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
  xaiErrorText,
  type BotCatalogEntry,
  type CommunityTemplate,
  type CatalogActionContext,
  type CatalogItem,
} from "@/lib/bot-catalog";
import { setLocale } from "@/lib/i18n";
import { BOT_ROLES } from "@/lib/bot-roles";
import { orgSectionMenuItems } from "../OrgSectionMenu";
import { BotCatalogView, SECTION_PREVIEW, type BotCatalogViewProps } from "./BotCatalogView";
import { BotCatalogDetailView, templateDetail } from "./BotCatalogDetailView";
import { BotCatalogModal, teamImportedText } from "./BotCatalogModal";
import { CATEGORY_MODAL } from "../category-modal";
import { closeBotCatalog } from "@/state/store";
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
    expect(sections.map((section) => section.id)).toEqual(["featured", "shared", "mine", "organization", "templates", "xai"]);
    const by = Object.fromEntries(sections.map((section) => [section.id, ids(section.items)]));
    expect(by.featured).toEqual(["Pixel"]);
    expect(by.shared).toEqual(["Closer"]);
    expect(by.mine).toEqual(["Notes", "Mine published"]);
    expect(by.organization).toEqual(["Pixel", "Ledger", "Mine published"]);
    expect(by.templates).toEqual(BOT_ROLES.map((role) => `role:${role.id}`));
  });

  it("are My Bots and Templates only on a solo server", () => {
    const sections = catalogSections({ organization: false, entries: [entry("Notes")] }, templates, filter);
    expect(sections.map((section) => section.id)).toEqual(["mine", "templates", "xai"]);
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

describe("the xAI Bot Marketplace source", () => {
  const xai = [{
    slug: "sample-desk", name: "Sample Desk", creator: "Alex Example", description: "Writes a weekly brief.",
    categories: ["Staff Picks", "Sales"], color: "violet", shape: "teardrop", shareId: "AbCdEfGhIjKlMnOpQrStU",
    url: "https://x.ai/bot/marketplace/bots/sample-desk",
  }];
  const withXai = catalogTemplates([], undefined, { xai });

  it("lists its bots in a section of their own, as templates with the page's look, creator and category", () => {
    const sections = catalogSections({ organization: false, entries: [] }, withXai, filter);
    expect(ids(sections.find((section) => section.id === "templates")!.items)).not.toContain("xai:sample-desk");
    const item = sections.find((section) => section.id === "xai")!.items[0]!;
    expect(item.kind === "template" && item.template).toMatchObject({
      source: "xai", name: "Sample Desk", creator: "Alex Example", category: "sales", description: "Writes a weekly brief.",
      look: { color: "violet", mascotLook: { character: "shape", shape: "drop" } },
    });
    expect(catalogActions(item, { organization: false, admin: false, canCreate: true, inSidebar: () => true })).toEqual(["useTemplate"]);
    expect(catalogSections({ organization: false, entries: [] }, withXai, { ...filter, query: "alex" }).find((section) => section.id === "xai")!.items).toHaveLength(1);
  });

  it("titles the section, offers Refresh and its page, and shows a clear line in place of an error", () => {
    const sections = catalogSections({ organization: false, entries: [] }, withXai, filter);
    const state = { loading: false, error: "", url: "https://x.ai/bot/marketplace", onRefresh: () => {}, onOpenSource: () => {} };
    const html = view({ sections, organization: false, xai: state });
    expect(html).toContain("xAI Bot Marketplace");
    expect(html).toContain('data-catalog-xai-refresh=""');
    expect(html).toContain('data-catalog-row="xai:sample-desk"');
    const failed = view({ sections: catalogSections({ organization: false, entries: [] }, templates, filter), organization: false, xai: { ...state, error: xaiErrorText("xai_format") } });
    expect(failed).toContain('data-catalog-xai-error=""');
    expect(failed).toContain("changed its page");
    expect(xaiErrorText(undefined)).toBe(xaiErrorText("xai_unreachable"));
    expect(xaiErrorText("anything else")).toContain("could not be reached");
  });
});

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

  it("opened alone keeps its title without a breadcrumb; inside Capabilities it shows Capabilities > Browse Bots (2026-10-16)", () => {
    const alone = view();
    expect(alone).not.toContain("data-breadcrumb");
    expect(alone).toMatch(/id="bot-catalog-title"[^>]*>Browse Bots</);
    const inside = view({ trail: [{ label: "Capabilities", onSelect: () => {} }] });
    expect(inside).toMatch(/data-breadcrumb[\s\S]*?aria-label="Back"[\s\S]*?>Capabilities<[\s\S]*?aria-current="page"[^>]*>Browse Bots</);
    expect(inside).toMatch(/id="bot-catalog-title"[^>]*>Browse Bots</);
    // View all inside: Capabilities > Browse Bots > the section
    const all = view({ trail: [{ label: "Capabilities", onSelect: () => {} }], expanded: "templates" });
    expect(all).toMatch(/>Capabilities<[\s\S]*?>Browse Bots<[\s\S]*?aria-current="page"[^>]*>Templates</);
  });

  it("inside Capabilities it is a page of Discover: a back row, no second big title, the search then the chips (2026-10-28)", () => {
    const inside = view({ trail: [{ label: "Discover", onSelect: () => {} }] });
    expect(inside).toContain("data-plugins-page-bar");
    expect(inside).not.toContain(`class="${CATEGORY_MODAL.title}"`);
    expect(inside).toMatch(/<h2 id="bot-catalog-title" class="sr-only">Browse Bots<\/h2>/);
    // the subtitle stays, as a line under the back row
    expect(inside).toContain("data-catalog-subtitle");
    // the search first, then the chips, as Capabilities' Discover
    expect(inside.indexOf("data-catalog-search")).toBeLessThan(inside.indexOf("data-catalog-chips"));
    expect(inside).toContain(`class="${CATEGORY_MODAL.chips}`);
    // opened alone: unchanged, the title, the chips, then the search
    const alone = view();
    expect(alone).toContain(`class="${CATEGORY_MODAL.title}"`);
    expect(alone.indexOf("data-catalog-chips")).toBeLessThan(alone.indexOf("data-catalog-search"));
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

  it("opened from Capabilities, the detail's breadcrumb goes back to Capabilities and to Browse Bots (2026-10-26)", () => {
    const onSelect = vi.fn();
    const html = renderToStaticMarkup(createElement(BotCatalogDetailView, {
      item: pixel, content: null, tab: "soul", onTab: () => {}, onBack: () => {}, actions: null,
      trail: [{ label: "Capabilities", onSelect }],
    }));
    expect(html).toMatch(/data-breadcrumb[\s\S]*?>Capabilities<[\s\S]*?>Browse Bots<[\s\S]*?aria-current="page"[^>]*>Pixel</);
    expect(html).toContain("data-catalog-back");
    const alone = renderToStaticMarkup(createElement(BotCatalogDetailView, { item: pixel, content: null, tab: "soul", onTab: () => {}, onBack: () => {}, actions: null }));
    expect(alone).not.toContain("data-breadcrumb");
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

  it("formats routine schedules in the person's language, never raw cron or UTC", () => {
    const content = {
      soul: "",
      memories: null,
      skills: [],
      routines: [
        { name: "Morning digest", schedule: { type: "cron" as const, expression: "30 8 * * 1-5", timeZone: "America/Toronto" }, enabled: true },
        { name: "On mail", schedule: { type: "event" as const, source: "email" as const }, enabled: false },
      ],
      integrations: [],
    };
    try {
      setLocale("fr-CA");
      const fr = renderToStaticMarkup(createElement(BotCatalogDetailView, { item: pixel, content, tab: "routines", onTab: () => {}, onBack: () => {}, actions: null }));
      expect(fr).toContain("Morning digest");
      expect(fr).toContain("Du lundi au vendredi à 8 h 30");
      expect(fr).toContain("America/Toronto");
      expect(fr).not.toMatch(/30 8 \* \* 1-5/);
      expect(fr).not.toMatch(/\bUTC\b/);
      expect(fr).toContain("On mail");
      expect(fr).toContain("Courriel entrant");
      setLocale("en");
      const en = renderToStaticMarkup(createElement(BotCatalogDetailView, { item: pixel, content, tab: "routines", onTab: () => {}, onBack: () => {}, actions: null }));
      expect(en).toContain("Every weekday at 08:30");
      expect(en).toContain("Incoming email");
    } finally {
      setLocale("en");
    }
  });

  it("shows a template's own instructions", () => {
    const coder = { kind: "template" as const, key: "role:coder", template: templates.find((template) => template.id === "role:coder")! };
    const html = renderToStaticMarkup(createElement(BotCatalogDetailView, { item: coder, content: templateDetail(coder), tab: "soul", onTab: () => {}, onBack: () => {}, actions: null }));
    expect(html).toContain("By Sagax");
    expect(html).toContain("careful engineer");
    expect(html).not.toContain("data-catalog-creator-badge");
  });
});

describe("the restored catalog window shell", () => {
  // 619b200c8 restores the catalogue as a centred window after UX lot 5.
  it("opens a labelled modal dialog with its title while loading the catalogue", () => {
    const html = renderToStaticMarkup(createElement(BotCatalogModal));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="bot-catalog-title"');
    expect(html).toMatch(/<h2 id="bot-catalog-title"[^>]*>Browse Bots<\/h2>/);
    expect(html).toContain('tabindex="-1"');
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
    expect(teamImportedText({ name: "Sales desk", members: 3, connections: 1 })).toBe("3 bots added · existing bots and chats kept · Connections to finish in Capabilities > Installed: 1");
    expect(teamImportedText({ name: "Presets", members: 0, presets: 2 })).toBe("Preset bots added to New bot: 2");
  });
});

describe("the catalog window shell layout", () => {
  it("uses the shared modal shell and keeps closing and keyboard focus scoped to it", async () => {
    fixture.target = null;
    fixture.dispatch.mockClear();
    const html = renderToStaticMarkup(createElement(BotCatalogModal));
    for (const classes of [CATEGORY_MODAL.backdrop, CATEGORY_MODAL.frame, CATEGORY_MODAL.close]) {
      expect(html).toContain(`class="${classes}"`);
    }
    expect(html).not.toContain("data-gallery-frame");
    const react = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousAct = react.IS_REACT_ACT_ENVIRONMENT;
    react.IS_REACT_ACT_ENVIRONMENT = true;
    // As in BotCatalogPane.back.test.ts, keep loading local and pending.
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(() => {}));
    const trigger = document.createElement("button");
    trigger.textContent = "Browse Bots";
    const host = document.createElement("div");
    document.body.append(trigger, host);
    trigger.focus();
    const root = createRoot(host);
    let mounted = true;
    try {
      await act(async () => root.render(createElement(BotCatalogModal)));
      const dialog = host.querySelector<HTMLElement>('[data-bot-catalog-modal][role="dialog"]')!;
      expect(dialog).not.toBeNull();
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      expect(dialog.querySelector(`#${dialog.getAttribute("aria-labelledby")}`)?.textContent).toBe("Browse Bots");
      const close = dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
      expect(close).not.toBeNull();
      expect(close.type).toBe("button");
      expect(dialog.contains(document.activeElement)).toBe(true);
      await act(async () => dialog.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
      expect(fixture.dispatch).not.toHaveBeenCalled();
      trigger.focus();
      await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
      expect(fixture.dispatch).not.toHaveBeenCalled();
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(node => node.checkVisibility());
      expect(focusable.length).toBeGreaterThan(1);
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      last.focus();
      await act(async () => last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
      expect(document.activeElement).toBe(first);
      await act(async () => first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
      expect(document.activeElement).toBe(last);
      for (const dismiss of [
        () => close.click(),
        () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })),
        () => dialog.parentElement!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })),
      ]) {
        fixture.dispatch.mockClear();
        await act(async () => { dismiss(); });
        expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith(closeBotCatalog());
      }
      await act(async () => root.unmount());
      mounted = false;
      expect(document.activeElement).toBe(trigger);
    } finally {
      if (mounted) await act(async () => root.unmount());
      host.remove();
      trigger.remove();
      fetch.mockRestore();
      react.IS_REACT_ACT_ENVIRONMENT = previousAct;
      fixture.dispatch.mockClear();
    }
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
