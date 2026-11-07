// #2636 (JC 2026-11-07): the one discreet line an origin page keeps after its
// technical options moved to Settings > Developer. One grey sentence with
// the page's name as a link, under the page's cards, the way SettingsText
// renders a settings link everywhere else.
import { t } from "@/lib/i18n";
import { SettingsText } from "../SettingsLink";

export function DeveloperLink() {
  return (
    <p data-developer-link="" className="px-1 text-[12px] text-ink-secondary">
      <SettingsText text={t("settings.developer.link")} links={{ developer: { section: "developer" } }} />
    </p>
  );
}
