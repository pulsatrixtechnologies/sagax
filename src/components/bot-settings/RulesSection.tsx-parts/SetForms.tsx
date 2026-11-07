import { ConfirmDialog } from "../../ConfirmDialog";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { RuleSetWire } from "@/lib/rule-sets";
import { PLAIN_FIELD } from "../../SettingsPrimitives";
import { inputCls } from "../field";
import { buttonCls, ruleSetLabel } from "./shared";

export function AddForm({ plain, busy, nameMax, newName, onNameChange, onSubmit, onCancel }: {
  plain: boolean;
  busy: boolean;
  nameMax: number;
  newName: string;
  onNameChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className={cn("flex items-center gap-2", plain && "px-4 py-2")}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <input
        autoFocus
        className={plain ? PLAIN_FIELD : inputCls}
        aria-label={t("persona.rules.sets.newName")}
        placeholder={t("persona.rules.sets.newPlaceholder")}
        maxLength={nameMax}
        value={newName}
        onChange={(event) => onNameChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      />
      <button type="submit" className={buttonCls} disabled={busy || !newName.trim()}>{t("common.add")}</button>
      <button type="button" className={buttonCls} disabled={busy} onClick={onCancel}>{t("common.cancel")}</button>
    </form>
  );
}

export function ConfirmDeleteDialog({ removing, onCancel, onConfirm }: { removing: RuleSetWire | null; onCancel: () => void; onConfirm: () => void }) {
  return (
    <ConfirmDialog
      open={removing !== null}
      title={t("persona.rules.sets.delete", { name: removing ? ruleSetLabel(removing) : "" })}
      body={removing ? t("persona.rules.sets.deleteConfirm", { name: ruleSetLabel(removing) }) : ""}
      confirmLabel={t("common.delete")}
      tone="danger"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
