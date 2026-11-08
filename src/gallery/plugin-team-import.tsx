/** Isolated gallery for headless screenshots of the plugin team import panel
 * (#2669, PluginTeamImportDialog) and its reference, the team panel
 * (TeamDialog). /api/marketplaces and the import preview are answered in
 * memory. Not shipped in the app. ?view=import|team&skin=<id>&lang=<code> */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { PluginTeamImportDialog } from "../components/PluginTeamImportDialog";
import { TeamDialog } from "../components/TeamDialog";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/marketplaces")) {
    return json({ marketplaces: [
      { name: "pulsatrix", plugins: [{ name: "pulsatrix-dev", installed: true }, { name: "pulsatrix-docs" }] },
      { name: "studio", plugins: [{ name: "design-crew", installed: true }] },
    ] });
  }
  if (url.includes("/api/teams/import-plugin")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { team?: string };
    return json({ team: body.team || "Pulsatrix Dev", plugin: "pulsatrix-dev", marketplace: "pulsatrix", skipped: [], bots: [
      { name: "px-architect", modelAsked: "fable", model: "claude-fable-5-1", tools: ["Read", "Grep", "Glob"], toolsEnforced: false, notes: ["Read, Grep, Glob stay a guideline on this engine"] },
      { name: "px-reviewer", modelAsked: "sonnet", model: "claude-sonnet-5", tools: ["Read", "Bash"], toolsEnforced: true, notes: [] },
      { name: "px-scribe", modelAsked: "haiku", model: "claude-haiku-5", tools: [], toolsEnforced: false, notes: [] },
    ] });
  }
  if (url.includes("/api/")) return new Promise<Response>(() => undefined);
  return realFetch(input, init);
};

const bot = (id: string, name: string, color: string) => ({
  id, threadId: `t-${id}`, name, title: "", description: "", notifications: true, color, unread: false,
  avatarCrop: "mascot", messages: [], tasks: [], section: "Dev", modelSelection: { instanceId: "claude", model: "opus" },
}) as unknown as Bot;
const bots = [bot("b1", "Atlas", "orange"), bot("b2", "Iris", "blue"), bot("b3", "Lina", "green")];

function Page() {
  const { state, dispatch } = useStore();
  useEffect(() => { dispatch({ type: "hydrate", bots, groups: [], sections: ["Dev"], computerControl: {} } as never); }, [dispatch]);
  if (!state.bots.length) return null;
  return (
    <div data-gallery="" style={{ width: 1180, height: 1000 }}>
      {params.get("view") === "team" ? <TeamDialog section="Dev" onClose={() => undefined} /> : <PluginTeamImportDialog onClose={() => undefined} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <Page />
    </StoreProvider>
  </StrictMode>,
);
