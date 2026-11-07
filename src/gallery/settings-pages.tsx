/** Isolated gallery for headless screenshots of the Settings pages split on
 * 2026-10-28: Account, Security, Vault, Models and Voice, as the real
 * SettingsModal draws them on a stand-in /api (a solo person with saved
 * approval rules, a security key, tool access, vault items, voice and model
 * settings). Fictional data only, neutral names. Not shipped in the app.
 * ?section=account|security|credentials|providers|engines|voice &skin=<id> &lang=<code>
 * &providers=1: several engines, keys, a named server and a local server
 * &org=1: an organization server, the viewer an admin (with providers=1)
 * scripts/capture/settings-pages.mjs shoots each page in light and dark. */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ModelPicker } from "../components/ModelPicker";
import { SettingsModal } from "../components/SettingsModal";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type AppSettingsSection } from "../state/store";
import { settingsPagesApi } from "./settings-pages-api";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
// ?mode=simple (2026-11-05): Simple interface mode, to see the Advanced fold.
if (params.get("mode") === "simple") { try { localStorage.setItem("sagax.interfaceMode.v1", "simple"); localStorage.setItem("sagax.advancedModeMigratedAt.v1", "2026-10-16"); } catch { /* private window */ } }

const API = settingsPagesApi(params);

// #2636: the desktop shell's diagnostics and logs exist, so Settings > Developer draws its Diagnostics card.
{
  const ogb = ((window as { ogb?: Record<string, unknown> }).ogb ??= {});
  ogb.exportDiagnostics ??= async () => null;
  ogb.exportLogs ??= async () => null;
}

// ?perm=mac|win (#2614): the desktop app's permission answers, so Settings >
// Permissions and the in-context banners draw as on a computer.
const permPlatform = params.get("perm");
if (permPlatform) {
  const pane = (name: string) => `x-apple.systempreferences:com.apple.preference.security?Privacy_${name}`;
  const answer = permPlatform === "win"
    ? { platform: "win32", permissions: [
      { id: "microphone", status: "denied", action: { kind: "settings", url: "ms-settings:privacy-microphone" } },
      { id: "notifications", status: "granted", action: { kind: "none" } },
    ] }
    : { platform: "darwin", permissions: [
      { id: "microphone", status: "granted", action: { kind: "none" } },
      { id: "screen", status: "denied", action: { kind: "settings", url: pane("ScreenCapture"), secondary: { kind: "relaunch" } } },
      { id: "accessibility", status: "not-determined", action: { kind: "prompt" } },
      { id: "notifications", status: "denied", action: { kind: "settings", url: "x-apple.systempreferences:com.apple.Notifications-Settings.extension" } },
      { id: "speech", status: "unknown", action: { kind: "settings", url: pane("SpeechRecognition") } },
      { id: "automation", status: "unknown", action: { kind: "settings", url: pane("Automation") } },
      { id: "fullDisk", status: "unknown", action: { kind: "settings", url: pane("AllFiles") } },
    ] };
  const ogb = ((window as { ogb?: Record<string, unknown> }).ogb ??= {});
  ogb.permAll = async () => answer;
  ogb.permAct = async () => ({ ok: true });
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
  const body = API[url.pathname];
  if (body !== undefined) return json(body);
  return json({ error: "not in this gallery" }, 404);
}) as typeof window.fetch;

const section = (params.get("section") ?? "account") as AppSettingsSection;

function OpenModelPicker() {
  const { state } = useStore();
  return state.bots[0] ? <ModelPicker bot={state.bots[0]} windowOnly /> : null;
}

function OpenSettings() {
  const { dispatch } = useStore();
  useEffect(() => { if (!params.has("picker")) dispatch({ type: "toggleAppSettings", open: true, section }); }, [dispatch]);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="flex h-screen bg-app text-ink" data-gallery-settings-pages="">
        <OpenSettings />
        {params.has("picker") ? <OpenModelPicker /> : <SettingsModal />}
      </div>
    </StoreProvider>
  </StrictMode>,
);
