// Hosts the window opened from ScreenPanel's Detach / Expand actions: the
// browser's, the VM's (the server environment's desktop) or the remote
// computer's, the same windows the Computer section and the remote card open.
// Mounted once in the shell so Detach can close the docked column without
// tearing down the window.
import { t } from "@/lib/i18n";
import { BrowserWindow } from "./BrowserPanel";
import { SandboxDesktopModal } from "./computer/SandboxDesktopModal";
import { RemoteTakeover } from "./remote-session/RemoteScreenCard";
import { closeScreenPanelWindow, useScreenPanelWindow } from "@/lib/screen-panel-window";
import { useStoreSelector } from "@/state/store-selector";

export function ScreenPanelWindowHost() {
  const open = useScreenPanelWindow();
  const bot = useStoreSelector((state) => open ? state.bots.find((candidate) => candidate.id === open.botId) : undefined);
  if (!open || !bot) return null;
  if (open.kind === "browser") return <BrowserWindow bot={bot} onClose={closeScreenPanelWindow} />;
  if (open.kind === "vm") return <SandboxDesktopModal title={t("screenPanel.title.vm", { name: bot.name })} state="running" onClose={closeScreenPanelWindow} />;
  if (open.kind === "remote" && open.remote) return <RemoteTakeover botId={bot.id} view={open.remote} state="running" onClose={closeScreenPanelWindow} />;
  return null;
}
