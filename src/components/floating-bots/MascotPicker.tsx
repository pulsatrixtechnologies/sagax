// The mascot picker (#5369): how a bot's look is chosen, modelled on the
// picker of the open-bot-avatar engine's site (its "Bot" card, 0.5.1). It is
// a small panel that opens right under the bot's mascot (MascotPickerPopover):
// no window and no preview of its own, the real mascot above it changes live.
//
//   A row of two pill tabs, Shapes and Characters, and a gear at the right
//   (the eyes follow the pointer; motion: System, Reduced, Full).
//   A grid of mascots, five to a row, in the bot's colour and material; the
//   one the bot wears is outlined. Shapes ends with a person's own shape and
//   a circled "+", which opens the small panel that adds one (generate from
//   a description, import a definition).
//   Two pills of icons: the material (plain, fluffy and glass faces, then
//   the skins, whose list opens from the pill) and the mood (neutral eyes,
//   happy eyes). No text: each icon has a name for a screen reader and a
//   tooltip. A control the character does not take is absent, never greyed.
//   The colour row: eleven quick colours, the free colour ring and the arrow
//   back to the colour the panel opened on.
//
// Every pick saves at once. The rules (what shows, what a pick saves) are in
// mascot-picker.ts.
import { useEffect, useId, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { Check, Lock, Plus, RotateCcw, Settings, Shirt, Upload } from "lucide-react";
import { characterLock, lockHint, reportAchievement, skinLock, useUnlocks, type LockInfo } from "@/lib/achievements";
import "@/components/achievements/achievements.css";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { MAUS_COLORS, type MausColor } from "@/lib/mascot";
import { relativeLuminance } from "../../../shared/mascot-colors";
import { MASCOT_SKIN_IDS, OWL_SKIN_TIER, botMascotSkin, type MascotSkinId } from "../../../shared/mascot-skins";
import { completeMascotLook, engineLookOf, SHAPE_MOTIONS, withEngineLook, type MascotCharacter, type MascotLook, type MascotShape, type ShapeMaterial, type ShapeMoodSetting, type ShapeMotion, type SkinTier } from "../../../shared/mascot-look";
import type { EngineAvatarReason } from "../../../shared/engine-avatar-def";
import { ShapeMascot } from "@/components/ShapeMascot";
import { materialsSupported } from "@/components/shape-material";
import { bakedShapeFor } from "@/components/shape-avatar";
import { AnchoredPopover } from "@/components/AnchoredPopover";
import { MENU_BOX } from "@/components/menu-look";
import { PillTabs } from "@/components/PillTabs";
import { SegmentedChoice } from "@/components/SegmentedChoice";
import { Switch } from "@/components/SettingsPrimitives";
import { useReducedMotion } from "@/components/skin-fx/skin-fx";
import "@/components/skin-fx/skin-fx.css";
import { skinTierTabs } from "./editor-tabs";
import { CHARACTER_LABEL, OWL_SKIN_LABEL, SHAPE_LABEL, SKIN_TIER_LABEL } from "./mascot-look-labels";
import { MASCOTS, SHAPE_CHOICES, type CompleteLook } from "./mascots";
import { bodyColorOf, characterPatch, colorPatch, materialPatch, pastedShapeLook, pickerColor, pickerControls, PICKER_TABS, QUICK_COLORS, shapePatch, skinPatch, tabOf, type PickerPatch, type PickerTab } from "./mascot-picker";
import { CHARACTER_SKINS, skinPreview } from "./skin-catalog";
import { wardrobeStep } from "./wardrobe";
import "./mascot-picker.css";

/** A small panel of the picker open over it: the skins list, the gear's settings, the "+" panel. */
export type PickerLayer = "skins" | "gear" | "add";

export interface MascotPickerProps {
  bot: { id?: string; name?: string; color: MausColor; mascotSkin?: MascotSkinId | null; mascotLook?: MascotLook | null };
  disabled?: boolean;
  onPatch: (patch: PickerPatch) => void;
  /**
   * Asks a model of the app for a shape from a description and answers its
   * reply (the definition's JSON). Without it the "+" panel offers the import alone.
   */
  onGenerate?: (description: string) => Promise<string>;
  /** The tab it opens on (the one the bot's character sits under unless told; a gallery or a test opens another). */
  initialTab?: PickerTab;
  /** A small panel open from the start (a gallery, a capture). */
  initialLayer?: PickerLayer;
  /** Every thumbnail live, or only the one under the pointer (the default, see gridLive). */
  live?: "all" | "hover";
}

/**
 * How the grid's thumbnails live. Fifty live mascots at once cost too much
 * (measured by scripts/capture/mascot-picker.mjs, written in docs/mascots.md):
 * the grid draws stills and the mascot under the pointer comes alive.
 */
let gridLive: "all" | "hover" = "hover";

/** For the measuring gallery only: every thumbnail live. */
export function setGridLiveForMeasure(mode: "all" | "hover") {
  gridLive = mode;
}

const PICKER_TAB_LABEL = {
  shapes: "mascotPicker.tab.shapes",
  characters: "mascotPicker.tab.characters",
} satisfies Record<PickerTab, LocaleKey>;

export const QUICK_COLOR_LABEL = {
  white: "mascotPicker.color.white",
  brown: "mascotPicker.color.brown",
  red: "mascotPicker.color.red",
  orange: "mascotPicker.color.orange",
  amber: "mascotPicker.color.amber",
  green: "mascotPicker.color.green",
  teal: "mascotPicker.color.teal",
  blue: "mascotPicker.color.blue",
  purple: "mascotPicker.color.purple",
  pink: "mascotPicker.color.pink",
  grey: "mascotPicker.color.grey",
} satisfies Record<(typeof QUICK_COLORS)[number], LocaleKey>;

const MATERIAL_LABEL = {
  flat: "appearance.material.flat",
  fluffy: "appearance.material.fluffy",
  glass: "appearance.material.glass",
} satisfies Record<ShapeMaterial, LocaleKey>;

const MOOD_LABEL = {
  neutral: "appearance.mood.neutral",
  happy: "appearance.mood.happy",
} satisfies Record<ShapeMoodSetting, LocaleKey>;

const MOTION_LABEL = {
  system: "mascotPicker.motion.system",
  reduced: "mascotPicker.motion.reduced",
  full: "mascotPicker.motion.full",
} satisfies Record<ShapeMotion, LocaleKey>;

/** Each reason a definition is refused, said in the person's language. */
export const PASTE_REASON_LABEL = {
  json: "appearance.shape.pasteReason.json",
  fields: "appearance.shape.pasteReason.fields",
  path: "appearance.shape.pasteReason.path",
  outside: "appearance.shape.pasteReason.outside",
  small: "appearance.shape.pasteReason.small",
  eyesOutside: "appearance.shape.pasteReason.eyesOutside",
  eyesSize: "appearance.shape.pasteReason.eyesSize",
} as const satisfies Record<EngineAvatarReason, LocaleKey>;

/** The rainbow rim of the free colour ring, from the bot colours. */
const RAINBOW = (["red", "amber", "green", "teal", "blue", "purple", "pink", "red"] as const).map((name) => MAUS_COLORS[name]).join(", ");

/* ------------------------------------------------------------- icons */

// The upstream picker's drawings (apps/site/src/studio/pickers.tsx), as they are.
const SMOOTH_FACE = "M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0ZM8.9 10.2a1 1 0 0 1 2 0v3.2a1 1 0 0 1-2 0ZM13.1 10.2a1 1 0 0 1 2 0v3.2a1 1 0 0 1-2 0Z";
const FURRY_FACE = "M5.7 12a6.3 6.3 0 1 0 12.6 0a6.3 6.3 0 1 0-12.6 0ZM9.1 10.3a.95.95 0 0 1 1.9 0v2.9a.95.95 0 0 1-1.9 0ZM13 10.3a.95.95 0 0 1 1.9 0v2.9a.95.95 0 0 1-1.9 0Z";
const FUR =
  "M17.8 11.6 21.2 11M17.7 13.3 20.8 14.1M17.1 14.8 19.7 16.8M16.1 16.1 18.1 18.5M14.7 17.1 16 19.3M13.3 17.6 14.9 20.4M11.9 17.8 11.1 20.5M10.3 17.5 9.6 19.8M8.8 16.9 6.9 19.3M7.9 16.1 4.9 17.8M7 15 4.5 15.9M6.4 13.6 4.2 14.6M6.2 12.1 3.7 11.4M6.4 10.5 3.6 8.9M6.8 9.4 4.6 8.2M7.9 7.9 5.6 6.3M9.4 6.8 8.2 4.9M10.4 6.4 10.3 3.3M12 6.2 11.9 3.8M13.3 6.4 13.8 3.7M14.8 6.9 16.4 4.4M16 7.8 18.3 5.2M17.2 9.3 20 8.2M17.6 10.5 20.5 10.1";

function EyesGlyph({ mood }: { mood: ShapeMoodSetting }) {
  return (
    <svg className="mp-glyph" data-glyph={`eyes-${mood}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {mood === "happy" ? (
        <path d="M4.5 15c.9-4.6 5.1-4.6 6 0M13.5 15c.9-4.6 5.1-4.6 6 0" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      ) : (
        <>
          <rect x="6" y="6.5" width="3.8" height="11" rx="1.9" fill="currentColor" />
          <rect x="14.2" y="6.5" width="3.8" height="11" rx="1.9" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

function FaceGlyph({ material }: { material: ShapeMaterial }) {
  if (material === "glass") {
    return (
      <svg className="mp-glyph" data-glyph="face-glass" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <g className="mp-glint" style={{ transformBox: "view-box", transformOrigin: "12px 12px" }}>
          <path d="M8.1 8.3a5.4 5.4 0 0 1 4.6-1.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </g>
        <rect x="9" y="10.4" width="1.9" height="3.2" rx="0.95" fill="currentColor" />
        <rect x="13.1" y="10.4" width="1.9" height="3.2" rx="0.95" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg className="mp-glyph" data-glyph={`face-${material}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={material === "fluffy" ? FURRY_FACE : SMOOTH_FACE} fill="currentColor" fillRule="evenodd" />
      {material === "fluffy" ? <path className="mp-fur" style={{ transformBox: "view-box", transformOrigin: "12px 12px" }} d={FUR} fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" /> : null}
    </svg>
  );
}

/* ------------------------------------------------------------- pieces */

/**
 * A small panel of the picker gets out of the way on Escape or a press
 * outside it and its trigger. It hears Escape before the panel under it
 * (capture) and marks it handled, so one Escape closes one layer.
 */
function useLayerDismiss(open: boolean, inside: readonly RefObject<HTMLElement | null>[], close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  const refs = useRef(inside);
  refs.current = inside;
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && refs.current.some((ref) => ref.current?.contains(target))) return;
      closeRef.current();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);
}

/** The surface of a small panel of the picker (the menu family's box); `data-mascot-picker-layer` keeps a press in it inside the picker. */
function Layer({ anchorRef, popoverRef, label, name, align = "start", maxHeight, className, children }: { anchorRef: RefObject<HTMLElement | null>; popoverRef: RefObject<HTMLElement | null>; label: string; name: PickerLayer; align?: "start" | "end"; maxHeight?: number; className?: string; children: ReactNode }) {
  return (
    <AnchoredPopover anchorRef={anchorRef} popoverRef={popoverRef} side="bottom" align={align} gap={6} maxHeight={maxHeight} role="dialog" aria-label={label} data-mascot-picker-layer={name} className={cn(MENU_BOX, "flex flex-col overflow-y-auto", className)}>
      {children}
    </AnchoredPopover>
  );
}

/**
 * A pill of icons, one radio group: one stop in the tab order, the arrow keys
 * move the choice. `extra` is a last segment that is no choice of the group
 * (the skins, which open a list). An icon is "live" (it plays its small move)
 * while hovered or focused, and for a moment after it is chosen.
 */
function IconPill<T extends string>({ label, value, options, onPick, disabled, data, extra }: {
  label: string;
  value: T | null;
  options: readonly { value: T; label: string; icon: ReactNode }[];
  onPick: (value: T) => void;
  disabled?: boolean;
  data: string;
  extra?: ReactNode;
}) {
  const [live, setLive] = useState<T | null>(null);
  const [chosen, setChosen] = useState<T | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const pick = (next: T) => {
    onPick(next);
    setChosen(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setChosen(null), 480);
  };
  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const at = Math.max(0, options.findIndex((option) => option.value === value));
    const last = options.length - 1;
    const to = event.key === "ArrowRight" || event.key === "ArrowDown" ? (at + 1) % options.length
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? (at + last) % options.length
      : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    if (to < 0 || disabled || !(event.target as HTMLElement).matches("[role=radio]")) return;
    event.preventDefault();
    event.stopPropagation();
    pick(options[to]!.value);
    event.currentTarget.querySelectorAll<HTMLElement>("[role=radio]")[to]?.focus();
  };
  return (
    <div className="mp-pill" role="radiogroup" aria-label={label} onKeyDown={onKey} {...{ [data]: "" }}>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.label}
            title={option.label}
            disabled={disabled}
            tabIndex={checked || (value === null && index === 0) ? 0 : -1}
            data-option={option.value}
            data-live={live === option.value || chosen === option.value ? "" : undefined}
            onClick={() => pick(option.value)}
            onPointerEnter={() => setLive(option.value)}
            onPointerLeave={() => setLive((now) => (now === option.value ? null : now))}
            onFocus={() => setLive(option.value)}
            onBlur={() => setLive((now) => (now === option.value ? null : now))}
            className="mp-seg"
          >
            {option.icon}
          </button>
        );
      })}
      {extra}
    </div>
  );
}

/** A locked look's lock on its tile: the padlock, and how far its achievement went. */
function LockBadge({ lock }: { lock: LockInfo }) {
  const item = lock.item;
  return (
    <>
      <span className="unlock-lock" aria-hidden="true"><Lock size={10} strokeWidth={2.6} /></span>
      {item && item.target > 0 && (
        <span className="unlock-progress" aria-hidden="true">
          <span style={{ width: `${Math.round((item.current / item.target) * 100)}%` }} />
        </span>
      )}
    </>
  );
}

const THUMB = 52;
const field = "block w-full rounded-xl border border-hairline-weak bg-inset px-3 py-2 text-[13px] leading-5 text-ink outline-none placeholder:text-ink-tertiary focus:border-hairline";
const button = "inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-control px-3 text-[13px] leading-4 text-ink outline-none transition-colors hover:bg-raised-hover focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50";
const primary = "inline-flex h-8 items-center justify-center gap-1.5 rounded-full bg-ink px-3 text-[13px] font-medium leading-4 text-app outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40";

/**
 * The "+" panel: the two ways to add a shape of one's own, after the
 * upstream picker's Generate and Import screens, without their tabs. Generate
 * asks a model of the app (through `onGenerate`) and adds what it draws;
 * Import takes a definition's JSON, pasted, typed or dropped as a file. Either
 * way the engine checks the definition before it becomes the bot's shape.
 */
function AddShapePanel({ onAdd, onGenerate, disabled }: { onAdd: (text: string) => EngineAvatarReason[] | null; onGenerate?: (description: string) => Promise<string>; disabled?: boolean }) {
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateFailed, setGenerateFailed] = useState(false);
  const [text, setText] = useState("");
  const [reasons, setReasons] = useState<EngineAvatarReason[] | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const ids = useId();
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const add = (source: string) => {
    setFileProblem(null);
    setReasons(onAdd(source));
  };
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 256 * 1024) {
      setReasons(null);
      setFileProblem(t("mascotPicker.add.tooLarge", { name: file.name }));
      return;
    }
    const content = await file.text();
    setText(content);
    add(content);
  };
  const generate = async () => {
    if (!onGenerate || generating || !description.trim()) return;
    setGenerating(true);
    setGenerateFailed(false);
    try {
      const reply = await onGenerate(description.trim());
      if (!alive.current) return;
      // a reply the engine cannot draw is never added: the person is told, and may try other words
      if (onAdd(reply)) setGenerateFailed(true);
    } catch {
      if (alive.current) setGenerateFailed(true);
    } finally {
      if (alive.current) setGenerating(false);
    }
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void readFile(event.dataTransfer.files[0]);
  };

  return (
    <div className="flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-3 p-3" data-mascot-add="">
      {onGenerate && (
        <section className="flex flex-col gap-2" data-mascot-add-generate="">
          <textarea
            className={cn(field, "resize-none")}
            rows={2}
            maxLength={400}
            value={description}
            disabled={disabled || generating}
            aria-label={t("mascotPicker.add.describe")}
            placeholder={t("mascotPicker.add.describe")}
            onChange={(event) => { setDescription(event.target.value); setGenerateFailed(false); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void generate(); }
            }}
          />
          <button type="button" className={cn(primary, "w-full")} disabled={disabled || generating || !description.trim()} aria-busy={generating} data-mascot-generate="" onClick={() => void generate()}>
            {generating ? t("mascotPicker.add.generating") : t("mascotPicker.add.generate")}
          </button>
          {generateFailed && <p role="alert" className="m-0 text-[12px] leading-4 text-danger" data-mascot-generate-failed="">{t("mascotPicker.add.generateFailed")}</p>}
          <div className="menu-divider mt-1 h-px w-full" aria-hidden="true" />
        </section>
      )}
      <section className="flex flex-col gap-2" data-mascot-add-import="">
        <p id={`${ids}-lead`} className="m-0 text-[12px] leading-[18px] text-ink-secondary">{t("mascotPicker.add.importLead")}</p>
        <div className="relative" onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
          <textarea
            className={cn(field, "resize-none whitespace-pre font-mono text-[12px] leading-[18px]")}
            rows={5}
            spellCheck={false}
            value={text}
            disabled={disabled}
            aria-label={t("mascotPicker.add.definition")}
            aria-describedby={`${ids}-lead ${ids}-result`}
            placeholder={'{\n  "version": 1, "id": "controller",\n  "name": "Controller", "body": { … },\n  "eyes": { "x": 50, "y": 46, … }\n}'}
            onChange={(event) => { setText(event.target.value); setReasons(null); setFileProblem(null); }}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData("text");
              // a whole-field paste is checked right away; a partial edit waits for the button
              if (pasted && (text.trim() === "" || event.currentTarget.selectionEnd - event.currentTarget.selectionStart === text.length)) {
                event.preventDefault();
                setText(pasted);
                add(pasted);
              }
            }}
          />
          {dragging && <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl border border-dashed border-hairline bg-panel/90 text-[13px] text-ink">{t("mascotPicker.add.drop")}</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primary} disabled={disabled || !text.trim()} data-mascot-import="" onClick={() => add(text)}>{t("mascotPicker.add.import")}</button>
          <button type="button" className={button} disabled={disabled} onClick={() => fileInput.current?.click()}>
            <Upload size={14} aria-hidden="true" />
            {t("mascotPicker.add.chooseFile")}
          </button>
          {text && (
            <button type="button" className={cn(button, "bg-transparent text-ink-secondary")} onClick={() => { setText(""); setReasons(null); setFileProblem(null); }}>{t("mascotPicker.add.clear")}</button>
          )}
          <input ref={fileInput} type="file" accept="application/json,.json,text/plain" hidden onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ""; }} />
        </div>
        <div id={`${ids}-result`} aria-live="polite">
          {fileProblem && <p role="alert" className="m-0 text-[12px] leading-4 text-danger">{fileProblem}</p>}
          {reasons && reasons.length > 0 && (
            <ul role="alert" className="m-0 flex list-disc flex-col gap-1 pl-4 text-[12px] leading-4 text-danger" data-mascot-import-reasons="">
              {reasons.map((reason) => <li key={reason} data-reason={reason}>{t(PASTE_REASON_LABEL[reason])}</li>)}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

/** The skins of the character the bot wears, by rarity: each with its padlock and, locked, the line that names the achievement which unlocks it. */
function SkinsList({ character, look, color, owlSkin, unlocks, disabled, onPick }: { character: MascotCharacter; look: CompleteLook; color: string; owlSkin: MascotSkinId; unlocks: ReturnType<typeof useUnlocks>; disabled?: boolean; onPick: (skin: string) => void }) {
  const skins: readonly string[] = character === "owl" ? MASCOT_SKIN_IDS : CHARACTER_SKINS[character].skins;
  const tierOf = (character === "owl" ? OWL_SKIN_TIER : CHARACTER_SKINS[character].tierOf) as Readonly<Record<string, SkinTier>>;
  const labelOf = (skin: string) => t(character === "owl" ? OWL_SKIN_LABEL[skin as MascotSkinId] : CHARACTER_SKINS[character].label[skin]!);
  const worn = character === "owl" ? owlSkin : look.skins[character];
  // on a shape, a material stands in place of the skin: none reads as worn until a skin is picked
  const painted = character === "shape" && engineLookOf(look).material !== "flat" && materialsSupported();
  return (
    <div className="flex w-[280px] max-w-[calc(100vw-32px)] flex-col gap-1 p-1.5" role="radiogroup" aria-label={t("mascot.skin.title")} data-mascot-skins={character}>
      {skinTierTabs(skins, tierOf).map((group) => (
        <div key={group.tier} className="flex flex-col gap-0.5" data-skin-tier-group={group.tier}>
          <div className="flex items-baseline gap-1.5 px-2 pb-0.5 pt-1.5 text-[11px] font-medium leading-4 text-ink-tertiary">
            <span>{t(SKIN_TIER_LABEL[group.tier])}</span>
            <span className="tabular-nums" aria-hidden="true">{group.count}</span>
          </div>
          {group.skins.map((skin) => {
            const checked = !painted && skin === worn;
            const lock: LockInfo = skin === worn ? { locked: false } : skinLock(unlocks, character, skin);
            const name = labelOf(skin);
            const tier = t(SKIN_TIER_LABEL[group.tier]);
            const hint = lock.locked ? lockHint(lock) : "";
            return (
              <button
                key={skin}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-disabled={lock.locked || undefined}
                disabled={disabled}
                aria-label={lock.locked ? t("mascot.skinCard.locked", { name, tier, hint }) : `${name}, ${tier}`}
                data-skin-option={skin}
                data-tier={group.tier}
                data-locked={lock.locked ? "" : undefined}
                data-unlock-achievement={lock.locked ? lock.achievement?.id : undefined}
                onClick={() => { if (!lock.locked) onPick(skin); }}
                className={cn("skin-card relative flex min-h-11 w-full items-center gap-2.5 rounded-[10px] px-2 py-1 text-left outline-none transition-colors hover:bg-menu-hover focus-visible:bg-menu-hover", checked && "bg-menu-active", lock.locked && "cursor-default")}
              >
                <span className={cn("grid size-9 shrink-0 place-items-center overflow-hidden", lock.locked && "opacity-60 grayscale")} aria-hidden="true">
                  {/* the owl plays its skin from 36 px up (OWL_DETAIL_MIN_SIZE): it fills its box so every card is a live preview */}
                  {skinPreview(character, skin, look, color as MausColor, character === "owl" ? 36 : 32)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] leading-[18px] text-ink">{name}</span>
                  {lock.locked && <span className="text-[11px] leading-4 text-ink-secondary" data-skin-unlock-hint="">{hint}</span>}
                </span>
                {lock.locked ? <Lock size={13} className="shrink-0 text-ink-tertiary" aria-hidden="true" /> : checked ? <Check size={14} className="shrink-0 text-ink" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- the picker */

export default function MascotPicker({ bot, disabled, onPatch: savePatch, onGenerate, initialTab, initialLayer, live = gridLive }: MascotPickerProps) {
  const look = completeMascotLook(bot.mascotLook);
  const settings = engineLookOf(look);
  const owlSkin = botMascotSkin(bot.mascotSkin);
  const unlocks = useUnlocks();
  const character = look.character;
  const controls = pickerControls(character, { materials: materialsSupported() });
  const color = pickerColor(bot);
  const body = bodyColorOf(bot);
  const systemReduced = useReducedMotion();

  const onPatch = (patch: PickerPatch) => {
    savePatch(patch);
    reportAchievement("bot.customized", { key: patch.mascotLook?.character ?? character });
  };

  const [tab, setTab] = useState<PickerTab>(initialTab ?? tabOf(character));
  const [layer, setLayer] = useState<PickerLayer | null>(initialLayer ?? null);
  const [hovered, setHovered] = useState<string | null>(null);
  // the colour the panel opened on: where the back arrow returns
  const opened = useRef({ color: bot.color as string, bodyColor: settings.bodyColor });
  const changed = bot.color !== opened.current.color || settings.bodyColor !== opened.current.bodyColor;

  const gearRef = useRef<HTMLButtonElement>(null);
  const skinsRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLElement>(null);
  const anchorOf = { gear: gearRef, skins: skinsRef, add: addRef } satisfies Record<PickerLayer, RefObject<HTMLButtonElement | null>>;
  useLayerDismiss(layer !== null, [layerRef, layer ? anchorOf[layer] : layerRef], () => setLayer(null));
  const toggle = (next: PickerLayer) => setLayer((now) => (now === next ? null : next));
  const wearsShape = character === "shape";
  // Shapes is a character an achievement gives: until then its grid shows what waits, and nothing in it is worn or added
  const shapesLock: LockInfo = wearsShape ? { locked: false } : characterLock(unlocks, "shape");
  // a layer whose trigger is gone (another tab, another character) closes with it
  useEffect(() => {
    if (layer === "add" && (tab !== "shapes" || shapesLock.locked)) setLayer(null);
    if (layer === "gear" && !controls.gear) setLayer(null);
  }, [layer, tab, controls.gear, shapesLock.locked]);

  // a person's own shape (imported, generated, or an earlier drawing that is no catalog shape) is a tile of its own
  const ownShape = look.avatarDef && !bakedShapeFor(look.shape, look.avatarDef) ? look.avatarDef : null;
  const ownShapeName = ownShape ? (ownShape.name ?? t("appearance.shape.own")) : "";
  const shapesHint = shapesLock.locked ? lockHint(shapesLock) : "";
  const shapeCell = (name: string) => ({
    "data-locked": shapesLock.locked ? "" : undefined,
    "data-unlock-achievement": shapesLock.locked ? shapesLock.achievement?.id : undefined,
    "aria-disabled": shapesLock.locked || undefined,
    "aria-label": shapesLock.locked ? t("appearance.tile.locked", { name, hint: shapesHint }) : name,
    title: shapesLock.locked ? `${name}. ${shapesHint}` : name,
  });
  // Trombi is an easter egg: out of the grid until found, unless the bot wears him
  const characters = MASCOTS.filter((option) => option.id !== "shape" && (option.id !== "trombi" || character === "trombi" || !characterLock(unlocks, "trombi").locked));

  const grid = useRef<HTMLDivElement>(null);
  const onCellKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const cells = Array.from(grid.current?.querySelectorAll<HTMLButtonElement>("[data-mascot-cell]") ?? []);
    const next = wardrobeStep(cells.indexOf(event.currentTarget), cells.length, 5, event.key);
    if (next === null) return;
    event.preventDefault();
    cells[next]?.focus();
  };
  // the grid opens on the mascot the bot wears, centred if it is out of view; only the grid scrolls
  useEffect(() => {
    const box = grid.current;
    const cell = box?.querySelector<HTMLElement>('[data-mascot-cell][aria-pressed="true"]');
    if (!box || !cell) return;
    const b = box.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    if (c.top < b.top || c.bottom > b.bottom) box.scrollTop += c.top - b.top - (b.height - c.height) / 2;
  }, [tab]);

  const hover = (key: string) => ({
    onPointerEnter: (event: { pointerType: string }) => { if (event.pointerType === "mouse") setHovered(key); },
    onPointerLeave: () => setHovered((now) => (now === key ? null : now)),
  });
  const alive = (key: string) => live === "all" || hovered === key;
  const shapeThumb = (key: string, shape: MascotShape, avatarDef?: CompleteLook["avatarDef"]) => (
    <ShapeMascot
      shape={shape}
      skin={look.skins.shape}
      color={body}
      size={THUMB}
      animated={alive(key)}
      detail={alive(key) ? "full" : "static"}
      engineLook={{ material: settings.material, mood: settings.mood, eyeColor: settings.eyeColor, depth: settings.depth, motion: settings.motion }}
      trackPointer={false}
      avatarDef={avatarDef}
      label={null}
    />
  );

  const addDefinition = (text: string): EngineAvatarReason[] | null => {
    const added = pastedShapeLook(look, text);
    if (!added.ok) return added.reasons;
    onPatch({ mascotLook: added.mascotLook });
    setLayer(null);
    return null;
  };

  const skinsSegment = controls.skins ? (
    <button
      ref={skinsRef}
      type="button"
      aria-label={t("mascot.skin.title")}
      title={t("mascot.skin.title")}
      aria-haspopup="dialog"
      aria-expanded={layer === "skins"}
      // on a shape the skin is what Flat wears: the segment reads as chosen beside Flat's own skin
      data-on={wearsShape && settings.material === "flat" && look.skins.shape !== "plain" ? "" : undefined}
      data-mascot-skins-open=""
      disabled={disabled}
      onClick={() => toggle("skins")}
      className="mp-seg"
    >
      <Shirt className="mp-glyph" data-glyph="skins" strokeWidth={1.9} aria-hidden="true" />
    </button>
  ) : null;

  const motionHint = settings.motion === "system"
    ? t(systemReduced ? "mascotPicker.motion.hint.systemReduced" : "mascotPicker.motion.hint.systemFull")
    : t(settings.motion === "reduced" ? "mascotPicker.motion.hint.reduced" : "mascotPicker.motion.hint.full");

  return (
    <div className="mascot-picker flex w-[440px] max-w-[calc(100vw-16px)] flex-col" data-mascot-picker="" data-mascot-picker-character={character}>
      {/* the tabs, and the gear at their right */}
      <div className="flex items-center justify-between gap-2 p-2">
        <PillTabs
          tabs={PICKER_TABS}
          tab={tab}
          onTab={setTab}
          idPrefix="mascot-picker"
          ariaLabel={t("appearance.tabs")}
          data-mascot-picker-tabs=""
          tabAttributes={(id) => ({ "data-mascot-picker-tab": id })}
          tabClassName={() => "px-3 py-1.5 text-[14px]"}
          label={(id) => t(PICKER_TAB_LABEL[id])}
        />
        {controls.gear && (
          <button
            ref={gearRef}
            type="button"
            aria-label={t("mascotPicker.settings")}
            title={layer === "gear" ? undefined : t("mascotPicker.settings")}
            aria-haspopup="dialog"
            aria-expanded={layer === "gear"}
            data-mascot-picker-gear=""
            onClick={() => toggle("gear")}
            className={cn("grid size-8 shrink-0 place-items-center rounded-full text-ink-secondary outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent", layer === "gear" && "bg-ink/[0.1] text-ink")}
          >
            <Settings size={17} strokeWidth={1.8} aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="menu-divider h-px w-full" aria-hidden="true" />

      {/* the grid: only it scrolls */}
      <div ref={grid} id={`mascot-picker-panel-${tab}`} role="tabpanel" aria-labelledby={`mascot-picker-tab-${tab}`} data-mascot-picker-grid={tab} className="max-h-[286px] overflow-y-auto px-3 py-2.5">
        <div className="grid grid-cols-5">
          {tab === "shapes" && SHAPE_CHOICES.map((shape) => {
            const on = wearsShape && !ownShape && look.shape === shape;
            const name = t(SHAPE_LABEL[shape]);
            return (
              <button key={shape} type="button" className="mp-cell relative" data-mascot-cell="" data-character-shape={shape} aria-pressed={on} {...shapeCell(name)} disabled={disabled} onKeyDown={onCellKey} onClick={() => { if (!shapesLock.locked) onPatch(shapePatch(look, shape, bot.color)); }} {...hover(shape)}>
                {shapesLock.locked ? <span className="grid place-items-center opacity-60 grayscale">{shapeThumb(shape, shape)}</span> : shapeThumb(shape, shape)}
                {shapesLock.locked && <LockBadge lock={shapesLock} />}
              </button>
            );
          })}
          {tab === "shapes" && ownShape && (
            <button type="button" className="mp-cell relative" data-mascot-cell="" data-own-shape="" aria-pressed={wearsShape} {...shapeCell(t("appearance.shape.ownNamed", { name: ownShapeName }))} title={shapesLock.locked ? `${ownShapeName}. ${shapesHint}` : ownShapeName} disabled={disabled} onKeyDown={onCellKey} onClick={() => { if (!wearsShape && !shapesLock.locked) onPatch(characterPatch(look, "shape")); }} {...hover("own")}>
              {shapesLock.locked ? <span className="grid place-items-center opacity-60 grayscale">{shapeThumb("own", look.shape, ownShape)}</span> : shapeThumb("own", look.shape, ownShape)}
              {shapesLock.locked && <LockBadge lock={shapesLock} />}
            </button>
          )}
          {tab === "shapes" && !shapesLock.locked && (
            <button ref={addRef} type="button" className="mp-cell" data-mascot-cell="" data-mascot-add-open="" aria-label={t("mascotPicker.add.title")} title={layer === "add" ? undefined : t("mascotPicker.add.title")} aria-haspopup="dialog" aria-expanded={layer === "add"} disabled={disabled} onKeyDown={onCellKey} onClick={() => toggle("add")}>
              <span className="mp-plus"><Plus size={20} strokeWidth={1.8} aria-hidden="true" /></span>
            </button>
          )}
          {tab === "characters" && characters.map((option) => {
            const on = character === option.id;
            const lock: LockInfo = on ? { locked: false } : characterLock(unlocks, option.id);
            const name = t(CHARACTER_LABEL[option.id]);
            const hint = lock.locked ? lockHint(lock) : "";
            return (
              <button
                key={option.id}
                type="button"
                className="mp-cell relative"
                data-mascot-cell=""
                data-character-option={option.id}
                data-locked={lock.locked ? "" : undefined}
                data-unlock-achievement={lock.locked ? lock.achievement?.id : undefined}
                aria-pressed={on}
                aria-disabled={lock.locked || undefined}
                aria-label={lock.locked ? t("appearance.tile.locked", { name, hint }) : name}
                title={lock.locked ? `${name}. ${hint}` : name}
                disabled={disabled}
                onKeyDown={onCellKey}
                onClick={() => { if (!lock.locked && !on) onPatch(characterPatch(look, option.id)); }}
              >
                <span className={cn("grid place-items-center overflow-hidden", lock.locked && "opacity-60 grayscale")} style={{ width: THUMB, height: THUMB }} aria-hidden="true">
                  <option.Thumb color={option.paint.colors ? body : bot.color} skin={owlSkin} look={{ ...look, character: option.id }} size={THUMB - 4} />
                </span>
                {lock.locked && <LockBadge lock={lock} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* the pills: the material (and the skins) on the left, the mood on the right */}
      <div className="menu-divider h-px w-full" aria-hidden="true" />
      <div className="flex items-center justify-between gap-2 px-3 py-2" data-mascot-picker-pills="">
        <IconPill
          label={t("appearance.tab.material")}
          data="data-mascot-material"
          value={controls.materials.length ? settings.material : null}
          disabled={disabled}
          options={controls.materials.map((material) => ({ value: material, label: t(MATERIAL_LABEL[material]), icon: <FaceGlyph material={material} /> }))}
          onPick={(material) => onPatch(materialPatch(look, material))}
          extra={skinsSegment}
        />
        {controls.mood && (
          <IconPill
            label={t("appearance.mood.title")}
            data="data-mascot-mood"
            value={settings.mood}
            disabled={disabled}
            options={(["neutral", "happy"] as const).map((mood) => ({ value: mood, label: t(MOOD_LABEL[mood]), icon: <EyesGlyph mood={mood} /> }))}
            onPick={(mood) => onPatch({ mascotLook: withEngineLook(look, { mood }) as MascotLook })}
          />
        )}
      </div>

      {/* the colours: eleven quick ones, the free colour, the way back */}
      {controls.colors && (
        <>
          <div className="menu-divider h-px w-full" aria-hidden="true" />
          <div className="flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2 px-3 pb-3.5 pt-3" role="group" aria-label={t("mascotPicker.color.group", { name: bot.name ?? "" })} data-mascot-picker-colors="" style={{ "--mp-rainbow": RAINBOW } as CSSProperties}>
            {QUICK_COLORS.map((name) => (
              <button
                key={name}
                type="button"
                className="mp-swatch"
                style={{ "--mp-swatch": MAUS_COLORS[name] } as CSSProperties}
                data-mascot-color={name}
                data-edge={relativeLuminance(MAUS_COLORS[name]) > 0.8 || relativeLuminance(MAUS_COLORS[name]) < 0.035 ? "" : undefined}
                aria-label={t(QUICK_COLOR_LABEL[name])}
                title={t(QUICK_COLOR_LABEL[name])}
                aria-pressed={color.quick === name}
                disabled={disabled}
                onClick={() => onPatch(colorPatch(look, name))}
              />
            ))}
            {/* any colour: the system picker, the mascot following it as it moves */}
            <label className="mp-swatch mp-swatch-custom" data-on={color.custom ? "" : undefined} data-mascot-color-custom="" style={color.custom ? ({ "--mp-swatch": color.hex } as CSSProperties) : undefined} title={color.custom ? t("mascotPicker.color.customNamed", { color: color.hex }) : t("mascotPicker.color.custom")}>
              <input type="color" aria-label={t("mascotPicker.color.custom")} value={color.hex} disabled={disabled} onChange={(event) => onPatch(colorPatch(look, event.target.value))} />
            </label>
            <button
              type="button"
              className="mp-swatch mp-swatch-reset"
              data-mascot-color-reset=""
              aria-label={t("mascotPicker.color.reset")}
              title={changed ? t("mascotPicker.color.reset") : undefined}
              disabled={disabled || !changed}
              onClick={() => onPatch(colorPatch(look, opened.current))}
            >
              <RotateCcw size={14} strokeWidth={1.9} aria-hidden="true" />
            </button>
          </div>
        </>
      )}

      {layer === "gear" && controls.gear && (
        <Layer anchorRef={gearRef} popoverRef={layerRef} name="gear" align="end" label={t("mascotPicker.settings")} className="w-[288px] py-1">
          <span className="px-4 pb-1.5 pt-2 text-[12px] font-medium leading-4 text-ink-tertiary">{t("mascotPicker.settings")}</span>
          <label className="flex cursor-pointer items-start justify-between gap-3 border-t border-hairline-weak px-4 py-3" data-mascot-follow-pointer="">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[14px] leading-5 text-ink">{t("appearance.eyes.follow")}</span>
              <span className="text-[12px] leading-4 text-ink-tertiary">{t("mascotPicker.follow.hint")}</span>
            </span>
            <Switch checked={settings.followPointer} disabled={disabled} aria-label={t("appearance.eyes.follow")} className="mt-px" onClick={() => onPatch({ mascotLook: withEngineLook(look, { followPointer: !settings.followPointer }) as MascotLook })} />
          </label>
          <div className="flex flex-col gap-2.5 border-t border-hairline-weak px-4 py-3" data-mascot-motion="">
            <span className="flex flex-col gap-0.5">
              <span className="text-[14px] leading-5 text-ink">{t("mascotPicker.motion.title")}</span>
              <span className="text-[12px] leading-4 text-ink-tertiary" data-mascot-motion-hint="">{motionHint}</span>
            </span>
            <SegmentedChoice
              label={t("mascotPicker.motion.title")}
              fill
              disabled={disabled}
              value={settings.motion}
              options={SHAPE_MOTIONS.map((motion) => ({ value: motion, label: t(MOTION_LABEL[motion]), data: { "data-mascot-motion-option": motion } }))}
              onPick={(motion) => onPatch({ mascotLook: withEngineLook(look, { motion }) as MascotLook })}
            />
          </div>
        </Layer>
      )}
      {layer === "skins" && (
        <Layer anchorRef={skinsRef} popoverRef={layerRef} name="skins" label={t("mascot.skin.title")} maxHeight={372}>
          <SkinsList character={character} look={look} color={body} owlSkin={owlSkin} unlocks={unlocks} disabled={disabled} onPick={(skin) => onPatch(skinPatch(look, character, skin))} />
        </Layer>
      )}
      {layer === "add" && tab === "shapes" && !shapesLock.locked && (
        <Layer anchorRef={addRef} popoverRef={layerRef} name="add" label={t("mascotPicker.add.title")}>
          <AddShapePanel onAdd={addDefinition} onGenerate={onGenerate} disabled={disabled} />
        </Layer>
      )}
    </div>
  );
}
