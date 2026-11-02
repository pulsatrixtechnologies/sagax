import { Columns2, Loader2, Moon, Power, Settings2 } from "lucide-react";
import type { Action, Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import type { ComputerMoreItem } from "../computer/ComputerMoreMenu";
import type { ComputerPending, LocalVmStatus, Phase } from "./types";

export function buildComputerMoreItems(args: {
  phase: Phase;
  vmStatus: LocalVmStatus | null;
  cloudPreviewReady: boolean;
  canManageCloud: boolean;
  cloudBackend: string;
  boatState: string | null;
  pending: ComputerPending;
  profileBotBusy: boolean | undefined;
  editComputer: boolean;
  primaryDesktop: boolean;
  canManageVm: boolean;
  bot: Pick<Bot, "id" | "name">;
  onOpenVmWorkspace?: (botId: string) => void;
  run: (kind: "sleep" | "provision") => void;
  runVmAction: (action: "vm-delete") => void;
  dispatch: (action: Action) => void;
}): ComputerMoreItem[] {
  const {
    phase, vmStatus, cloudPreviewReady, canManageCloud, cloudBackend, boatState,
    pending, profileBotBusy, editComputer, primaryDesktop, canManageVm, bot,
    onOpenVmWorkspace, run, runVmAction, dispatch,
  } = args;
  const moreItems: ComputerMoreItem[] = [];
  if (phase === "vm" && vmStatus?.mode === "per-bot" && window.ogb?.desktopWorkspace && onOpenVmWorkspace) {
    moreItems.push({ id: "two-desktops", icon: <Columns2 size={14} />, label: t("computer.twoDesktops"), title: t("computer.twoDesktopsTitle"), disabled: pending !== null, onSelect: () => onOpenVmWorkspace(bot.id) });
  }
  if (cloudPreviewReady && canManageCloud && (cloudBackend === "vps" || boatState !== "archived")) {
    moreItems.push({
      id: "sleep",
      icon: pending === "sleep" ? <Loader2 size={14} className="animate-spin" /> : <Moon size={14} />,
      label: t("vm.cloud.sleep"),
      title: t("computer.sleepTitle"),
      // the server refuses sleep while a turn owns the boat (409)
      disabled: pending === "sleep" || profileBotBusy,
      onSelect: () => run("sleep"),
    });
  }
  // (the boat phases keep their own Works on button in the status card)
  if (editComputer && primaryDesktop) {
    moreItems.push({ id: "works-on", icon: <Settings2 size={14} />, label: t("computer.worksOn"), onSelect: () => dispatch({ type: "toggleSettings", open: true, section: "worksOn" }) });
  }
  if (editComputer && canManageVm && phase === "vm" && vmStatus?.mode === "per-bot") {
    moreItems.push({
      id: "delete-vm",
      icon: pending === "vm-delete" ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />,
      label: t("computer.deleteVm"),
      title: profileBotBusy ? t("computer.deleteVmBlocked") : t("computer.deleteVmTitle", { name: bot.name }),
      disabled: pending !== null || profileBotBusy,
      danger: true,
      onSelect: () => void runVmAction("vm-delete"),
    });
  }
  return moreItems;
}
