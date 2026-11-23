// The bot's Works on, once, as the editor's Workspace page on a solo server
// and on an organization server. This computer, the Local VM and the cloud
// computer are saved on the bot (`computer`). The browser is still Auto:
// the bot picks it per task. Off stays: it gives the bot no computer and
// no browser at all. Local VM is hidden on a cloud home and stays visible,
// not selectable, with the reason, only when it cannot be used.
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { useDesktopBridgeStatus } from "@/lib/desktop-bridge";
import { localVmChoice, localVmDesktopState, type LocalVmChoice } from "@/lib/local-vm-choice";
import { placeLabelKey, type EffectivePlace } from "@/lib/place";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import type { Bot } from "@/state/store";
import { useStoreSelector } from "@/state/store-selector";

import { useBotEditor } from "../bot-settings/BotEditorContext";
import { PaneSection } from "../bot-settings/PaneSection";
import { useSettingsSurface } from "../SettingsPrimitives";
import { useBotSettingsDerived } from "../bot-settings/useBotSettingsDerived";

/** null is Auto. This computer, the Local VM and the cloud computer are kept.
 * The browser or a saved Off reads as Auto: Off is gone from every menu. */
export type WorksOnMode = "local" | "vm" | "cloud" | null;
export const WORKS_ON_MODES: readonly WorksOnMode[] = [null, "local", "vm", "cloud"];

/** What the bot's stored Works on means now. */
export function worksOnMode(computer: Bot["computer"] | null | undefined): WorksOnMode {
  if (computer === "local" || computer === "cloud" || computer === "vm") return computer;
  return null;
}

const MEANS: Record<"auto" | "local" | "vm" | "cloud", LocaleKey> = {
  auto: "worksOn.tip.autoOnly",
  local: "worksOn.tip.local",
  vm: "worksOn.tip.vm",
  cloud: "worksOn.tip.cloud",
};

const VM_OFFERED: LocalVmChoice = { shown: true, selectable: true, reason: null };

/** The tooltip of one choice: what it means. */
export function worksOnTip(mode: WorksOnMode): string {
  return t(MEANS[mode ?? "auto"]);
}

/** The view part, without the store: the panel feeds it, tests render it. */
export function WorksOnControl({ value, onChange, organization = true, mixed = false, vm = VM_OFFERED }: {
  value: WorksOnMode;
  onChange: (mode: WorksOnMode) => void;
  /** Organization labels say what Auto does there. Solo labels say Auto. */
  organization?: boolean;
  /** Bulk edit: bots differ; no place looks selected (#1701). */
  mixed?: boolean;
  /** Local VM: hidden on a cloud home, otherwise listed, disabled with its reason when it cannot be used. */
  vm?: LocalVmChoice;
}) {
  const plain = useSettingsSurface() === "plain";
  const modes = WORKS_ON_MODES.filter((mode) => mode !== "vm" || vm.shown);
  // The bot's profile page (#2313): the card's grey label names it, the
  // explanation is the card's first line and the choice is the page's
  // segmented control (the tabs' family), with no outline.
  if (plain) {
    return (
      <PaneSection
        title={t("computer.worksOn")}
        data-works-on-setting={mixed ? "mixed" : (value ?? "auto")}
        data-works-on-org={organization ? "1" : "0"}
        data-works-on-mixed={mixed ? "" : undefined}
      >
        <p id="works-on-setting-hint" className="text-[12px] leading-4 text-ink-secondary">{t("worksOn.autoOnlyHelp")}</p>
        {mixed && <p data-works-on-mixed-note className="mt-1 text-[12px] leading-4 text-ink-secondary">{t("bulkEdit.mixed")}</p>}
        <div role="radiogroup" aria-label={t("computer.worksOn")} aria-describedby="works-on-setting-hint" className="mt-3 flex w-fit max-w-full flex-wrap gap-0.5 rounded-2xl bg-control p-0.5">
          {modes.map((mode) => {
            const key = (mode ?? "auto") as EffectivePlace;
            const blocked = mode === "vm" && !vm.selectable;
            const selected = !mixed && mode === value;
            return (
              <button key={key} type="button" role="radio" aria-checked={selected} data-works-on-choice={key} disabled={blocked}
                title={blocked ? vm.reason ?? worksOnTip(mode) : worksOnTip(mode)}
                onClick={() => { if (!blocked && (mixed || !selected)) onChange(mode); }}
                className={cn("min-h-[36px] truncate whitespace-nowrap rounded-full px-3 py-1 text-[13px] leading-[18px] transition-colors md:min-h-0",
                  blocked ? "text-ink-tertiary" : selected ? "bg-hover text-ink" : "text-ink-secondary hover:text-ink")}>
                {t(placeLabelKey(key, organization))}
              </button>
            );
          })}
        </div>
        {vm.shown && !vm.selectable && vm.reason && <p data-works-on-vm-reason className="mt-2 text-[12px] leading-4 text-ink-secondary">{vm.reason}</p>}
      </PaneSection>
    );
  }
  return (
    // The editor's Workspace page titles it already (2026-10-15): the
    // heading stays for the radio group's name, read by assistive tech only,
    // and the explanation shows under the page title.
    <section
      aria-labelledby="works-on-setting"
      aria-describedby="works-on-setting-hint"
      data-works-on-setting={mixed ? "mixed" : (value ?? "auto")}
      data-works-on-org={organization ? "1" : "0"}
      data-works-on-mixed={mixed ? "" : undefined}
    >
      <h3 id="works-on-setting" className="sr-only">{t("computer.worksOn")}</h3>
      <p id="works-on-setting-hint" className="text-[12.5px] leading-relaxed text-ink-secondary">{t("worksOn.autoOnlyHelp")}</p>
      {mixed && <p data-works-on-mixed-note className="mt-2 text-[12px] text-ink-secondary">{t("bulkEdit.mixed")}</p>}
      <div role="radiogroup" aria-labelledby="works-on-setting" className="mt-3 grid grid-cols-2 gap-0.5 rounded-lg bg-control p-0.5">
        {modes.map((mode) => {
          const key = (mode ?? "auto") as EffectivePlace;
          const blocked = mode === "vm" && !vm.selectable;
          const selected = !mixed && mode === value;
          return (
            <button key={key} type="button" role="radio" aria-checked={selected} data-works-on-choice={key} disabled={blocked}
              title={blocked ? vm.reason ?? worksOnTip(mode) : worksOnTip(mode)}
              onClick={() => { if (!blocked && (mixed || !selected)) onChange(mode); }}
              className={cn("min-h-[36px] truncate whitespace-nowrap rounded-md border px-2 py-1 text-[12px] md:min-h-0",
                blocked ? "border-transparent text-ink-tertiary" : selected ? "border-accent-border bg-selected font-medium text-ink shadow-sm" : "border-transparent text-ink-secondary hover:bg-raised-hover hover:text-ink")}>
              {t(placeLabelKey(key, organization))}
            </button>
          );
        })}
      </div>
      {vm.shown && !vm.selectable && vm.reason && <p data-works-on-vm-reason className="mt-2 text-[12px] leading-4 text-ink-secondary">{vm.reason}</p>}
    </section>
  );
}

/** The bot's own setting, saved like every bot edit. Hidden when this
 * person cannot save `computer` (an organization member who does not own
 * the bot). */
export function WorksOnSetting({ bot }: { bot: Bot }) {
  const derived = useBotSettingsDerived(bot);
  const organization = usePerspicaxOrg() !== null;
  const bridge = useDesktopBridgeStatus();
  const config = useStoreSelector((current) => current.config);
  const { bulk, mixedFields } = useBotEditor();
  if (!derived.canEdit("computer")) return null;
  const mixed = Boolean(bulk && mixedFields?.has("computer"));
  const vm = localVmChoice({
    cloudHome: config?.cloudHome === true,
    policyAllows: config?.managedPolicy?.computers.localVm !== false,
    organizationName: config?.managedPolicy?.organizationName,
    modelCanUseComputer: derived.engine ? derived.engine.capabilities?.computerMcp === true : null,
    modelName: derived.engine?.displayName,
    desktop: localVmDesktopState(bridge, organization),
  });
  return (
    <WorksOnControl
      value={worksOnMode(bot.computer)}
      organization={organization}
      mixed={mixed}
      vm={vm}
      onChange={(mode) => derived.patch({ computer: mode })}
    />
  );
}
