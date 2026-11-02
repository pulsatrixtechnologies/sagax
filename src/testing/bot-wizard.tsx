// Isolated page for the bot creation wizard (scripts/testing/capture-bot-wizard.ts):
// the real store and wizard against a disposable fake-engine server.
// `?skin=` picks the skin, `?lang=` the language.
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BotWizard } from "../components/bot-wizard/BotWizard";
import { PluginsPanel } from "../components/PluginsPanel";
import { StoreProvider, useStore } from "../state/store";
import { applySkin, type SkinId } from "../lib/skins";
import { loadLocale } from "../lib/i18n";
import "../styles.css";

const params = new URLSearchParams(location.search);
await loadLocale(params.get("lang") ?? "fr");

function Fixture() {
  const { state, dispatch } = useStore();
  // connected, with or without bots (a person with none opens it too)
  const ready = state.connected;
  useEffect(() => {
    if (ready && !state.botWizard) dispatch({ type: "openBotWizard" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  return <main className="min-h-screen bg-app">
    {state.botWizard && <BotWizard />}
    {(state.activeView === "apps" || state.pluginsOpen) && <PluginsPanel />}
  </main>;
}

applySkin((params.get("skin") ?? "midnight") as SkinId);
const root = createRoot(document.getElementById("root")!);
root.render(<StoreProvider><Fixture /></StoreProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
