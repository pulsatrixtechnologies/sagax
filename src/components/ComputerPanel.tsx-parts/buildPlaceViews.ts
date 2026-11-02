import type { Bot } from "@/state/store";
import { busyBoatView } from "@/lib/local-computer";
import { placeBlocked, placeFacts, placeViewFor } from "@/lib/place-view";
import { cloudRefusal, type PlaceFacts, type PlaceView } from "../../../shared/place-view";
import { t } from "@/lib/i18n";
import { LocalizedPanelError, panelErrorText } from "./errors";
import type { Phase } from "./types";

export function buildPlaceViews(args: {
  bot: Bot;
  profileBotBusy: boolean | undefined;
  boatState: string | null;
  computerStatusCurrent: boolean;
  livePlace: string;
  cloudBackend: string;
  phase: Phase;
  error: Error | string | null;
  placeSeat: Parameters<typeof placeFacts>[0]["seat"];
  config: Parameters<typeof placeFacts>[0]["config"];
  instances: Parameters<typeof placeFacts>[0]["instances"];
  localSelectable: boolean;
  localDisabledReason: string | null | undefined;
  currentTeamComputer: { name: string } | null;
  boxIncluded: boolean | undefined;
}) {
  const {
    bot, profileBotBusy, boatState, computerStatusCurrent, livePlace, cloudBackend,
    phase, error, placeSeat, config, instances, localSelectable, localDisabledReason,
    currentTeamComputer, boxIncluded,
  } = args;

  const errorText = panelErrorText(error);
  // While a turn holds this conversation's cloud computer: only one that is
  // really starting spins (busyBoatView).
  const busyBoat = busyBoatView(boatState, profileBotBusy === true);
  // The live cloud computer, as this panel last saw it for this conversation
  // (the bot's Works on, or a pin to it). Nothing starts it but the bot's
  // first computer call or the person's own Start it now / Wake it now.
  const cloudComputer: PlaceFacts["computer"] = !computerStatusCurrent || livePlace !== "cloud" || cloudBackend !== "box" ? undefined
    : phase === "starting" ? "starting"
      : phase === "busy-boat" ? (busyBoat.spinner ? "starting" : busyBoat.line === "computer.cloud.asleep" ? "asleep" : "none")
        : phase === "ready" ? "on"
          : boatState === "archived" || boatState === "stopped" ? "asleep" : undefined;
  /** One place's state, line and action (shared/place-view.ts). */
  const viewOf = (place: PlaceFacts["place"], refusal?: PlaceFacts["refusal"]): PlaceView => placeViewFor({
    ...placeFacts({
      bot, place, seat: placeSeat, config, instances,
      local: { ready: localSelectable, reason: localDisabledReason ?? t("computer.unavailableLocal") },
      ...(place === "cloud" ? { computer: cloudComputer } : {}),
      ...(place === "auto" && currentTeamComputer ? { teamComputer: currentTeamComputer.name } : {}),
    }),
    ...(refusal ? { refusal } : {}),
  });
  // A start this panel asked for and was refused (a plan limit, say) reads
  // as the same state a failed turn's row does, never the relay's words.
  const cloudRefused = bot.computer === "cloud" && cloudBackend === "box" && phase === "error" && error && !(error instanceof LocalizedPanelError)
    ? cloudRefusal({ message: errorText ?? "", status: Number((error as { status?: unknown }).status ?? 0) || undefined }, boxIncluded === true)
    : undefined;
  const cloudView = viewOf("cloud", cloudRefused);
  const autoView = viewOf("auto");

  const emptyState = {
    checking: t("computer.phase.checking"),
    starting: cloudBackend === "vps" ? t("computer.phase.starting") : cloudView.line,
    // A turn that has not used its cloud computer yet has not started one
    // (busyBoatView, read into the cloud computer's place view above).
    "busy-boat": cloudView.line,
    unconfigured: cloudView.line,
    "auto-unavailable": autoView.line,
    "team-boat": autoView.line,
    "show-ready-boat": t("computer.phase.showReadyBoat"),
    "show-sleeping-boat": t("computer.phase.showSleepingBoat"),
    "show-pending-boat": t("computer.phase.showPendingBoat"),
    "cloud-new": cloudView.line,
    "cloud-asleep": cloudView.line,
    "vps-unconfigured": t("computer.phase.vpsUnconfigured"),
    "vps-incompatible": t("computer.phase.vpsIncompatible"),
    "vps-stopped": t("computer.phase.vpsStopped"),
    "local-unavailable": localDisabledReason ?? t("computer.phase.localUnavailable"),
    "vm-unavailable": t("computer.phase.vmUnavailable"),
    browser: viewOf("browser").line,
    off: viewOf("off").line,
    error: bot.computer === "cloud" && (cloudRefused || placeBlocked(cloudView)) ? cloudView.line : t("computer.phase.error"),
  } satisfies Record<Exclude<Phase, "ready" | "local" | "vm">, string>;

  return { errorText, busyBoat, cloudRefused, cloudView, autoView, emptyState, viewOf };
}
