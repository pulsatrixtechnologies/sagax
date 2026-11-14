import type { ReactNode } from "react";
import type { AppSettingsSection } from "@/state/store";
import type { LocaleKey } from "@/locales";
import { t } from "@/lib/i18n";
import { AboutMeEditor } from "../AboutMeSettings";
import { AvatarCropPage } from "./OwnAvatarField";
import { UsageTraces } from "../usage/UsageTraces";
import { fetchMyTraces } from "@/lib/usage-trace";
import { ProviderPage } from "../lazy-settings-sections";
import { providerIdOfPage, useProviderName } from "./provider-page-id";

/** A provider page's title: the provider's name, the breadcrumb's last part. */
function ProviderPageTitle({ providerId }: { providerId: string }) {
  return <>{useProviderName(providerId)}</>;
}

export interface SettingsSubPageEntry {
  section: AppSettingsSection;
  /** The page's title. */
  title: () => ReactNode;
  render: () => ReactNode;
}

const fixed = (section: AppSettingsSection, titleKey: LocaleKey, render: () => ReactNode): SettingsSubPageEntry => ({ section, title: () => t(titleKey), render });

/** Sub-pages pushed inside a section (src/components/SettingsSubPage.tsx):
 * the section they belong to, their title and their page. */
export const SUB_PAGES: Record<string, SettingsSubPageEntry> = {
  "general.aboutMe": fixed("account", "settings.profile.aboutMe", () => <AboutMeEditor />),
  "account.crop": fixed("account", "settings.profile.photoCropTitle", () => <AvatarCropPage />),
  "usage.traces": fixed("usage", "usage.trace.title", () => <UsageTraces load={fetchMyTraces} />),
};

/** A sub-page by its id: a fixed page of SUB_PAGES, or one provider's page
 * of Settings > Providers ("providers.provider:<id>", #4329 lot 1). */
export function resolveSubPage(id: string | null | undefined): SettingsSubPageEntry | null {
  if (!id) return null;
  if (Object.hasOwn(SUB_PAGES, id)) return SUB_PAGES[id]!;
  const provider = providerIdOfPage(id);
  if (provider) return { section: "providers", title: () => <ProviderPageTitle providerId={provider} />, render: () => <ProviderPage providerId={provider} /> };
  return null;
}
