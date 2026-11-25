import { createRoot } from "react-dom/client";
import { StoreProvider, useStore } from "../state/store";
import MascotPicker from "../components/floating-bots/MascotPicker";
import { MENU_BOX } from "../components/menu-look";
import { applySkin } from "../lib/skins";
import "../styles.css";

function Fixture() {
  const { state, dispatch } = useStore();
  const bot = state.bots[0];
  return <main className="min-h-screen bg-panel p-6 text-ink">
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-2 text-lg font-semibold">Avatar provider verification</h1>
      <p className="mb-4 break-all text-xs text-ink-secondary">Disposable data. Local test API: {new URLSearchParams(location.search).get("base")}</p>
      {bot ? <div className={`${MENU_BOX} w-max`}><MascotPicker bot={bot}
        onPatch={(patch) => dispatch({ type: "updateBot", botId: bot.id, patch })} /></div> : <p>Loading…</p>}
    </div>
  </main>;
}
applySkin("midnight");
const root = createRoot(document.getElementById("root")!);
root.render(<StoreProvider><Fixture /></StoreProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
