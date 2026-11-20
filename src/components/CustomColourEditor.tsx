// The editor of a custom colour, duo-tone or mood (M-20261119-073, the
// owner: « custom color picker for Colour, Duo-tone, Mood »), opened from the
// custom swatch that ends each row of Settings > Appearance (SkinPicker.tsx).
// Colour: one colour; Duo-tone: two colours and the gradient's angle; Mood:
// its ground and two accents. Each colour is the system's colour well beside
// its hex code. Every change is worn at once (the whole window is the live
// preview), and the picker's own miniatures show it in light and in dark:
// they open the same skin context the custom sheet colours
// (src/lib/custom-colours.ts), where a label on the colour reads at 4.5:1.
import { useEffect, useId, useState, type ReactNode } from "react";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { parseCustomTint, type CustomTint } from "@/lib/custom-tint";
import { formatCustomTint } from "@/lib/custom-colours";
import { FIELD } from "./SettingsPrimitives";
import { cn } from "@/lib/cn";

type FieldKey = "color" | "from" | "to" | "ground";

const FIELDS: Record<CustomTint["kind"], { key: FieldKey; label: LocaleKey }[]> = {
  custom: [{ key: "color", label: "settings.skin.custom.color" }],
  "custom-duo": [
    { key: "from", label: "settings.skin.custom.from" },
    { key: "to", label: "settings.skin.custom.to" },
  ],
  "custom-mood": [
    { key: "ground", label: "settings.skin.custom.ground" },
    { key: "from", label: "settings.skin.custom.accentFrom" },
    { key: "to", label: "settings.skin.custom.accentTo" },
  ],
};

const HEX = /^#?([0-9a-fA-F]{6})$/;

function ColourField({ label, value, fieldKey, onChange }: { label: string; value: string; fieldKey: FieldKey; onChange: (hex: string) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <label htmlFor={id} className="text-[13px] leading-[18px] text-ink">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={value}
          data-custom-colour={fieldKey}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
          className="size-8 shrink-0 cursor-pointer rounded-full border-[0.5px] border-border bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0"
        />
        <input
          type="text"
          value={draft}
          spellCheck={false}
          maxLength={7}
          aria-label={t("settings.skin.custom.hex", { name: label })}
          data-custom-hex={fieldKey}
          onChange={(event) => {
            setDraft(event.target.value);
            const m = HEX.exec(event.target.value.trim());
            if (m) onChange(`#${m[1]!.toLowerCase()}`);
          }}
          onBlur={() => setDraft(value)}
          className={cn(FIELD, "w-[92px] font-mono")}
        />
      </div>
    </div>
  );
}

export function CustomColourEditor({ tint, onChange, preview }: {
  /** The custom tint worn, in its stored form (src/lib/custom-tint.ts). */
  tint: string;
  onChange: (next: string) => void;
  /** The light and dark miniatures of the worn family, drawn by the picker. */
  preview: ReactNode;
}) {
  const parsed = parseCustomTint(tint);
  if (!parsed) return null;
  const set = (patch: Partial<Record<FieldKey | "angle", string | number>>) => onChange(formatCustomTint({ ...parsed, ...patch } as CustomTint));
  const value = (key: FieldKey) => (parsed as unknown as Record<string, string>)[key]!;
  const angleId = `custom-angle-${parsed.kind}`;
  return (
    <div className="flex flex-col gap-3" data-custom-editor={parsed.kind}>
      <div className="flex flex-col gap-1">
        {FIELDS[parsed.kind].map((f) => (
          <ColourField key={f.key} fieldKey={f.key} label={t(f.label)} value={value(f.key)} onChange={(hex) => set({ [f.key]: hex })} />
        ))}
        {parsed.kind === "custom-duo" && (
          <div className="flex min-h-9 items-center justify-between gap-3">
            <label htmlFor={angleId} className="text-[13px] leading-[18px] text-ink">
              {t("settings.skin.custom.angle")}
            </label>
            <div className="flex items-center gap-2">
              <input
                id={angleId}
                type="range"
                min={0}
                max={359}
                step={1}
                value={parsed.angle}
                onChange={(event) => set({ angle: Number(event.target.value) })}
                className="w-[140px] accent-accent"
              />
              <span className="w-10 text-right text-[13px] tabular-nums text-ink-secondary">{parsed.angle}°</span>
            </div>
          </div>
        )}
      </div>
      <p className="m-0 text-[12px] leading-4 text-ink-secondary">{t("settings.skin.custom.preview")}</p>
      {preview}
    </div>
  );
}
