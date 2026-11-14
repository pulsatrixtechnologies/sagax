// #4329 lot 1: the ids of a provider's page (a settings sub-page), the line
// it opens on and the providers' names for its title. Light on purpose: the
// Settings window reads it before the Providers code is loaded.
import { useSyncExternalStore } from "react";

import { t } from "@/lib/i18n";
import type { ProviderGroup } from "@/lib/provider-rows";
import { COMPUTER_PROVIDER_ID, vendorLabel } from "../../../shared/model-provider";

/** The sub-page id of one provider's page (SUB_PAGES, settings-sub-pages.tsx). */
export const PROVIDER_PAGE_PREFIX = "providers.provider:";
export function providerPageId(providerId: string): string {
  return `${PROVIDER_PAGE_PREFIX}${providerId}`;
}
export function providerIdOfPage(pageId: string): string | null {
  return pageId.startsWith(PROVIDER_PAGE_PREFIX) ? pageId.slice(PROVIDER_PAGE_PREFIX.length) : null;
}
/** A server for pi (GET /api/me/pi-model-servers) is a provider of its own. */
export const PI_SERVER_PREFIX = "pi-server:";

// The line a provider's page opens on (a button of the list, Add, a link):
// set before the page mounts, read once by it.
let focus: string | null = null;
const listeners = new Set<() => void>();
export function focusProviderLine(rowId: string | null): void {
  focus = rowId;
  for (const listener of listeners) listener();
}
export function useProviderFocus(): string | null {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => focus, () => null);
}

// The providers' names, for a page's title (its breadcrumb): kept as the
// list computes them, so a server's own name shows before the page loads.
const names = new Map<string, string>();
const nameListeners = new Set<() => void>();
let nameVersion = 0;
export function rememberProviderNames(groups: ReadonlyArray<Pick<ProviderGroup, "id" | "kind" | "name">>): void {
  let changed = false;
  for (const group of groups) {
    if (group.kind === "computer" || names.get(group.id) === group.name) continue;
    names.set(group.id, group.name);
    changed = true;
  }
  if (!changed) return;
  nameVersion += 1;
  for (const listener of nameListeners) listener();
}
export function useProviderName(providerId: string): string {
  useSyncExternalStore((listener) => { nameListeners.add(listener); return () => { nameListeners.delete(listener); }; }, () => nameVersion, () => nameVersion);
  if (providerId === COMPUTER_PROVIDER_ID) return t("model.computerProvider");
  return names.get(providerId) ?? (providerId.includes(":") ? t("providers.page.server") : vendorLabel(providerId));
}

