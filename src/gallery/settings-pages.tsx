/** Isolated gallery for headless screenshots of the Settings pages split on
 * 2026-10-28: Account, Security, Vault, Models and Voice, as the real
 * SettingsModal draws them on a stand-in /api (a solo person with saved
 * approval rules, a security key, tool access, vault items, voice and model
 * settings). Fictional data only, neutral names. Not shipped in the app.
 * ?section=account|security|credentials|providers|engines|voice &skin=<id> &lang=<code>
 * &providers=1: several engines, keys, a named server and a local server
 * &org=1: an organization server, the viewer an admin (with providers=1)
 * &keys=unreadable (#3320): the desktop could not read its saved keys, so Vault and Providers offer Reset saved keys
 * &usage=one|three|error (#4095): Settings > Usage with one engine, three, or three with one in error
 * &subPage=<id> (#4329): a sub-page of the section, e.g. providers.provider:anthropic
 * &empty=1 (#4329): no engine and no key, Providers' empty list
 * &keyonly=1 (#4376): a key engine with no key row and no key; &expired=1 (with org=1): a second xAI account to sign in again
 * &accounts=claude|claude-one|openai|openai-solo|xai (#4415, #4426): a provider's Accounts in each state (with subPage=providers.provider:<id>), &member=1 as an organization member (#4435)
 * &firstKey=1 (#4360): Security with no key and no recent proof; &vault=unpaired|noperson: the vault refused
 * ?picker=1: the models window (ModelManager); ?picker=bar: the composer's chip and menu; ?picker=chip: the chat head's chip
 * scripts/capture/settings-pages.mjs shoots each page in light and dark. */
import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ModelPicker } from "../components/ModelPicker";
import { SettingsModal } from "../components/SettingsModal";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, useStore, type AppSettingsSection } from "../state/store";
import { settingsPagesApi } from "./settings-pages-api";
import { usagePageAnswer } from "./usage-page-api";
import { answerGalleryWrite, applyStoredGalleryNames } from "./settings-pages-writes";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
// ?mode=simple (2026-11-05): Simple interface mode, to see the Advanced fold.
if (params.get("mode") === "simple") { try { localStorage.setItem("sagax.interfaceMode.v1", "simple"); localStorage.setItem("sagax.advancedModeMigratedAt.v1", "2026-10-16"); } catch { /* private window */ } }

const API = settingsPagesApi(params);
applyStoredGalleryNames(API);

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

if (params.get("keys") === "unreadable") {
  const ogb = ((window as { ogb?: Record<string, unknown> }).ogb ??= {});
  ogb.credentialStore ??= { unreadable: async () => true, reset: async () => ({ status: "failed", error: "gallery" }) };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
  // &vault=unpaired|noperson (#4360): the vault refused to a caller with no person, solo or linked words
  const refusedVault = params.get("vault");
  if (url.pathname === "/api/me/credentials/list" && (refusedVault === "unpaired" || refusedVault === "noperson")) {
    return json(refusedVault === "unpaired" ? { error: "Pair this device.", code: "not_paired" } : { error: "Sign in to use your credential vault.", code: "no_person" }, 403);
  }
  // &accounts= (#4415): removing an account answers that two bots still use it
  if (params.get("accounts") && (init?.method ?? "GET").toUpperCase() === "DELETE" && /^\/api\/(me\/engines|instances)\/[\w.-]+$/.test(url.pathname)) {
    return json({ error: "Choose another account for the bots and default model using this account before removing it.", code: "account_in_use", bots: ["Scout", "Atlas"] }, 409);
  }
  // #4376: a rename, a model switch, a key change the page's data in memory
  const written = answerGalleryWrite(API, url, init);
  if (written !== undefined) return json(written);
  const body = usagePageAnswer(url, params) ?? API[url.pathname];
  if (body !== undefined) return json(body);
  return json({ error: "not in this gallery" }, 404);
}) as typeof window.fetch;

const section = (params.get("section") ?? "account") as AppSettingsSection;

function OpenModelPicker() {
  const { state } = useStore();
  if (!state.bots[0]) return null;
  // ?picker=bar (#2963): the composer's model chip, which opens the chat bar menu.
  if (params.get("picker") === "bar") return <div className="m-auto w-[640px]"><ModelPicker bot={state.bots[0]} inComposer /></div>;
  // ?picker=chip (#4376): the chat head's chip, which names the account in use
  if (params.get("picker") === "chip") return <div className="m-auto w-[640px]"><ModelPicker bot={state.bots[0]} /></div>;
  return <ModelPicker bot={state.bots[0]} windowOnly />;
}

function OpenSettings() {
  const { dispatch } = useStore();
  useEffect(() => {
    // The store hydrates only after the live stream says hello; this page has
    // no stream, so it hands the store its bots itself (#2658: Settings >
    // Developer > Per bot draws the first bot's technical cards).
    const { bots } = API["/api/bots"] as { bots: unknown[] };
    dispatch({ type: "hydrate", bots, groups: [], sections: [], computerControl: {} } as never);
    const subPage = params.get("subPage");
    if (!params.has("picker")) dispatch({ type: "toggleAppSettings", open: true, section, ...(subPage ? { subPage } : {}) });
    // #4376: the server tells the page its config after a personal key
    // changes (its live stream); this page has none, so it says it itself
    const configChanged = () => dispatch({ type: "configStatus", config: { ...(API["/api/config"] as object) } } as never);
    window.addEventListener("sagax:provider-accounts", configChanged);
    return () => window.removeEventListener("sagax:provider-accounts", configChanged);
  }, [dispatch]);
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
