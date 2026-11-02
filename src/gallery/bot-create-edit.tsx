/** Gallery: creation and edit bot as centred windows (restored after lot 4).
 * Also covers Bot catalogue, Archived bots, Org import (restore-windows).
 * Synthetic bots only. Not shipped.
 * ?view=quick|template|import-zip|edit|bulk|teambot|catalog|archived|orgimport
 * &skin=<id>&lang=<code>&width=&height=
 * scripts/capture/bot-create-edit.mjs / scripts/capture/restore-windows.mjs */
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BotWizard } from "../components/bot-wizard/BotWizard";
import { BulkEditBotsDialog } from "../components/BulkEditBotsDialog";
import { OrgImportDialog } from "../components/OrgImportDialog";
import { PersonaEditorModal } from "../components/persona/PersonaEditorModal";
import { BotCatalogModal } from "../components/bot-catalog/BotCatalogModal";
import { ArchivedBotsPanel } from "../components/Sidebar";
import { TeamBotFromThreadHost } from "../components/TeamBotFromThreadDialog";
import { openTeamBotFromThread } from "../lib/teambot-from-thread";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const view = params.get("view") ?? "quick";

// Gallery captures: abort noise from remounted fetches must not paint an overlay.
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  if (reason && (reason.name === "AbortError" || String(reason).includes("AbortError"))) event.preventDefault();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const scout = {
  id: "scout",
  threadId: "t-scout",
  name: "Scout",
  title: "Research",
  description: "Finds sources and summarizes them.",
  notifications: true,
  color: "green",
  unread: false,
  messages: [],
  tasks: [{ id: "task-1", threadId: "t-scout-topic", title: "Inbox triage" }],
  soul: "Be brief and cite sources.",
  modelSelection: { instanceId: "claude", model: "sonnet" },
  approvalMode: "ask",
} as unknown as Bot;

const melody = {
  ...scout,
  id: "melody",
  threadId: "t-melody",
  name: "Melody",
  color: "orange",
  title: "Writing",
} as unknown as Bot;

const archived = {
  ...scout,
  id: "old-scout",
  threadId: "t-old",
  name: "Old Scout",
  title: "Archived research",
  hidden: true,
  color: "blue",
} as unknown as Bot;

const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
  if (url.pathname === "/api/config") {
    return json({
      profile: { name: "Alex Example" },
      features: {},
      onboarding: { completedAt: 1, launchMode: "solo" },
      viewer: { canCreateBots: true, botsReadOnly: false, operator: true, role: "owner" },
    });
  }
  if (url.pathname === "/api/bot-wizard" || url.pathname.startsWith("/api/bot-wizard/")) return json({ drafts: [] });
  if (url.pathname === "/api/bot-defaults") {
    return json({
      defaults: {
        profile: { name: "Library bot", color: "green", description: "", title: "" },
        settings: {},
      },
    });
  }
  if (url.pathname === "/api/instances" || url.pathname === "/api/models") return json({ instances: [], models: [] });
  if (url.pathname === "/api/bots" && (!init || !init.method || init.method === "GET")) {
    return json({ bots: [scout, melody, archived] });
  }
  if (url.pathname === "/api/bot-catalog") {
    return json({
      organization: false,
      viewer: { principalId: "pr_1", admin: true, canCreate: true },
      entries: [
        {
          id: "entry-scout",
          name: "Scout",
          title: "Research",
          description: "Finds sources and summarizes them.",
          look: { color: "green" },
          owner: { principalId: "pr_1", name: "Alex Example" },
          source: "mine",
          archived: false,
          primary: false,
        },
      ],
    });
  }
  if (url.pathname === "/api/bot-presets") return json({ presets: [] });
  if (url.pathname === "/api/org-library" || url.pathname.startsWith("/api/org-library")) {
    return json({ packages: [] });
  }
  if (url.pathname === "/api/team-library/catalog") return json({ teams: [] });
  if (url.pathname === "/api/team-library/xai" || url.pathname.startsWith("/api/team-library/xai")) {
    return json({ bots: [], fetchedAt: Date.now() });
  }
  if (url.pathname.startsWith("/api/team-library")) {
    return json({ teams: [], bots: [] });
  }
  if (url.pathname === "/api/teams/export") {
    return json({
      document: { package: { release: "1.0.0", presets: [{ bot: { appearance: {} }, skills: [], seed: { memory: {} } }] } },
      filename: "library-bot.sagax.json",
      redacted: [],
      skipped: [],
      summary: {},
    });
  }
  if (url.pathname.includes("/team-bot-draft")) {
    return json({
      draft: {
        name: "Team Scout",
        title: "Shared research",
        description: "A team copy of Scout.",
        instructions: "Help the team research.",
        source: "excerpt",
      },
    });
  }
  if (url.pathname.endsWith("/plugins") || url.pathname.includes("/plugins")) return json({ plugins: [] });
  if (url.pathname.includes("/rules")) return json({ sets: [] });
  if (url.pathname === "/api/mcp/servers") return json({ servers: [] });
  if (url.pathname === "/api/sidebar-hidden") return json({ keys: [] });
  return json({ error: "not in this gallery" }, 404);
}) as typeof window.fetch;

function Open() {
  const { dispatch } = useStore();
  useEffect(() => {
    dispatch({
      type: "hydrate",
      bots: [scout, melody, archived],
      groups: [],
      sections: ["Research"],
      computerControl: {},
    } as never);
    if (view === "quick" || view === "template" || view === "import-zip") {
      dispatch({ type: "openBotWizard" });
    } else if (view === "edit") {
      dispatch({ type: "openPersonaEditor", botId: scout.id, section: "overview" });
    } else if (view === "teambot") {
      openTeamBotFromThread({ botId: scout.id, threadId: "t-scout-topic", title: "Inbox triage" });
    } else if (view === "catalog") {
      dispatch({ type: "openBotCatalog" });
    } else if (view === "archived") {
      dispatch({ type: "showArchivedBots" });
    } else if (view === "orgimport") {
      dispatch({ type: "showOrgImport", staged: null });
    }
  }, [dispatch]);
  return null;
}

function Sample() {
  const { state, dispatch } = useStore();
  if (view === "bulk") {
    return (
      <BulkEditBotsDialog
        botIds={[scout.id, melody.id]}
        onClose={() => {}}
        onDone={() => {}}
      />
    );
  }
  if (view === "catalog" || state.botCatalogOpen) return <BotCatalogModal />;
  if (view === "archived" || state.archivedBotsOpen) {
    const bots = state.bots.filter((bot) => bot.hidden);
    return (
      <ArchivedBotsPanel
        bots={bots.length ? bots : [archived]}
        onClose={() => dispatch({ type: "closeArchivedBots" })}
        onRestored={() => {}}
      />
    );
  }
  if (view === "orgimport" || state.orgImportOpen) {
    return (
      <OrgImportDialog
        staged={state.orgImportStaged}
        onClose={() => dispatch({ type: "closeOrgImport" })}
      />
    );
  }
  if (view === "edit" || state.personaEditor) return <PersonaEditorModal />;
  if (view === "teambot") return <TeamBotFromThreadHost />;
  if (state.botWizard) return <BotWizard />;
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StoreProvider>
    <div className="flex h-screen bg-app text-ink" data-gallery-sample="" data-gallery-bot-create-edit={view}>
      <Open />
      <Sample />
    </div>
  </StoreProvider>,
);
