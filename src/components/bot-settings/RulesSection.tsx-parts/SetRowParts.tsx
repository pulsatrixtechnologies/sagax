import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { RuleSetWire } from "@/lib/rule-sets";
import { PLAIN_FIELD, Switch } from "../../SettingsPrimitives";
import { inputCls } from "../field";
import { Gauge, buttonCls, iconButtonCls } from "./shared";

export function TotalBlock({ plain, totalLabel, totalOver, lines, bytes, maxLines, maxBytes }: { plain: boolean; totalLabel: string; totalOver: boolean; lines: number; bytes: number; maxLines: number; maxBytes: number }) {
  return (
    <div data-rules-total="" className={cn("flex flex-col gap-1", plain && "px-4 py-2.5")}>
      <div className={cn("text-[12px] text-ink-secondary", totalOver && "text-danger")}>{totalLabel}</div>
      <Gauge lines={lines} bytes={bytes} maxLines={maxLines} maxBytes={maxBytes} label={totalLabel} />
      {totalOver && <p role="alert" className="text-[12.5px] text-danger">{t("persona.rules.sets.totalOver")}</p>}
    </div>
  );
}

export function RenameForm({ set, label, name, plain, busy, nameMax, onSubmit, onChange, onCancel }: {
  set: RuleSetWire;
  label: string;
  name: string;
  plain: boolean;
  busy: boolean;
  nameMax: number;
  onSubmit: () => void;
  onChange: (value: { id: string; name: string }) => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <input
        autoFocus
        className={plain ? PLAIN_FIELD : inputCls + " h-8 py-1"}
        aria-label={t("persona.rules.sets.renameLabel", { name: label })}
        maxLength={nameMax}
        value={name}
        onChange={(event) => onChange({ id: set.id, name: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      />
      <button type="submit" className={buttonCls} disabled={busy}>{t("persona.rules.sets.saveName")}</button>
      <button type="button" className={buttonCls} disabled={busy} onClick={onCancel}>{t("common.cancel")}</button>
    </form>
  );
}

export function SetBadges({ set, dirty }: { set: RuleSetWire; dirty: boolean }) {
  return (
    <>
      {!set.enabled && (
        <span className="ml-1.5 rounded bg-control px-1 py-px text-[10px] uppercase tracking-wide text-ink-secondary">{t("persona.rules.sets.off")}</span>
      )}
      {dirty && (
        <span className="ml-1.5 rounded bg-warning/15 px-1 py-px text-[10px] text-warning">{t("persona.rules.sets.unsaved")}</span>
      )}
    </>
  );
}

export function SetControls({ set, index, label, count, busy, onToggle, onMove, onRename, onRemove }: {
  set: RuleSetWire;
  index: number;
  label: string;
  count: number;
  busy: boolean;
  onToggle: () => void;
  onMove: (index: number, delta: -1 | 1) => void;
  onRename: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      <Switch
        checked={set.enabled}
        aria-label={t("persona.rules.sets.toggle", { name: label })}
        disabled={busy}
        onClick={onToggle}
      />
      <button type="button" className={iconButtonCls} aria-label={t("persona.rules.sets.moveUp", { name: label })} title={t("persona.rules.sets.moveUp", { name: label })} disabled={busy || index === 0} onClick={() => onMove(index, -1)}>
        <ArrowUp size={14} aria-hidden="true" />
      </button>
      <button type="button" className={iconButtonCls} aria-label={t("persona.rules.sets.moveDown", { name: label })} title={t("persona.rules.sets.moveDown", { name: label })} disabled={busy || index === count - 1} onClick={() => onMove(index, 1)}>
        <ArrowDown size={14} aria-hidden="true" />
      </button>
      <button type="button" className={iconButtonCls} aria-label={t("persona.rules.sets.rename", { name: label })} title={t("persona.rules.sets.rename", { name: label })} disabled={busy} onClick={onRename}>
        <Pencil size={13} aria-hidden="true" />
      </button>
      <button type="button" className={cn(iconButtonCls, "hover:bg-danger/10 hover:text-danger")} aria-label={t("persona.rules.sets.delete", { name: label })} title={t("persona.rules.sets.delete", { name: label })} disabled={busy} onClick={onRemove}>
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </>
  );
}
