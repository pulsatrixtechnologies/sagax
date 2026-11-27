// Hosts the browser (and later artifact) window opened from ScreenPanel's
// Detach / Expand actions. Mounted once in the shell so Detach can close the
// docked column without tearing down the window.
import { BrowserWindow } from "./BrowserPanel";
import { closeScreenPanelWindow, useScreenPanelWindow } from "@/lib/screen-panel-window";
import { useStoreSelector } from "@/state/store-selector";

export function ScreenPanelWindowHost() {
  const open = useScreenPanelWindow();
  const bot = useStoreSelector((state) => open ? state.bots.find((candidate) => candidate.id === open.botId) : undefined);
  if (!open || open.kind !== "browser" || !bot) return null;
  return <BrowserWindow bot={bot} onClose={closeScreenPanelWindow} />;
}
