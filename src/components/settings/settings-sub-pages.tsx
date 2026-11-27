import type { ReactNode } from "react";
import type { AppSettingsSection } from "@/state/store";
import { t } from "@/lib/i18n";
import { canonicalSubPageId, SETTINGS_SUB_PAGES, type SettingsSubPageId } from "@/lib/settings-sections";
import { AvatarCropPage } from "./OwnAvatarField";
import { UsageTraces } from "../usage/UsageTraces";
import { fetchMyTraces } from "@/lib/usage-trace";
import {
  AppearanceSettings,
  DecisionModelSettings,
  DeveloperSettings,
  EnginesSettings,
  MascotsPage,
  NotificationSettings,
  ProviderPage,
  SecurityKeySettings,
  VoiceSettingsPage,
  WorkspaceBackupSettings,
} from "../lazy-settings-sections";
import { SettingsGroup } from "../SettingsPrimitives";
import { DEFAULT_PAGE_SCOPE, useSettingsPage, type SettingsPageScope } from "../SettingsSubPage";
import { subPageShown } from "./sub-page-entry";
import { PeopleToolAccessSettings } from "../ToolAccessSettings";
import { AboutPage } from "./AppPage";
import { BotHotkeysRows, FloatingHotkeyRow } from "./AppearanceSettings";
import { MyApprovalRules } from "./MyApprovalRules";
import { MyToolGrants } from "./MyToolGrants";
import { OsPermissionsSection } from "./OsPermissions";
import { providerIdOfPage, useProviderName } from "./provider-page-id";

/** A provider page's title: the provider's name, the breadcrumb's last part. */
function ProviderPageTitle({ providerId }: { providerId: string }) {
  return <>{useProviderName(providerId)}</>;
}

export interface SettingsSubPageEntry {
  section: AppSettingsSection;
  /** The former page whose visibility rules the sub-page keeps. */
  gate?: AppSettingsSection;
  /** The page's title. */
  title: () => ReactNode;
  render: () => ReactNode;
}

/** General > System > Shortcuts: the desktop app's global keys. */
function ShortcutsPage() {
  return (
    <div data-settings-card="general.shortcuts">
      <SettingsGroup groupId="generalShortcuts">
        <BotHotkeysRows />
        <FloatingHotkeyRow />
      </SettingsGroup>
    </div>
  );
}

/** Each sub-page's content (#4457), drawn on its own page of the settings
 * stack (sub-page-entry.tsx says who sees each). `inline: false`: an editor, not
 * settings, so a search does not draw it inline on its page. */
const SUB_PAGE_CONTENT: Record<SettingsSubPageId, { render: (scope: SettingsPageScope) => ReactNode; inline?: false }> = {
  "account.crop": { render: () => <AvatarCropPage />, inline: false },
  "general.appearance": { render: () => <AppearanceSettings /> },
  "general.notifications": { render: (scope) => <NotificationSettings organization={scope.organization} /> },
  "general.mascots": { render: () => <MascotsPage /> },
  "general.shortcuts": { render: () => <ShortcutsPage /> },
  "general.backups": { render: () => <WorkspaceBackupSettings /> },
  "security.rules": { render: () => <MyApprovalRules /> },
  "security.toolGrants": { render: () => <MyToolGrants /> },
  "security.peopleToolAccess": { render: () => <PeopleToolAccessSettings /> },
  "security.keys": { render: () => <SecurityKeySettings /> },
  "security.system": { render: () => <OsPermissionsSection /> },
  "providers.models": {
    render: (scope) => (
      <div className="flex min-w-0 flex-col gap-6">
        <EnginesSettings />
        {/* Decision model (2026-10-14): a group of Models, shown while its experiment is on. */}
        {scope.allowed("decisionModel") && <DecisionModelSettings />}
      </div>
    ),
  },
  "providers.voice": { render: () => <VoiceSettingsPage /> },
  "usage.traces": { render: () => <UsageTraces load={fetchMyTraces} />, inline: false },
  "updates.about": { render: (scope) => <AboutPage remoteActive={scope.remoteActive} openAbout={scope.openAbout} /> },
  "general.advanced": { render: (scope) => <DeveloperSettings remoteActive={scope.remoteActive} /> },
};

/** A sub-page by its id: a page of SETTINGS_SUB_PAGES, or one provider's
 * page of Settings > Providers ("providers.provider:<id>", #4329 lot 1). */
export function resolveSubPage(id: string | null | undefined, scope: () => SettingsPageScope = () => DEFAULT_PAGE_SCOPE): SettingsSubPageEntry | null {
  if (!id) return null;
  const canonical = canonicalSubPageId(id);
  if (Object.hasOwn(SETTINGS_SUB_PAGES, canonical)) {
    const key = canonical as SettingsSubPageId;
    const info = SETTINGS_SUB_PAGES[key];
    return { section: info.section, gate: info.gate, title: () => t(info.titleKey), render: () => SUB_PAGE_CONTENT[key].render(scope()) };
  }
  const provider = providerIdOfPage(id);
  if (provider) return { section: "providers", title: () => <ProviderPageTitle providerId={provider} />, render: () => <ProviderPage providerId={provider} /> };
  return null;
}

/** While a search runs (#4457): the sub-pages of the open page, drawn after
 * it under their titles, so the search finds every setting one page further
 * and its rows show. */
export function SubPagesForSearch({ section }: { section: AppSettingsSection }) {
  const scope = useSettingsPage();
  const ids = (Object.keys(SETTINGS_SUB_PAGES) as SettingsSubPageId[])
    .filter((id) => SETTINGS_SUB_PAGES[id].section === section && SUB_PAGE_CONTENT[id].inline !== false && subPageShown(id, scope));
  return (
    <>
      {ids.map((id) => (
        <section key={id} data-settings-subpage-inline={id} className="flex flex-col gap-3">
          <h3 className="px-1 pt-2 text-[15px] font-semibold leading-6 text-ink">{t(SETTINGS_SUB_PAGES[id].titleKey)}</h3>
          {SUB_PAGE_CONTENT[id].render(scope)}
        </section>
      ))}
    </>
  );
}
