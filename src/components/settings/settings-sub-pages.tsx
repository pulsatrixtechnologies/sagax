import type { ReactNode } from "react";
import type { AppSettingsSection } from "@/state/store";
import type { LocaleKey } from "@/locales";
import { AboutMeEditor } from "../AboutMeSettings";
import { AvatarCropPage } from "./OwnAvatarField";
import { UsageTraces } from "../usage/UsageTraces";
import { fetchMyTraces } from "@/lib/usage-trace";

/** Sub-pages pushed inside a section (src/components/SettingsSubPage.tsx):
 * the section they belong to, their title and their page. */
export const SUB_PAGES: Record<string, { section: AppSettingsSection; titleKey: LocaleKey; render: () => ReactNode }> = {
  "general.aboutMe": { section: "account", titleKey: "settings.profile.aboutMe", render: () => <AboutMeEditor /> },
  "account.crop": { section: "account", titleKey: "settings.profile.photoCropTitle", render: () => <AvatarCropPage /> },
  "usage.traces": { section: "usage", titleKey: "usage.trace.title", render: () => <UsageTraces load={fetchMyTraces} /> },
};
