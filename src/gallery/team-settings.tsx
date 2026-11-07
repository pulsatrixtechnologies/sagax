/** Isolated gallery for headless screenshots of the team settings dialog
 * (TeamSettingsDialog): the real dialog over three bots of the "Dev" team,
 * one of them with its own computer. /api/team-defaults is answered in
 * memory; other server calls stay pending. Not shipped in the app. ?skin=<id>&lang=<code> */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { TeamSettingsDialog } from "../components/TeamSettingsDialog";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const team = { model: { instanceId: "claude", model: "opus" }, computer: "cloud" };
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/team-defaults")) {
    return new Response(JSON.stringify({ section: "Dev", label: "Dev", ...team, updatedAt: 1 }), { status: 200, headers: { "content-type": "application/json" } });
  }
  // Every other server call stays pending: the gallery shows only the dialog.
  if (url.includes("/api/")) return new Promise<Response>(() => undefined);
  return realFetch(input, init);
};

const bot = (id: string, name: string, color: string, extra: Partial<Bot> = {}) => ({
  id, threadId: `t-${id}`, name, title: "", description: "", notifications: true, color, unread: false,
  avatarCrop: "mascot", messages: [], tasks: [], section: "Dev",
  modelSelection: { instanceId: "claude", model: "opus" }, computer: "cloud", ...extra,
}) as unknown as Bot;
const bots = [
  bot("b1", "Atlas", "orange"),
  bot("b2", "Iris", "blue"),
  bot("b3", "Lina", "green", { computer: "local", teamOverrides: ["computer"] } as Partial<Bot>),
];
const instances = [{ instanceId: "claude", engine: "claude", label: "Claude", models: { default: "opus", options: [{ id: "opus", label: "Opus" }, { id: "sonnet", label: "Sonnet" }] } }];

function Page() {
  const { state, dispatch } = useStore();
  useEffect(() => {
    dispatch({ type: "instances", instances } as never);
    dispatch({ type: "hydrate", bots, groups: [], sections: ["Dev"], computerControl: {} } as never);
  }, [dispatch]);
  if (!state.bots.length) return null;
  return <div data-gallery="" style={{ width: 1180, height: 1500 }}><TeamSettingsDialog team="Dev" onClose={() => undefined} /></div>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <Page />
    </StoreProvider>
  </StrictMode>,
);
