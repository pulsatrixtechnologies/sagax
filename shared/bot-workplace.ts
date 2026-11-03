// Where bots work for a person on an organization server (server mode):
// "computer", their own PC through their Sagax desktop app (the desktop
// bridge, server/desktop/desktop-bridge.ts), or "server", their server environment
// (server/user-sandbox-*.ts). A per-person preference that travels with the
// person (shared/user-preferences.ts) and that the server reads at each turn.
//
// Stored as one JSON string under BOT_WORKPLACE_PREFERENCE, like every
// synced preference: { place, routines, network }. Anything unreadable is the default.

export const BOT_WORKPLACE_PREFERENCE = "sagax.botWorkplace.v1";

export type BotWorkplacePlace = "computer" | "server";

export interface BotWorkplace {
  /** Where the person's own conversations run. Default: their computer. */
  place: BotWorkplacePlace;
  /** Routines of the bots they own may use their computer too (only while
   * it is connected). Off by default: routines run unattended. */
  routines: boolean;
  /** Which destinations bots may reach THROUGH this person's computer (the
   * egress tunnel, server/desktop/desktop-egress.ts): "all" (default) or "lan", the
   * local network only (private addresses; anything else leaves from the
   * server as it would without the tunnel). */
  network: BotWorkplaceNetwork;
}

export type BotWorkplaceNetwork = "all" | "lan";

export const DEFAULT_BOT_WORKPLACE: BotWorkplace = Object.freeze({ place: "computer", routines: false, network: "all" });

export function parseBotWorkplace(value: string | null | undefined): BotWorkplace {
  if (!value) return { ...DEFAULT_BOT_WORKPLACE };
  try {
    const parsed = JSON.parse(value) as Partial<BotWorkplace> | null;
    return {
      place: parsed?.place === "server" ? "server" : "computer",
      routines: parsed?.routines === true,
      network: parsed?.network === "lan" ? "lan" : "all",
    };
  } catch {
    return { ...DEFAULT_BOT_WORKPLACE };
  }
}

export function serializeBotWorkplace(value: BotWorkplace): string {
  return JSON.stringify({ place: value.place === "server" ? "server" : "computer", routines: value.routines === true, network: value.network === "lan" ? "lan" : "all" });
}

/** The MCP server the desktop bridge tools are mounted under. The UI reads it
 * back from tool names to show "Your computer". */
export const DESKTOP_BRIDGE_MCP_NAME = "sagax-desktop";
