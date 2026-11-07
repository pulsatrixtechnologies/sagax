import { Fragment } from "react";
import { browserUnavailableReason, type FeatureFlagConfig } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import { currentSettingsSection, openSettings, settingsLinkParts, settingsSectionLabel, type SettingsLinkTarget } from "@/lib/settings-link";
import { useStore } from "@/state/store";

/** Renders `{name}` in `text` as a button that opens that settings target.
 * A placeholder with no target stays visible, so a missing link is obvious. */
export function SettingsText({
  text,
  links,
  className,
}: {
  text: string;
  links: Record<string, SettingsLinkTarget>;
  className?: string;
}) {
  const { dispatch } = useStore();
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
            className="text-accent underline"
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
