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

export function ModelPickerTrigger({
  windowOnly,
  inComposer,
  headless,
  contained,
  bot,
  threadId,
  triggerRef,
  menu,
  open,
  toggleMenu,
  toggleWindow,
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
  bot: Bot;
  threadId?: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  menu: boolean;
  open: boolean;
  toggleMenu: () => void;
  toggleWindow: () => void;
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
  return windowOnly ? null : inComposer && headless ? (
  // no chip: the + menu's Model row reads it; the Retro 98 status bar reads this
  <span hidden data-composer-model={composerLabel} />
) : inComposer ? (
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
) : (
  <button data-tour="model"
    ref={triggerRef}
    type="button"
    disabled={Boolean(bot.busy)}
    onClick={toggleWindow}
    aria-expanded={open && !bot.busy}
    aria-haspopup="dialog"
    className={cn(
      "flex items-center gap-1.5 rounded-full border border-hairline/40 bg-control/60 py-1 pl-2 pr-2.5 text-[13px] text-ink hover:bg-raised-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-control/60",
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
    <span className={cn("flex min-w-0 items-center gap-1", !contained && active && "@max-4xl/chathead:hidden")}>
      <span className="max-w-[160px] truncate">
        {active && showActiveAccount && !autoOn && (
          <span data-model-account className="text-ink-secondary">{active.displayName} · </span>
        )}
        {autoOn ? <span data-model-auto-chip>{autoChipLabel(autoRecord)}</span> : modelLabel(active, selection.model)}
        {!autoOn && active && modelProvider(active, selection.model) && (
          <span className="text-ink-secondary"> · {modelProvider(active, selection.model)}</span>
        )}
      </span>
      {/* outside the truncating span: a long model name must not be what
          hides the effort the header exists to surface */}
      {selectedVariantLabel !== undefined ? (
        <span data-model-variant className="max-w-[120px] truncate text-ink-secondary">· {selectedVariantLabel}</span>
      ) : advanced && selection.effort && (
        <span
          data-model-effort
          className={cn("shrink-0", isUltracodeEffort(selection.effort) ? "ultracode-effort-chip" : "text-ink-secondary")}
        >
          · {effortLabel(selection.effort)}
        </span>
      )}
    </span>
    <ChevronDown
      size={14}
      className={cn(
        "text-ink-secondary transition-transform",
        open && "rotate-180",
        !contained && active && "@max-4xl/chathead:hidden",
      )}
    />
  </button>
)
}
