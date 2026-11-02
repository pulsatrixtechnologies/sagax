// Quick create (lot 4, 2026-11-01): the first step of the creation view.
// Reference 2.4: large mascot, centred name, shape grid, colour row, one
// Create button (disabled while the name is empty). Sagax shapes and colours
// only. Create sends name + colour + shape through the ordinary newBot path.
import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { MAUS_COLOR_NAMES, swatchStyle, type MausColor } from "@/lib/mascot";
import { paletteSwatches } from "../../../shared/mascot-colors";
import { MASCOT_SHAPES, type MascotShape } from "../../../shared/mascot-look";
import { ShapeMascot } from "../ShapeMascot";
import { PrimaryButton } from "../onboarding/beats/shared";

/** Classic soft bodies for the first-step grid (object silhouettes stay in Appearance). */
const QUICK_SHAPES: readonly MascotShape[] = MASCOT_SHAPES.filter(
  (shape) => !["pad", "cup", "bulb", "say", "sprout", "tin", "tome", "ship"].includes(shape),
).slice(0, 16);

/** One vivid row plus a few clay guests so the strip stays short. */
const QUICK_COLORS: readonly MausColor[] = [
  ...paletteSwatches("vivid"),
  ...paletteSwatches("clay").filter((name) => !paletteSwatches("vivid").includes(name)).slice(0, 4),
] as MausColor[];

export type QuickCreateChoice = {
  name: string;
  color: MausColor;
  shape: MascotShape;
};

export function QuickCreate({
  busy,
  suggestedName = "",
  onCreate,
  footer,
}: {
  busy?: boolean;
  suggestedName?: string;
  onCreate: (choice: QuickCreateChoice) => void;
  /** Guided / fill-in / import links under Create. */
  footer?: ReactNode;
}) {
  const [name, setName] = useState(suggestedName);
  const [color, setColor] = useState<MausColor>("green");
  const [shape, setShape] = useState<MascotShape>("circle");
  const canCreate = name.trim().length > 0 && !busy;

  return (
    <div className="flex flex-col items-center gap-6 px-5 pb-8 pt-2 sm:px-8" data-wizard-quick-create="">
      <ShapeMascot
        shape={shape}
        skin="plain"
        color={color}
        size={120}
        animated={false}
        detail="static"
        label={name.trim() || t("botWizard.unnamed")}
      />

      <label className="flex w-full max-w-sm flex-col items-center gap-1.5">
        <span className="sr-only">{t("botWizard.quick.name")}</span>
        <input
          data-wizard-quick-name=""
          type="text"
          value={name}
          maxLength={100}
          autoFocus
          placeholder={t("botWizard.quick.namePlaceholder")}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canCreate) onCreate({ name: name.trim(), color, shape });
          }}
          className="w-full rounded-xl border border-hairline/50 bg-elevated px-4 py-3 text-center text-[16px] font-medium text-ink outline-none placeholder:text-ink-tertiary focus:border-accent-border focus:ring-2 focus:ring-accent/40"
        />
      </label>

      <div className="flex w-full max-w-md flex-col gap-3" data-wizard-quick-shapes="">
        <div className="text-center text-[12px] font-medium text-ink-secondary">{t("botWizard.quick.shape")}</div>
        <div role="radiogroup" aria-label={t("botWizard.quick.shape")} className="grid grid-cols-8 gap-2">
          {QUICK_SHAPES.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={shape === id}
              aria-label={t("botWizard.quick.shapeAria", { shape: id })}
              data-wizard-quick-shape={id}
              onClick={() => setShape(id)}
              className={cn(
                "flex size-10 items-center justify-center rounded-xl border transition-colors",
                shape === id ? "border-accent bg-accent/10 ring-2 ring-accent/40" : "border-hairline/40 hover:bg-hover",
              )}
            >
              <ShapeMascot shape={id} skin="plain" color={color} size={28} animated={false} detail="static" label={null} />
            </button>
          ))}
        </div>
      </div>

      <div className="flex w-full max-w-md flex-col gap-3" data-wizard-quick-colors="">
        <div className="text-center text-[12px] font-medium text-ink-secondary">{t("botWizard.quick.color")}</div>
        <div role="radiogroup" aria-label={t("botWizard.quick.color")} className="flex flex-wrap justify-center gap-2">
          {(QUICK_COLORS.length ? QUICK_COLORS : MAUS_COLOR_NAMES).map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={color === id}
              aria-label={t("botWizard.quick.colorAria", { color: id })}
              data-wizard-quick-color={id}
              onClick={() => setColor(id)}
              className={cn(
                "size-7 rounded-full border-2 transition-transform duration-150 hover:scale-110 active:scale-95",
                color === id ? "border-ink" : "border-transparent",
              )}
              style={swatchStyle(id)}
            />
          ))}
        </div>
      </div>

      <PrimaryButton
        data-wizard-quick-submit=""
        disabled={!canCreate}
        onClick={() => onCreate({ name: name.trim(), color, shape })}
        className="mt-1 w-full max-w-sm"
      >
        {busy ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            {t("botWizard.quick.creating")}
          </span>
        ) : (
          t("botWizard.quick.create")
        )}
      </PrimaryButton>

      {footer}
    </div>
  );
}
