// Every value the old SettingsPanel derived from state before rendering,
// lifted verbatim (SettingsPanel.tsx:541-611) so the section files that
// consume them (Identity, Soul, and — in later commits — the rest) can
// stay pure prop-takers. This hook is the one place in the bot settings
// dialog that still reaches into useStore.
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { browserAvailable, browserUnavailableReason, builtInBrowserEnabled } from "@/lib/feature-flags";
import { instanceSupportsLocalComputer, localComputerDisabledReason, localComputerSelectable } from "@/lib/local-computer";
import { stateForBot } from "@/lib/mascot";
import { placeOffered } from "@/lib/place";
import { useStore, type Bot } from "@/state/store";
import { botApprovalSetting } from "../../../shared/approval-mode";
import { canEditBotField } from "@/lib/bot-capabilities";
import { t } from "@/lib/i18n";
import { useBotEditor } from "./BotEditorContext";

export type BotPatch = Partial<
  Pick<
    Bot,
    | "name"
    | "title"
    | "description"
    | "soul"
    | "notifications"
    | "cloudBackend"
    | "autoStartVps"
    | "color"
    | "mascotExpression"
    | "mascotBody"
    | "mascotSkin"
    | "mascotLook"
    | "avatarUrl"
    | "avatarCrop"
    | "avatarZoom"
    | "avatarFocusX"
    | "avatarFocusY"
    | "alwaysAllow"
    | "autoApprove"
    | "approvalMode"
    | "proactiveMode"
    | "outbound"
    | "fallback"
    | "speakReplies"
    | "memoryEnabled"
    | "loopGuard"
    | "voice"
    | "emailDrafts"
    | "chiefOfStaff"
    | "managedSections"
    | "approvePeerComms"
    | "browser"
    | "mcpServers"
    | "mcpAccounts"
    | "modelSelection"
  >
> & {
  computer?: Bot["computer"] | null;
  acknowledgeLocalAuto?: boolean;
  confirmFullAccess?: boolean;
  acknowledgePeerScope?: boolean;
};

export function useBotSettingsDerived(bot: Bot) {
  const { state, dispatch } = useStore();
  const { draft } = useBotEditor();
  const { capabilities } = useDesktopCapabilities();
  const providerSupportsLocal = instanceSupportsLocalComputer(state.instances, bot);
  // An OMB Cloud home never offers this computer (shared/cloud-home.ts).
  const localSelectable = placeOffered("local", state.config) && localComputerSelectable({ capabilities, providerSupportsLocal });
  const localDisabledReason = localComputerDisabledReason({ capabilities, providerSupportsLocal });
  const patch = (p: BotPatch) => dispatch({ type: "updateBot", botId: bot.id, patch: p });
  const activeState = stateForBot(bot);
  const mascotMotion = state.mascotMotion?.botId === bot.id ? state.mascotMotion : null;
  const engine = state.instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId);
  // The approval level (ask / auto / full / custom) as the shared rule reads
  // it from the record — bots saved before approvalMode existed still carry
  // only autoApprove. Full and Custom need the packaged desktop's trusted
  // channel (SettingsPanel used the same test before the dialog replaced it).
  // 2026-10-28: the bot's own setting, never the open conversation's level
  // (that one is `bot.approvalApplied`, shown beside it).
  const approvalMode = botApprovalSetting(bot);
  const trustedModesAvailable = Boolean(window.ogb?.approvals && capabilities.host.packaged);
  const canCoordinate = engine?.capabilities?.agentsMcp === true;
  // An engine with computer tools can use a cloud computer, on Boat or a VPS.
  const canUseVps = engine?.capabilities?.computerMcp === true;
  const canUseBrowser = engine?.capabilities?.browserMcp === true;
  const desktopBrowser = browserAvailable(state.config);
  const browserBlockedOnWindows = window.ogb?.platform === "win32" && !desktopBrowser;
  const browserFeature = builtInBrowserEnabled(state.config);
  const browserAllowed = bot.browser !== false;
  const browserEnabled = browserFeature && browserAllowed;
  // "Works on: Browser" needs everything the switch needs except the switch
  // itself.
  const browserSelectable = desktopBrowser && browserFeature && canUseBrowser;
  const browserDisabledReason = !desktopBrowser
    ? browserUnavailableReason(state.config)
    : !browserFeature
      ? t("botPanel.browserSwitchedOff")
      : t("botPanel.access.browserDenied");
  const sectionName = bot.section?.trim() || t("sidebar.section.general");
  // One Primary Bot per person: the one this bot would take the role from.
  const owner = bot.ownerUserId?.trim().toLowerCase() ?? "";
  // A computer-panel test mounts a partial store that omits bots.
  const currentChief = (state.bots ?? []).find(
    (candidate) =>
      candidate.id !== bot.id &&
      candidate.chiefOfStaff &&
      (candidate.ownerUserId?.trim().toLowerCase() ?? "") === owner,
  );
  const botRoutines = (state.routines ?? []).filter((routine) => routine.botId === bot.id);
  const activeBotRoutines = botRoutines.filter((routine) => routine.enabled).length;

  return {
    patch,
    canEdit: (field: string) => canEditBotField(state.config, bot, field, { draft }),
    engine,
    approvalMode,
    trustedModesAvailable,
    canCoordinate,
    canUseVps,
    canUseBrowser,
    desktopBrowser,
    browserBlockedOnWindows,
    browserFeature,
    browserAllowed,
    browserEnabled,
    browserSelectable,
    browserDisabledReason,
    sectionName,
    currentChief,
    botRoutines,
    activeBotRoutines,
    localSelectable,
    localDisabledReason,
    activeState,
    mascotMotion,
  };
}
