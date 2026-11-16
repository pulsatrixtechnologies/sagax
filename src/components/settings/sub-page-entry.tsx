// The "▸" row of a Settings page (#4457) and who sees each sub-page. Apart
// from settings-sub-pages.tsx (the sub-pages' content) so a page can draw its
// rows without importing every sub-page.
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { hasDesktopShellPreferences } from "@/lib/desktop-shell-preferences";
import { SETTINGS_SUB_PAGES, type SettingsSubPageId } from "@/lib/settings-sections";
import { SettingsSubPageRow, useSettingsPage, type SettingsPageScope } from "../SettingsSubPage";

function shortcutsServed(): boolean {
  if (typeof window === "undefined") return false;
  return hasDesktopShellPreferences() || Boolean((window.ogb?.floatingBots as { hotkey?: unknown } | undefined)?.hotkey);
}

/** Sub-pages with something to show only for some viewers: a row that
 * would open an empty page is not drawn. */
const AVAILABLE: Partial<Record<SettingsSubPageId, (scope: SettingsPageScope) => boolean>> = {
  "general.shortcuts": shortcutsServed,
  "security.peopleToolAccess": (scope) => scope.editConfig,
};

/** Whether this viewer may see a sub-page: the former page's rules, and
 * something to show. */
export function subPageShown(id: SettingsSubPageId, scope: SettingsPageScope): boolean {
  const info = SETTINGS_SUB_PAGES[id];
  if (info.gate && !scope.allowed(info.gate)) return false;
  return AVAILABLE[id]?.(scope) ?? true;
}

/** A "▸" row of a page: opens one of its sub-pages (a page of the settings
 * stack, never a modal). Not drawn where the viewer may not see it. */
export function SubPageEntry({ id, summary, cardId }: { id: SettingsSubPageId; summary?: ReactNode; cardId?: string }) {
  const scope = useSettingsPage();
  if (!subPageShown(id, scope)) return null;
  return (
    <SettingsSubPageRow
      bare
      cardId={cardId ?? id}
      title={t(SETTINGS_SUB_PAGES[id].titleKey)}
      summary={summary}
      onOpen={() => scope.openSubPage(id)}
    />
  );
}
