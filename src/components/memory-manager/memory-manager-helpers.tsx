import { t } from "@/lib/i18n";
import { botNames, isLinked, type FolderLink, type LinkBot } from "@/lib/memory-folders";
import { swatchStyle, type MausColor } from "@/lib/mascot";

export const TEAM_KINDS = ["person", "place", "decision", "term"];
export const PINS = "sagax.memory.pins";

export function slugify(value: string, fallback: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback;
}

export function readPins(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(PINS) ?? "[]");
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export function writePins(pins: string[]): void {
  try { window.localStorage.setItem(PINS, JSON.stringify(pins)); } catch { /* a private window: the pins last for this page */ }
}

/** A linked folder's mark: the bot's picture, else its colour. */
export function LinkMark({ bot }: { bot: LinkBot }) {
  if (bot.avatarUrl && bot.avatarCrop !== "mascot") {
    return <img src={bot.avatarUrl} alt="" className="size-[14px] shrink-0 rounded-full object-cover" data-memory-link-mark="avatar" />;
  }
  return <span className="mx-[2px] size-[10px] shrink-0 rounded-full" style={swatchStyle((bot.color ?? "green") as MausColor)} aria-hidden="true" data-memory-link-mark="color" />;
}

/** The ⋯ menu's first lines: who the folder belongs to and what uses it. */
export function linkLines(link: FolderLink): string[] {
  if (!isLinked(link)) return [link.readBy.length ? t("memoryManager.readBy", { bots: link.readBy.join(", ") }) : t("memoryManager.notLinkedLine")];
  return [
    t("memoryManager.linkedTo", { bot: botNames(link) }),
    ...(link.routines.length ? [t("memoryManager.routinesLine", { names: link.routines.join(", ") })] : []),
  ];
}
