// The composer's model menu on its own, for scripts/verify/dev/verify-model-picker-ui.ts:
// a bot on Grok with the catalogs the real drivers build from recorded
// engine answers (scripts/testing/fixtures/model-picker). No account, no
// engine and no user data are involved.
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ModelPicker } from "../../src/components/ModelPicker";
import { DesktopCapabilitiesProvider } from "../../src/components/DesktopCapabilities";
import { StoreProvider, useStore, type Bot } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import { setLocale } from "../../src/lib/i18n";
import { setAdvancedMode } from "../../src/lib/interface-mode";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
setLocale(params.get("lang") ?? "fr");
applySkin((params.get("skin") ?? "midnight") as Parameters<typeof applySkin>[0]);
setAdvancedMode(true);

const BOT_ID = "preview-quasar";
const initial: Bot = {
  id: BOT_ID, threadId: "preview-thread", name: "Quasar", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [],
  modelSelection: {
    instanceId: params.get("instance") ?? "grok",
    model: params.get("model") ?? "grok-4.7-build-fast",
    ...(params.get("effort") ? { effort: params.get("effort") as Bot["modelSelection"]["effort"] } : {}),
  },
};

function Preview() {
  const { state, refreshInstances } = useStore();
  // Settings and the picker load the engines themselves; here, at once.
  useEffect(() => { void refreshInstances(); }, [refreshInstances]);
  // The fixture server does not know this bot: a pick shows in the page's
  // store when the bot is there, else the chip keeps the URL's selection.
  const bot = state.bots.find((candidate) => candidate.id === BOT_ID) ?? initial;
  return (
    <main className="flex h-dvh flex-col bg-app text-ink">
      <div className="flex-1 p-8 text-[13px] text-ink-secondary">Isolated preview · recorded catalogs, no real account</div>
      <div className="mx-auto mb-6 flex w-[min(760px,calc(100vw-32px))] items-center justify-between gap-3 rounded-2xl border border-hairline/50 bg-card px-4 py-3">
        <span className="text-[13px] text-ink-tertiary">Message Quasar</span>
        {bot && state.instances.length > 0 && <ModelPicker bot={bot} inComposer />}
      </div>
    </main>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<StoreProvider><DesktopCapabilitiesProvider><Preview /></DesktopCapabilitiesProvider></StoreProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
