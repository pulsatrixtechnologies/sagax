import { isOpaqueId, sagaxFolder, type SagaxFolderKind } from "../../shared/human-id";
import { t } from "@/lib/i18n";

/** How a Sagax-made folder reads (shared/human-id.ts sagaxFolder). */
export function sagaxFolderLabel(kind: SagaxFolderKind): string {
  return t(kind === "conversation" ? "folder.conversation" : kind === "parallel" ? "folder.parallelTask" : "folder.bot");
}

/** A path as a person reads it, never with an id in it: a folder Sagax made
 * and named after the bot or the conversation reads as what it is ("This
 * conversation's folder/src"), any other id segment as "…". The full path
 * belongs in the tooltip. */
export function humanPath(p: string): string {
  const folder = sagaxFolder(p);
  if (folder) return [sagaxFolderLabel(folder.kind), ...folder.rest].join("/");
  if (!p.split(/[\\/]/).some(isOpaqueId)) return p;
  return p.split(/([\\/])/).map((part) => (isOpaqueId(part) ? "…" : part)).join("");
}

/** ~ for the home folder, so a path reads at a glance. Only home itself or a
 * real child of home shortens — /Users/annex must not render as ~ex when home
 * is /Users/ann. Ids never show (humanPath). */
export function shortPath(p: string, home: string | undefined): string {
  if (sagaxFolder(p)) return humanPath(p);
  if (!home || !p.startsWith(home)) return humanPath(p);
  const rest = p.slice(home.length);
  return rest === "" || rest.startsWith("/") || rest.startsWith("\\") ? humanPath(`~${rest}`) : humanPath(p);
}
