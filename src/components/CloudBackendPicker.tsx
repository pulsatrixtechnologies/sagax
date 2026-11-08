// The Boat / Self-hosted VPS segmented control shown under the "Runs on"
// picker whenever a bot can end up on a cloud computer. One component, two
// homes (ComputerPanel and the bot settings dialog's Access section), so the
// copy can never drift apart. Both backends follow one rule
// (shared/cloud-computer.ts), so neither is offered or refused on its own.
import type { CloudBackend } from "../../shared/wire";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useSettingsSurface } from "./SettingsPrimitives";

export function CloudBackendPicker({
  value,
  compact = false,
  vpsSupported = true,
  organization = false,
  boat = true,
  vps = true,
  onChange,
}: {
  value: CloudBackend;
  compact?: boolean;
  /** Optional since one rule covers both backends (shared/cloud-computer.ts). */
  vpsSupported?: boolean;
  /** An organization server: a bot works in its owner's server environment,
   * so the per-bot VPS computer is not offered. */
  organization?: boolean;
  /** Boat Computer and VPS Computer (Settings > Developer > Experimental features):
   * a backend switched off is not offered. */
  boat?: boolean;
  vps?: boolean;
  onChange: (backend: CloudBackend) => void;
}) {
  const backends = (organization ? ["box"] as const : ["box", "vps"] as const).filter((backend) => backend === "vps" ? vps : boat);
  const plain = useSettingsSurface() === "plain";
  if (!backends.length) return null;
  const heading = compact ? t("botPanel.cloud.provider") : t("botPanel.cloud.backend");
  const description = organization
    ? t("botPanel.cloud.org")
    : compact
    ? value === "vps" ? t("botPanel.cloud.ssh") : t("botPanel.cloud.boatShort")
    : value === "vps"
    ? t("botPanel.cloud.vpsLong")
    : t("botPanel.cloud.boatLong");
  // The bot's profile page (#2313): the card's grey label carries the
  // heading, the description is the row's subtitle and the choice is the
  // page's segmented control (the tabs' family), with no box around it.
  if (plain) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 basis-[220px] text-[12px] leading-4 text-ink-secondary">{description}</p>
        <div role="group" aria-label={heading} className="flex shrink-0 rounded-full bg-control p-0.5">
          {backends.map((backend) => {
            const disabled = backend === "vps" && !vpsSupported;
            return (
              <button
                key={backend}
                type="button"
                disabled={disabled}
                aria-pressed={value === backend}
                title={disabled ? t("botPanel.cloud.vpsNeeds") : undefined}
                onClick={() => onChange(backend)}
                className={cn(
                  "rounded-full px-3 py-1 text-[13px] leading-[18px] transition-colors",
                  disabled && "cursor-not-allowed opacity-40",
                  value === backend ? "bg-hover text-ink" : "text-ink-secondary hover:text-ink",
                )}
              >
                {backend === "vps" ? t("botPanel.cloud.vps") : t("botPanel.cloud.boat")}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-lg bg-inset p-3">
      <div className="text-[12px] font-medium text-ink">{heading}</div>
      <div className="mt-0.5 text-[11.5px] text-ink-secondary">{description}</div>
      <div className="mt-2 flex overflow-hidden rounded-lg border border-hairline/40">
        {backends.map((backend, i) => {
          const disabled = backend === "vps" && !vpsSupported;
          return (
            <button
              key={backend}
              disabled={disabled}
              title={disabled ? t("botPanel.cloud.vpsNeeds") : undefined}
              onClick={() => onChange(backend)}
              className={cn(
                "flex-1 py-1.5 text-[12px]",
                i > 0 && "border-l border-hairline/40",
                disabled && "cursor-not-allowed opacity-40",
                value === backend ? "bg-raised text-ink" : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
              )}
            >
              {backend === "vps" ? t("botPanel.cloud.vps") : t("botPanel.cloud.boat")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
