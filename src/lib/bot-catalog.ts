// Browse Bots (src/components/bot-catalog/): the catalogue's model. The
// server lists the viewer's bots, the ones shared with them and the ones
// published to the organisation (GET /api/bot-catalog); the templates are
// what the old Templates library and New bot offered: the organization
// library's packages (GET /api/org-library), New bot's presets (an admin
// read), the community team templates (GET /api/team-library/catalog), the
// built-in roles, and the xAI Bot Marketplace's bots (GET
// /api/team-library/xai, its own section). Pure helpers, for tests.
import type { LocaleKey } from "@/locales";
import { t } from "@/lib/i18n";
import { BOT_ROLES, type BotRole } from "@/lib/bot-roles";
import type { BotPreset } from "@/lib/bot-presets";
import { orgCardAction, orgCardNotes, orgContentsLine, orgModeBadge, type OrgLibraryPackage } from "@/lib/org-library";
import {
  DEFAULT_BOT_CATALOG_CATEGORIES,
  isDefaultCatalogCategory,
  type BotCatalogEntry,
  type BotCatalogLook,
  type BotCatalogResponse,
} from "../../shared/bot-catalog";
import { MASCOT_COLOR_NAMES, type MascotColorName } from "../../shared/mascot-colors";
import {
  XAI_MARKETPLACE_LABEL,
  xaiMarketplaceCategory,
  xaiMarketplaceLook,
  type XaiMarketplaceEntry,
  type XaiMarketplaceErrorCode,
} from "../../shared/xai-marketplace";

export type { BotCatalogDetail, BotCatalogEntry, BotCatalogResponse } from "../../shared/bot-catalog";

/** A community team template (GET /api/team-library/catalog, one entry;
 * server/team/team-library.ts TeamCatalogEntry). */
export interface CommunityTemplate {
  slug: string;
  name: string;
  summary: string;
  category: string;
  outcome?: string;
  setupMinutes?: number;
  featured?: boolean;
  members: number;
  skills: string[];
  requires: { apps: string[] };
}

/** GET /api/team-library/catalog (only what the catalogue reads). */
export interface CommunityCatalog {
  repositoryUrl: string;
  teams: CommunityTemplate[];
}

/** Where a template comes from. */
export type CatalogTemplateSource = "organization" | "preset" | "community" | "role" | "xai";

/** A template: an organization package, a preset of New bot, a community
 * team or a built-in role. */
export interface CatalogTemplate {
  /** `package:<id>`, `preset:<id>`, `community:<slug>`, `role:<id>` or `xai:<slug>` */
  id: string;
  source: CatalogTemplateSource;
  name: string;
  title: string;
  description: string;
  look: BotCatalogLook;
  /** Built-in: Sagax; a preset: its publisher or package. */
  creator: string;
  category: string | null;
  soul: string;
  skills: Array<{ name: string; description: string }>;
  /** The apps it uses (a community team's requirements), as chips. */
  apps: string[];
  /** A team: how many bots it adds. */
  members?: number;
  /** The small print: contents, a recommendation, a withdrawal, a newer release. */
  notes: string[];
  role?: BotRole;
  preset?: BotPreset;
  community?: CommunityTemplate;
  orgPackage?: OrgLibraryPackage;
  /** A bot of the xAI Bot Marketplace: its detail reads the bot's page. */
  xai?: XaiMarketplaceEntry;
}

export type CatalogItem =
  | { kind: "bot"; key: string; entry: BotCatalogEntry }
  | { kind: "template"; key: string; template: CatalogTemplate };

export type CatalogSectionId = "featured" | "shared" | "mine" | "organization" | "templates" | "xai";

export interface CatalogSection {
  id: CatalogSectionId;
  items: CatalogItem[];
}

/** The built-in roles fall under the default categories. */
const ROLE_CATEGORY: Record<string, string> = {
  assistant: "personal",
  inbox: "operations",
  research: "product",
  coder: "engineering",
  community: "marketing",
  ops: "operations",
  subscriptions: "personal",
};

function roleColor(index: number): MascotColorName {
  const palette: MascotColorName[] = ["blue", "purple", "teal", "orange", "pink", "green"].filter((name): name is MascotColorName =>
    (MASCOT_COLOR_NAMES as readonly string[]).includes(name));
  return palette[index % palette.length] ?? MASCOT_COLOR_NAMES[0];
}

/** A community category ("Engineering", "sales") as a default chip when it
 * is one, else its own text. */
function communityCategory(category: string): string | null {
  const text = category.trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  return isDefaultCatalogCategory(lower) ? lower : text;
}

/** What the catalogue adds besides the presets and the built-in roles. */
export interface CatalogTemplateSources {
  community?: readonly CommunityTemplate[];
  orgPackages?: readonly OrgLibraryPackage[];
  /** The xAI Bot Marketplace's list (GET /api/team-library/xai). */
  xai?: readonly XaiMarketplaceEntry[];
}

/** The organization's packages, New bot's presets (organisation and
 * imported; an admin read), the community teams, then the built-in roles. */
export function catalogTemplates(presets: readonly BotPreset[], roles: readonly BotRole[] = BOT_ROLES, sources: CatalogTemplateSources = {}): CatalogTemplate[] {
  const fromPackages = (sources.orgPackages ?? []).map((entry, index): CatalogTemplate => ({
    id: `package:${entry.packageId}`,
    source: "organization",
    name: entry.name,
    title: "",
    description: entry.tagline,
    look: { color: roleColor(index + 2) },
    creator: entry.publisher.name,
    category: null,
    soul: "",
    skills: [],
    apps: [],
    members: entry.contents.bots,
    notes: [orgContentsLine(entry.contents), orgModeBadge(entry) ?? "", ...orgCardNotes(entry)].filter(Boolean),
    orgPackage: entry,
  }));
  const fromCommunity = (sources.community ?? []).map((entry, index): CatalogTemplate => ({
    id: `community:${entry.slug}`,
    source: "community",
    name: entry.name,
    title: entry.category,
    description: entry.outcome ?? entry.summary,
    look: { color: roleColor(index + 1) },
    creator: t("botCatalog.creator.community"),
    category: communityCategory(entry.category),
    soul: entry.summary,
    skills: entry.skills.map((name) => ({ name, description: "" })),
    apps: [...entry.requires.apps],
    members: entry.members,
    notes: [
      t("botCatalog.template.members", { count: entry.members }),
      ...(entry.setupMinutes ? [t("botCatalog.template.setup", { minutes: entry.setupMinutes })] : []),
    ],
    community: entry,
  }));
  const fromPresets = presets.map((preset): CatalogTemplate => ({
    id: `preset:${preset.id}`,
    source: "preset",
    name: preset.bot.name ?? preset.name,
    title: preset.bot.title ?? "",
    description: preset.bot.description ?? preset.description ?? "",
    look: {
      color: preset.bot.appearance?.color ?? roleColor(0),
      ...(preset.bot.appearance?.mascotExpression ? { mascotExpression: preset.bot.appearance.mascotExpression } : {}),
    },
    creator: preset.publisherName ?? preset.packageName,
    category: null,
    soul: preset.bot.soul ?? "",
    skills: preset.skills,
    apps: [],
    notes: [],
    preset,
  }));
  const builtIn = roles.map((role, index): CatalogTemplate => ({
    id: `role:${role.id}`,
    source: "role",
    name: role.name,
    title: role.title,
    description: role.description,
    look: { color: roleColor(index) },
    creator: t("botCatalog.creator.builtIn"),
    category: ROLE_CATEGORY[role.id] ?? null,
    soul: role.soul,
    skills: [],
    apps: [],
    notes: [],
    role,
  }));
  const fromXai = (sources.xai ?? []).map((entry): CatalogTemplate => ({
    id: `xai:${entry.slug}`,
    source: "xai",
    name: entry.name,
    title: "",
    description: entry.description,
    look: xaiMarketplaceLook(entry),
    creator: entry.creator || XAI_MARKETPLACE_LABEL,
    category: xaiMarketplaceCategory(entry.categories),
    soul: "",
    skills: [],
    apps: [],
    notes: [t("botCatalog.xai.note")],
    xai: entry,
  }));
  return [...fromPackages, ...fromPresets, ...fromCommunity, ...builtIn, ...fromXai];
}

/** The line shown when the xAI Bot Marketplace cannot be read (the server's
 * code; anything else reads as out of reach), never the raw error. */
export function xaiErrorText(code: unknown): string {
  const known: Record<XaiMarketplaceErrorCode, LocaleKey> = {
    xai_unreachable: "botCatalog.xai.error.unreachable",
    xai_format: "botCatalog.xai.error.format",
    xai_not_found: "botCatalog.xai.error.notFound",
    xai_blocked: "botCatalog.xai.error.blocked",
  };
  return t(typeof code === "string" && code in known ? known[code as XaiMarketplaceErrorCode] : "botCatalog.xai.error.unreachable");
}

/** The apps the templates use, for the Templates section's app chips. */
export function templateApps(templates: readonly CatalogTemplate[]): string[] {
  const apps = new Map<string, string>();
  for (const template of templates) for (const app of template.apps) {
    const key = app.toLowerCase();
    if (!apps.has(key)) apps.set(key, app);
  }
  return [...apps.values()].sort((a, b) => a.localeCompare(b));
}

/** Whether a template uses this app (case ignored). */
export function templateUsesApp(template: CatalogTemplate, app: string): boolean {
  const needle = app.toLowerCase();
  return template.apps.some((candidate) => candidate.toLowerCase() === needle);
}

const CATEGORY_KEY: Record<string, LocaleKey> = {
  engineering: "botCatalog.category.engineering",
  sales: "botCatalog.category.sales",
  marketing: "botCatalog.category.marketing",
  design: "botCatalog.category.design",
  personal: "botCatalog.category.personal",
  people: "botCatalog.category.people",
  product: "botCatalog.category.product",
  operations: "botCatalog.category.operations",
};

/** A chip's label: All, a default category translated, or the publisher's text. */
export function catalogCategoryLabel(category: string): string {
  if (category === "all") return t("botCatalog.category.all");
  return isDefaultCatalogCategory(category) ? t(CATEGORY_KEY[category]!) : category;
}

export function itemCategory(item: CatalogItem): string | null {
  return item.kind === "bot" ? item.entry.catalog?.category ?? null : item.template.category;
}

export function itemName(item: CatalogItem): string {
  return item.kind === "bot" ? item.entry.name : item.template.name;
}

export function itemCreator(item: CatalogItem): string {
  return item.kind === "bot" ? item.entry.owner.name : item.template.creator;
}

export function itemDescription(item: CatalogItem): string {
  const value = item.kind === "bot" ? item.entry.description || item.entry.title : item.template.description || item.template.title;
  return value.trim();
}

/** The chips: All, the default categories, then the ones publishers typed. */
export function catalogCategories(items: readonly CatalogItem[]): string[] {
  const custom = new Set<string>();
  for (const item of items) {
    const category = itemCategory(item);
    if (category && !isDefaultCatalogCategory(category)) custom.add(category);
  }
  return ["all", ...DEFAULT_BOT_CATALOG_CATEGORIES, ...[...custom].sort((a, b) => a.localeCompare(b))];
}

/** Search by bot name, role or creator (a template also by its
 * description, skills and apps, as the Templates library searched); case
 * and accents ignored. */
export function matchesCatalogQuery(item: CatalogItem, query: string): boolean {
  const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const needle = fold(query.trim());
  if (!needle) return true;
  const title = item.kind === "bot" ? item.entry.title : item.template.title;
  const extra = item.kind === "template"
    ? ` ${item.template.description} ${item.template.skills.map((skill) => skill.name).join(" ")} ${item.template.apps.join(" ")}`
    : "";
  return fold(`${itemName(item)} ${title} ${itemCreator(item)}${extra}`).includes(needle);
}

export interface CatalogFilter {
  category: string;
  query: string;
  showArchived: boolean;
  /** The Templates section's app chip: only templates that use this app. */
  app?: string | null;
}

/** The sections of the home view, in order: Featured, Shared with me, My
 * Bots, Organization, Templates. A solo server has no shared or
 * organisation section (and the server lists only the person's own bots). */
export function catalogSections(data: Pick<BotCatalogResponse, "organization" | "entries">, templates: readonly CatalogTemplate[], filter: CatalogFilter): CatalogSection[] {
  const keep = (item: CatalogItem) =>
    (filter.category === "all" || itemCategory(item) === filter.category) && matchesCatalogQuery(item, filter.query);
  const bot = (entry: BotCatalogEntry): CatalogItem => ({ kind: "bot", key: `bot:${entry.id}`, entry });
  const published = (entry: BotCatalogEntry) => entry.catalog?.published === true && !entry.archived;
  const sections: CatalogSection[] = [];
  if (data.organization) {
    sections.push({ id: "featured", items: data.entries.filter((entry) => published(entry) && entry.catalog?.featured).map(bot).filter(keep) });
    sections.push({ id: "shared", items: data.entries.filter((entry) => entry.source === "shared").map(bot).filter(keep) });
  }
  sections.push({ id: "mine", items: data.entries.filter((entry) => entry.source === "mine" && (filter.showArchived || !entry.archived)).map(bot).filter(keep) });
  if (data.organization) sections.push({ id: "organization", items: data.entries.filter(published).map(bot).filter(keep) });
  sections.push({
    id: "templates",
    items: templates
      .filter((template) => template.source !== "xai" && (!filter.app || templateUsesApp(template, filter.app)))
      .map((template): CatalogItem => ({ kind: "template", key: template.id, template }))
      .filter(keep),
  });
  sections.push({
    id: "xai",
    items: templates
      .filter((template) => template.source === "xai")
      .map((template): CatalogItem => ({ kind: "template", key: template.id, template }))
      .filter(keep),
  });
  return sections;
}

export const SECTION_LABEL: Record<CatalogSectionId, LocaleKey> = {
  featured: "botCatalog.section.featured",
  shared: "botCatalog.section.shared",
  mine: "botCatalog.section.mine",
  organization: "botCatalog.section.organization",
  templates: "botCatalog.section.templates",
  xai: "botCatalog.section.xai",
};

export type CatalogAction =
  | "open"
  | "addToSidebar"
  | "removeFromSidebar"
  | "import"
  | "useTemplate"
  | "publish"
  | "unpublish"
  | "feature"
  | "unfeature";

export interface CatalogActionContext {
  organization: boolean;
  admin: boolean;
  canCreate: boolean;
  /** 2026-10-09: a profile with bots.catalogFeature features bots too. */
  feature?: boolean;
  /** Whether a shared bot shows in the viewer's sidebar (not hidden there). */
  inSidebar: (botId: string) => boolean;
}

/** What the viewer may do with an item, the primary action first. Shared:
 * show or hide it in the sidebar, then open and copy it. Organisation:
 * Import Bot. Templates: Use this template (an organization package only
 * while it can still be added). Their own: Open, then publish or withdraw.
 * An admin also features and withdraws any published bot. */
export function catalogActions(item: CatalogItem, ctx: CatalogActionContext): CatalogAction[] {
  if (item.kind === "template") {
    if (!ctx.canCreate) return [];
    const pkg = item.template.orgPackage;
    return !pkg || orgCardAction(pkg) === "add" ? ["useTemplate"] : [];
  }
  const { entry } = item;
  const out: CatalogAction[] = [];
  const published = entry.catalog?.published === true;
  if (entry.source === "shared") {
    out.push(ctx.inSidebar(entry.id) ? "removeFromSidebar" : "addToSidebar");
    out.push("open");
    if (ctx.canCreate) out.push("import");
  } else if (entry.source === "organization") {
    if (ctx.canCreate) out.push("import");
  } else {
    if (!entry.archived) out.push("open");
    if (ctx.organization && !entry.archived) out.push(published ? "unpublish" : "publish");
  }
  if (ctx.organization && (ctx.admin || ctx.feature === true) && published && !entry.archived) {
    out.push(entry.catalog?.featured ? "unfeature" : "feature");
  }
  if (ctx.organization && ctx.admin && published && !entry.archived && entry.source !== "mine") out.push("unpublish");
  return out;
}

export const ACTION_LABEL: Record<CatalogAction, LocaleKey> = {
  open: "botCatalog.action.open",
  addToSidebar: "botCatalog.action.addToSidebar",
  removeFromSidebar: "botCatalog.action.removeFromSidebar",
  import: "botCatalog.action.import",
  useTemplate: "botCatalog.action.useTemplate",
  publish: "botCatalog.action.publish",
  unpublish: "botCatalog.action.unpublish",
  feature: "botCatalog.action.feature",
  unfeature: "botCatalog.action.unfeature",
};

/** The card's button: Add for what joins the viewer's bots or sidebar. */
export function cardActionLabel(action: CatalogAction): string {
  if (action === "import" || action === "addToSidebar") return t("botCatalog.action.add");
  if (action === "useTemplate") return t("botCatalog.action.use");
  if (action === "removeFromSidebar") return t("botCatalog.action.remove");
  return t(ACTION_LABEL[action]);
}
