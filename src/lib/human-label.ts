// Human labels for records the app knows only by id (JC 2026-10-19: no
// GUID on screen). Each falls back to a plain word when the name is gone,
// never to the id; the id may still go in a tooltip or a Copy action.
import { containsUuid, isOpaqueId, readableOr } from "../../shared/human-id";
import { t } from "@/lib/i18n";

/** An engine (provider instance): its display name, else a readable id
 * ("claude"), else "Removed engine". */
export function engineLabel(displayName: string | null | undefined, instanceId: string): string {
  return displayName?.trim() || readableOr(instanceId, t("ids.removedEngine"));
}

function firstReadable(candidates: ReadonlyArray<string | null | undefined>): string | undefined {
  return candidates.map((value) => value?.trim()).find((value): value is string => !!value && !isOpaqueId(value) && !containsUuid(value));
}

/** A person: the first readable of their name, login, email or id, else
 * "Unknown person". */
export function personLabel(...candidates: Array<string | null | undefined>): string {
  return firstReadable(candidates) ?? t("ids.unknownPerson");
}

/** A bot: its name, else "Deleted bot". */
export function botLabel(name: string | null | undefined, id?: string): string {
  return firstReadable([name, id]) ?? t("ids.deletedBot");
}
