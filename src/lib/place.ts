// One place per conversation: where a bot's hands land, as the person sees
// it. The server decides what a turn mounts (server/surface.ts); this is the
// renderer's reading of the same facts, for the composer chip, the panel
// tabs and the place icon on a tool chip.
import { boatComputerEnabled, vpsComputerEnabled, type FeatureFlagConfig } from "./feature-flags";
import { toolSurfaceKind } from "../../shared/tool-surface";
import type { Bot, Task } from "@/state/store";
import type { LocaleKey } from "@/locales";

export type Place = "cloud" | "vm" | "local" | "browser";
export const PLACES: readonly Place[] = ["cloud", "vm", "local", "browser"];
/** What the chip shows: a place, the bot's Auto, or Off. */
export type EffectivePlace = Place | "auto" | "off";

/** Whether this server offers a place at all. On an organization server every
 * place is offered: Cloud is the person's server environment, never a Boat
 * or a VPS, so the experimental VPS and Boat flags do not touch it.
 * Elsewhere Cloud (a Boat or a VPS computer) is offered only while one of
 * those flags is on. */
export function placeOffered(place: Place, config: FeatureFlagConfig | null | undefined, organization = false): boolean {
  if (organization) return true;
  if (place === "cloud") return cloudComputersOffered(config);
  return true;
}

/** A Boat or a VPS computer may be chosen (Settings > Developer > Experimental features). */
export function cloudComputersOffered(config: FeatureFlagConfig | null | undefined): boolean {
  return boatComputerEnabled(config) || vpsComputerEnabled(config);
}

/** The conversation's pin wins over the bot's Works on. A saved Off reads
 * as Auto: Off is gone from every menu. */
export function effectivePlace(bot: Pick<Bot, "computer">, task?: Pick<Task, "surface"> | null): EffectivePlace {
  const computer = bot.computer === "off" ? undefined : bot.computer;
  return task?.surface ?? computer ?? "auto";
}

export function isComputerPlace(place: EffectivePlace): place is "cloud" | "vm" | "local" {
  return place === "cloud" || place === "vm" || place === "local";
}

/** On an organization server Cloud is the server environment and Auto
 * picks the place per task (server/computer/auto-computer.ts), and their names say so. */
export function placeLabelKey(place: EffectivePlace, organization = false): LocaleKey {
  if (organization && place === "cloud") return "place.cloudOrg";
  if (organization && place === "auto") return "place.autoOrg";
  return `place.${place}` as LocaleKey;
}

/** The computer an organization server's turn uses for this place: the
 * person's server environment for Cloud, their own computer (through the
 * Sagax app) for Local VM and This computer. Auto reads as the server here
 * (no composer notice); it starts on their computer when it is connected
 * and picks per task (OrgComputerTab activeComputer). */
export function orgComputerFor(place: EffectivePlace): "server" | "computer" | null {
  if (place === "auto" || place === "cloud") return "server";
  if (place === "vm" || place === "local") return "computer";
  return null;
}

/** The place a tool chip should carry: the browser for browser tools, the
 * conversation's computer for computer tools, nothing for everything else.
 * A computer tool on an unpinned Auto conversation has no known place yet. */
export function toolPlace(toolName: string, effective: EffectivePlace): Place | null {
  const kind = toolSurfaceKind(toolName);
  if (kind === "browser") return "browser";
  if (kind === "computer") return isComputerPlace(effective) ? effective : null;
  return null;
}
