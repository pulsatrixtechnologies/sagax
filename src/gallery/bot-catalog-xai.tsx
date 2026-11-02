/** Isolated gallery for screenshots of Browse Bots' xAI Bot Marketplace
 * section (no server). Not shipped in the app. Names are neutral.
 * ?skin=<id>&lang=<code>&view=home|all|detail&xai=0 (the home as it was
 * before the source)&state=error|loading
 * scripts/capture/bot-catalog-xai.mjs takes the shots. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BotCatalogView } from "../components/bot-catalog/BotCatalogView";
import { BotCatalogDetailView, templateDetail } from "../components/bot-catalog/BotCatalogDetailView";
import { cardActionClass } from "../components/category-modal";
import { AgentImportSummary } from "../components/AgentImport";
import { GrokLeftOutList } from "../components/GrokImportBox";
import { catalogCategories, catalogSections, catalogTemplates, xaiErrorText, type CatalogItem } from "../lib/bot-catalog";
import { teamImportPreview } from "../lib/team-import";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { xaiMarketplaceToPackage, type XaiMarketplaceBot, type XaiMarketplaceEntry } from "../../shared/xai-marketplace";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const view = params.get("view") ?? "home";
const state = params.get("state");

const card = (slug: string, name: string, creator: string, description: string, categories: string[], color: string, shape: string): XaiMarketplaceEntry =>
  ({ slug, name, creator, description, categories, color, shape, url: `https://x.ai/bot/marketplace/bots/${slug}` });

const XAI: XaiMarketplaceEntry[] = [
  card("sample-desk", "Sample Desk", "Alex Example", "Turns a pasted list into a short weekly brief. Nothing is sent without your yes.", ["Sales"], "magenta", "pebble"),
  card("demo-helper", "Demo Helper", "Sam Sample", "Keeps a private notebook of tasks and reminds you on Mondays.", ["Personal"], "violet", "teardrop"),
  card("test-coach", "Test Coach", "Jordan Placeholder", "Scores a pasted transcript and lists three fixes.", ["Recruiting & People"], "gray", "hex"),
  card("draft-studio", "Draft Studio", "Riley Demo", "Rewrites drafts so they read plainly, and shows every change.", ["Marketing"], "orange", "cloud"),
  card("ops-board", "Ops Board", "Casey Sample", "Collects the week's requests into one board and flags what is late.", ["Operations"], "green", "squircle"),
  card("spec-reader", "Spec Reader", "Morgan Example", "Reads a design file and writes a short build spec.", ["Design"], "blue", "gem"),
  card("bug-sorter", "Bug Sorter", "Taylor Demo", "Sorts new bug reports by area and asks for missing steps.", ["Engineering"], "cyan", "capsule"),
];

const DETAIL: XaiMarketplaceBot = {
  ...XAI[0]!,
  shareId: "AbCdEfGhIjKlMnOpQrStU",
  instructions: "",
  memories: ["I keep a short weekly brief from the list you paste. I draft by default and never send anything without your explicit yes.", "Job: a weekly brief from a pasted list. Every fact carries a source link."],
  skills: [{ name: "Getting started", description: "Learn what the person needs and draft a first brief." }, { name: "Weekly brief", description: "Write the brief from the list." }],
  routines: [
    { name: "Weekday draft batch", summary: "Every weekday morning, drafts the next few items and waits on your yes." },
    { name: "Friday recap", summary: "Every Friday, what went out this week and what is waiting on you." },
    { name: "Inbox watch", summary: "When a new reply arrives, files it under the right row." },
  ],
  integrations: [{ name: "notion-workspace", description: "Keep the brief where your team looks things up." }, { name: "Google Sheets", description: "Keep the list somewhere you can edit directly." }],
};

const templates = catalogTemplates([], undefined, { xai: params.get("xai") === "0" || state ? [] : XAI });
const sections = catalogSections({ organization: false, entries: [] }, templates, { category: "all", query: "", showArchived: false, app: null })
  .filter((section) => params.get("xai") !== "0" || section.id !== "xai");

/** Lot 5: Browse Bots fills the content frame (no modal backdrop). */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[100dvh] w-full flex-col bg-app text-ink" data-gallery-sample="" data-gallery-frame="">
      {children}
    </div>
  );
}

function Home() {
  return (
    <BotCatalogView
      organization={false}
      categories={catalogCategories(sections.flatMap((entry) => entry.items))}
      category="all"
      onCategory={() => {}}
      query=""
      onQuery={() => {}}
      sections={sections}
      expanded={view === "all" ? "xai" : null}
      onExpand={() => {}}
      showArchived={false}
      onShowArchived={() => {}}
      hasArchived={false}
      creatorAvatar={() => undefined}
      onOpen={() => {}}
      renderAction={() => <button type="button" className={cardActionClass()}>{t("botCatalog.action.use")}</button>}
      onTemplateTool={() => {}}
      xai={params.get("xai") === "0" ? undefined : {
        loading: state === "loading",
        error: state === "error" ? xaiErrorText("xai_unreachable") : "",
        url: "https://x.ai/bot/marketplace",
        onRefresh: () => {},
        onOpenSource: () => {},
      }}
    />
  );
}

function Detail() {
  const item: CatalogItem = { kind: "template", key: "xai:sample-desk", template: catalogTemplates([], undefined, { xai: [DETAIL] }).find((template) => template.source === "xai")! };
  const { document, leftOut } = xaiMarketplaceToPackage(DETAIL, { timeZone: "America/Toronto" });
  const pending = teamImportPreview(document);
  return (
    <BotCatalogDetailView
      item={item}
      content={item.kind === "template" ? templateDetail(item) : null}
      tab="soul"
      onTab={() => {}}
      onBack={() => {}}
      actions={null}
      preview={
        <div className="flex flex-col gap-3">
          <AgentImportSummary pending={pending} />
          <GrokLeftOutList leftOut={leftOut} />
        </div>
      }
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Frame>{view === "detail" ? <Detail /> : <Home />}</Frame>
  </StrictMode>,
);
