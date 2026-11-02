// Client for Connect apps > Tailscale (/api/me/tailscale*). Secrets never
// come back in answers; the person pastes them once into setup.
import { api } from "@/state/store";
import type {
  BotTailscaleJoinInput,
  BotTailscaleSetupInput,
  BotTailscaleView,
} from "../../shared/bot-tailscale";

export type {
  BotTailscaleComputerOption,
  BotTailscaleCredKind,
  BotTailscaleDeviceView,
  BotTailscaleJoinInput,
  BotTailscaleKeyKind,
  BotTailscalePhase,
  BotTailscaleSetupInput,
  BotTailscaleView,
} from "../../shared/bot-tailscale";

export { SAGAX_TAILSCALE_TAG, emptyBotTailscaleView } from "../../shared/bot-tailscale";

export const TAILSCALE_KEY = "tailscale:tailscale";

export function fetchBotTailscale(signal?: AbortSignal): Promise<BotTailscaleView> {
  return api<BotTailscaleView>("/api/me/tailscale", signal ? { signal } : {});
}

export function setupBotTailscale(input: BotTailscaleSetupInput): Promise<BotTailscaleView> {
  return api<BotTailscaleView>("/api/me/tailscale/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function joinBotTailscale(input: BotTailscaleJoinInput): Promise<BotTailscaleView> {
  return api<BotTailscaleView>("/api/me/tailscale/join", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function refreshBotTailscale(): Promise<BotTailscaleView> {
  return api<BotTailscaleView>("/api/me/tailscale/refresh", { method: "POST" });
}

export function disconnectBotTailscale(): Promise<BotTailscaleView> {
  return api<BotTailscaleView>("/api/me/tailscale/disconnect", { method: "POST" });
}

export function clearBotTailscale(): Promise<BotTailscaleView> {
  return api<BotTailscaleView>("/api/me/tailscale", { method: "DELETE" });
}

/** True while the UI should poll for admin approval. */
export function shouldPollTailscale(view: BotTailscaleView | null | undefined): boolean {
  return view?.phase === "pending_approval" || view?.phase === "joining";
}
