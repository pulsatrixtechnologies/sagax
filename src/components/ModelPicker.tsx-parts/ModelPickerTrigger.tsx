// Model picker chip / trigger (extracted from ModelPicker.tsx, #1383).
import { type RefObject } from "react";
import { ChevronDown } from "lucide-react";
import type { Bot, InstanceInfo, ModelSelection } from "@/state/store";
import { InstanceProviderMark } from "../ProviderIcons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { COMPACT_SQUARE } from "@/lib/compact-chip";
import { autoChipLabel } from "@/lib/auto-model";
import { effortLabel } from "@/lib/effort-label";
import { isUltracodeEffort } from "../../../shared/ultracode-effort";
import { modelLabel, modelProvider } from "./helpers";
import { TABLE_CELL_CONTROL } from "../SettingsPrimitives";

/** One plain line for the list chip, so the ellipsis cuts a single run.
 * #2050: the chip reads "Claude Sonnet 5.5 · Medium": the effort rides
 * the model since the Bot models table has no Effort column any more.
 * #2080: model first; the provider is the mark, the paying account is the
 * grey line under the chip (`listChipPayer`), never in the label. */
export function listChipLabel({ autoOn, autoRecord, active, selection }: {
  autoOn: boolean;
  autoRecord: { modelLabel: string } | null | undefined;
  active: InstanceInfo | undefined;
  selection: ModelSelection;
  showActiveAccount?: boolean;
}): string {
  const effort = selection.effort ? effortLabel(selection.effort) : undefined;
  if (autoOn) return [autoChipLabel(autoRecord), effort].filter(Boolean).join(" · ");
  return [modelLabel(active, selection.model), effort].filter(Boolean).join(" · ");
}

/** The account that pays, shown under the list chip only when the provider
 * has several accounts to choose from. */
export function listChipPayer({ autoOn, active, showActiveAccount }: {
  autoOn: boolean;
  active: InstanceInfo | undefined;
  showActiveAccount: boolean;
}): string | undefined {
  if (autoOn || !active || !showActiveAccount) return undefined;
  return active.displayName;
}

export function ModelPickerTrigger({
  windowOnly,
  inComposer,
  headless,
  contained,
  listChip = false,
  bot,
  threadId,
  triggerRef,
  menu,
  toggleMenu,
  composerLabel,
  followLine,
  summary,
  selection,
  autoOn,
  autoRecord,
  autoInstance,
  active,
  showActiveAccount,
  selectedVariantLabel,
  advanced,
}: {
  windowOnly: boolean;
  inComposer: boolean;
  headless: boolean;
  contained: boolean;
  /** Settings list row: full-width readable pill, no effort suffix (effort is a sibling control). */
  listChip?: boolean;
  bot: Bot;
  threadId?: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  menu: boolean;
  toggleMenu: () => void;
  composerLabel: string;
  followLine: string;
  summary: string;
  selection: ModelSelection;
  autoOn: boolean;
  autoRecord: { modelLabel: string } | null | undefined;
  autoInstance: InstanceInfo | undefined;
  active: InstanceInfo | undefined;
  showActiveAccount: boolean;
  selectedVariantLabel: string | undefined;
  advanced: boolean;
}) {
  // headless outside the composer (#2050, Settings > Models "Set model for
  // n bots"): no chip at all, the menu opens from `menuControl`.
  const payer = listChip ? listChipPayer({ autoOn, active, showActiveAccount }) : undefined;
  return windowOnly ? null : headless ? (inComposer ? (
  // no chip: the + menu's Model row reads it; the Retro 98 status bar reads this
  <span hidden data-composer-model={composerLabel} />
) : null) : inComposer ? (
  <button data-tour="model"
    ref={triggerRef}
    type="button"
    disabled={Boolean(bot.busy)}
    onClick={() => toggleMenu()}
    aria-expanded={menu && !bot.busy}
    aria-haspopup="listbox"
    title={bot.busy ? `${composerLabel}${followLine}\n${t(threadId ? "model.threadBusy" : "model.busy")}` : `${composerLabel}${followLine}`}
    className={cn(
      "flex max-w-full items-center gap-1 rounded-lg px-1.5 py-1 text-[13px] text-ink-secondary hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
      isUltracodeEffort(selection.effort) && "ultracode-effort-chip",
    )}
  >
    <span className="truncate">{composerLabel}</span>
    <ChevronDown size={14} className={cn("shrink-0 transition-transform", menu && "rotate-180")} />
  </button>
) : listChip ? (
  // Settings > Models list cell: the engine mark and the whole model name
  // on one left-aligned line, cut with an ellipsis; the full name rides the
  // tooltip. Fills its column so every row's chip has the same width.
  <div className="flex min-w-0 flex-col">
    <button data-tour="model"
      ref={triggerRef}
      type="button"
      disabled={Boolean(bot.busy)}
      onClick={() => toggleMenu()}
      aria-expanded={menu && !bot.busy}
      aria-haspopup="dialog"
      data-model-list-chip=""
      title={bot.busy ? `${summary}${followLine}\n${t(threadId ? "model.threadBusy" : "model.busy")}` : `${summary}${followLine}`}
      className={TABLE_CELL_CONTROL}
    >
      {/* #2080: the mark sits in a fixed shrink-0 box so a generic glyph
          (openai-compat, Azure Foundry) never stretches and eats the label. */}
      {(autoInstance ?? active) && (
        <span aria-hidden="true" className="flex size-3.5 shrink-0 items-center justify-center">
          <InstanceProviderMark instance={(autoInstance ?? active)!} size={14} />
        </span>
      )}
      <span data-model-list-chip-label="" className="min-w-0 flex-1 truncate text-left">
        {listChipLabel({ autoOn, autoRecord, active, selection })}
      </span>
      <ChevronDown size={13} aria-hidden="true" className={cn("shrink-0 text-ink-secondary transition-transform", menu && "rotate-180")} />
    </button>
    {payer && (
      <span data-model-list-chip-payer="" title={payer} className="truncate px-2 text-[11.5px] leading-4 text-ink-secondary">
        {t("botModels.paidBy", { account: payer })}
      </span>
    )}
  </div>
) : (
  <button data-tour="model"
    ref={triggerRef}
    type="button"
    disabled={Boolean(bot.busy)}
    onClick={() => toggleMenu()}
    aria-expanded={menu && !bot.busy}
    aria-haspopup="dialog"
    className={cn(
      // One line only: effort must never wrap under the chip (or under the
      // chat header's bot pill when this chip sat beside it).
      "flex flex-nowrap items-center gap-1.5 whitespace-nowrap rounded-full border border-hairline/40 bg-control/60 py-1 pl-2 pr-2.5 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-control/60",
      // in a narrow chat header fold to a rounded square with just the
      // provider mark; the model name rides the tooltip (a bot with no
      // resolved engine keeps its label: the mark is what would hide it).
      // Multiple Claude accounts keep their name even in the compact chip.
      !contained && active && !showActiveAccount && COMPACT_SQUARE,
    )}
    title={bot.busy ? `${summary}${followLine}\n${t(threadId ? "model.threadBusy" : "model.busy")}` : `${summary}${followLine}`}
  >
    {autoInstance && <InstanceProviderMark instance={autoInstance} size={14} />}
    {!contained && active && showActiveAccount && (
      <span data-model-account-compact className="hidden max-w-20 truncate @max-4xl/chathead:inline">{active.displayName}</span>
    )}
    <span className={cn("flex min-w-0 flex-nowrap items-center gap-1", !contained && active && "@max-4xl/chathead:hidden")}>
      <span className={"max-w-[160px] truncate"}>
        {active && showActiveAccount && !autoOn && (
          <span data-model-account className="text-ink-secondary">{active.displayName} · </span>
        )}
        {autoOn ? <span data-model-auto-chip>{autoChipLabel(autoRecord)}</span> : modelLabel(active, selection.model)}
        {!autoOn && active && modelProvider(active, selection.model) && (
          <span className="text-ink-secondary"> · {modelProvider(active, selection.model)}</span>
        )}
      </span>
      {/* Effort / variant on the contained settings chip only. The chat
          header is the bot pill alone (UX reference): a stray effort label
          must never sit under that pill. Effort stays in the picker menu.
          List rows keep effort in a sibling control, so the chip stays the
          engine and model alone. */}
      {contained && (selectedVariantLabel !== undefined ? (
        <span data-model-variant className="max-w-[120px] truncate text-ink-secondary">· {selectedVariantLabel}</span>
      ) : advanced && selection.effort && (
        <span
          data-model-effort
          className={cn("shrink-0", isUltracodeEffort(selection.effort) ? "ultracode-effort-chip" : "text-ink-secondary")}
        >
          · {effortLabel(selection.effort)}
        </span>
      ))}
    </span>
    <ChevronDown
      size={14}
      className={cn(
        "shrink-0 text-ink-secondary transition-transform",
        menu && "rotate-180",
        !contained && active && "@max-4xl/chathead:hidden",
      )}
    />
  </button>
)
}
