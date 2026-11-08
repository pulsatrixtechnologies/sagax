import { Fragment } from "react";
import { browserUnavailableReason, type FeatureFlagConfig } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import { currentSettingsSection, openSettings, settingsLinkParts, settingsSectionLabel, type SettingsLinkTarget } from "@/lib/settings-link";
import { useStore } from "@/state/store";
import { useSettingsSurface } from "./SettingsPrimitives";

/** Renders `{name}` in `text` as a button that opens that settings target.
 * A placeholder with no target stays visible, so a missing link is obvious. */
export function SettingsText({
  text,
  links,
  className,
  plain = false,
}: {
  text: string;
  links: Record<string, SettingsLinkTarget>;
  className?: string;
  /** A flat column (bot page): the link is told by its accent colour, never
   * underlined. A plain settings surface implies it. */
  plain?: boolean;
}) {
  const { dispatch } = useStore();
  const surface = useSettingsSurface();
  const flat = plain || surface === "plain";
  return (
    <span className={className}>
      {settingsLinkParts(text).map((part, index) => {
        if (part.kind === "text") return <Fragment key={index}>{part.text}</Fragment>;
        const target = links[part.name];
        if (!target) return <Fragment key={index}>{`{${part.name}}`}</Fragment>;
        return (
          <button
            key={index}
            type="button"
            className={flat ? "text-accent transition-colors hover:text-ink" : "text-accent underline"}
            onClick={() => { target.prepare?.(); openSettings(dispatch, target.section, target.cardId); }}
          >
            {settingsSectionLabel(currentSettingsSection(target.section, target.cardId))}
          </button>
        );
      })}
    </span>
  );
}

/** The browser-engine sentence. When the server can install it, the
 * Computer section is a link. Other reasons stay plain text. */
export function BrowserUnavailableNote({ config }: { config: FeatureFlagConfig | null | undefined }) {
  const engine = config?.browserEngine;
  if (engine?.kind === "unavailable" && engine.installable) {
    return (
      <SettingsText
        text={t("browser.notInstalled")}
        links={{ settings: { section: "computer", cardId: "computer.browser" } }}
      />
    );
  }
  return <>{browserUnavailableReason(config)}</>;
}
