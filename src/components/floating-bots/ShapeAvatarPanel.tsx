/**
 * Import / export / generate for portable Shape avatar definitions, inside
 * the existing Appearance > Mascot editor (no new top-level surface). Soft
 * sounds follow the floating-bots barkSound preference (off by default).
 */
import { useEffect, useRef, useState } from "react";
import { Download, Link2, Sparkles, Upload } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import {
  decodeShapeAvatarShare,
  encodeShapeAvatarShare,
  parseShapeAvatarPayload,
  type ShapeAvatarDef,
} from "../../../shared/shape-avatar-def";
import { generateShapeAvatarDef } from "../../../shared/shape-avatar-generate";
import {
  isObjectShapeId,
  OBJECT_SHAPE_BY_ID,
  shapeAvatarStillSvg,
  type ObjectShapeId,
} from "../../../shared/shape-avatar-presets";
import type { MascotLook, MascotShape } from "../../../shared/mascot-look";
import { MAUS_COLORS, type MausColor } from "@/lib/mascot";
import { readFloatingBotPrefs } from "@/lib/floating-bots";
import { api } from "@/state/store";
import { copyText } from "@/lib/copy-text";

export interface ShapeAvatarPanelProps {
  look: MascotLook;
  color: MausColor;
  mood?: string;
  disabled?: boolean;
  /** When set, Generate asks the bot's model via the harness route. */
  botId?: string;
  onApply: (look: MascotLook) => void;
  /** Optional: apply a colour from a share link or imported payload. */
  onColor?: (color: MausColor) => void;
}

function knownMausColor(value: string | undefined): MausColor | null {
  if (!value) return null;
  return Object.hasOwn(MAUS_COLORS, value) ? (value as MausColor) : null;
}

/** Read `?shapeAvatar=` once, validate, and clear the query so a refresh does not re-apply. */
export function consumeShapeAvatarShareParam(
  search = typeof location !== "undefined" ? location.search : "",
): { def: ShapeAvatarDef; color?: string; mood?: string } | null {
  if (typeof URLSearchParams === "undefined") return null;
  const params = new URLSearchParams(search);
  const raw = params.get("shapeAvatar");
  if (!raw) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const parsed = decodeShapeAvatarShare(decoded);
  if (!parsed.ok) return null;
  return { def: parsed.def, color: parsed.color, mood: parsed.mood };
}

function hexOf(color: string): string {
  return (MAUS_COLORS as Record<string, string>)[color] ?? (/^#[0-9a-fA-F]{6}$/.test(color) ? color : MAUS_COLORS.green);
}

function downloadText(filename: string, body: string, type: string) {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function playSoftPop() {
  if (!readFloatingBotPrefs().barkSound) return;
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 660;
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    osc.stop(ctx.currentTime + 0.13);
    void ctx.close();
  } catch {
    // Audio is optional.
  }
}

/** Definition for the current shape: custom avatarDef, or the object preset. */
export function definitionForLook(look: MascotLook): ShapeAvatarDef | null {
  if (look.avatarDef) return look.avatarDef;
  const shape = look.shape;
  if (shape && isObjectShapeId(shape)) return OBJECT_SHAPE_BY_ID[shape as ObjectShapeId];
  return null;
}

export function ShapeAvatarPanel({ look, color, mood = "idle", disabled, botId, onApply, onColor }: ShapeAvatarPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [direction, setDirection] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [share, setShare] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const shareConsumed = useRef(false);
  const lookRef = useRef(look);
  lookRef.current = look;
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;
  const onColorRef = useRef(onColor);
  onColorRef.current = onColor;

  const applyDef = (def: ShapeAvatarDef, extras?: { color?: string; mood?: string }) => {
    const current = lookRef.current;
    const shape = (def.id && isObjectShapeId(def.id) ? def.id : current.shape ?? "circle") as MascotShape;
    onApplyRef.current({
      ...current,
      character: "shape",
      shape,
      avatarDef: def,
    });
    const nextColor = knownMausColor(extras?.color);
    if (nextColor && onColorRef.current) onColorRef.current(nextColor);
    playSoftPop();
    setError(null);
    setNotice(
      extras?.mood
        ? `${t("mascot.shape.importOk")} (${extras.mood})`
        : t("mascot.shape.importOk"),
    );
  };

  const generateFromDirection = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || generating) return;
    setGenerating(true);
    setError(null);
    try {
      if (botId) {
        try {
          const result = await api<{ def: ShapeAvatarDef; source: string }>(
            `/api/bots/${botId}/shape-avatar/generate`,
            { method: "POST", body: JSON.stringify({ direction: trimmed }) },
          );
          if (result?.def) {
            applyDef(result.def);
            setDirection("");
            return;
          }
        } catch {
          // Fall through to local preset mapping.
        }
      }
      applyDef(generateShapeAvatarDef(trimmed));
      setDirection("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("mascot.shape.importError"));
    } finally {
      setGenerating(false);
    }
  };

  const onImportText = (raw: string) => {
    const asShare = decodeShapeAvatarShare(raw);
    if (asShare.ok) {
      applyDef(asShare.def, { color: asShare.color, mood: asShare.mood });
      return;
    }
    const parsed = parseShapeAvatarPayload(raw);
    if (!parsed.ok) {
      setError(t("mascot.shape.importError"));
      setNotice(null);
      return;
    }
    applyDef(parsed.def);
  };

  useEffect(() => {
    if (shareConsumed.current || disabled) return;
    const payload = consumeShapeAvatarShareParam();
    if (!payload) return;
    shareConsumed.current = true;
    applyDef(payload.def, { color: payload.color, mood: payload.mood });
    try {
      const url = new URL(location.href);
      url.searchParams.delete("shapeAvatar");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch {
      // History may be unavailable in tests.
    }
  }, [disabled]);

  const exportJson = () => {
    const def = definitionForLook(look) ?? generateShapeAvatarDef(look.shape ?? "circle");
    downloadText(`${def.id ?? "shape"}.json`, `${JSON.stringify(def, null, 2)}\n`, "application/json");
  };

  const exportSvg = () => {
    const def = definitionForLook(look) ?? generateShapeAvatarDef(look.shape ?? "circle");
    downloadText(`${def.id ?? "shape"}.svg`, shapeAvatarStillSvg(def, hexOf(color)), "image/svg+xml");
  };

  const copyShare = async () => {
    const def = definitionForLook(look) ?? generateShapeAvatarDef(look.shape ?? "circle");
    const payload = encodeShapeAvatarShare(def, { color, mood });
    const url = `${location.origin}${location.pathname}?shapeAvatar=${encodeURIComponent(payload)}`;
    setShare(url);
    // shown in the field below when the copy is refused
    await copyText(url);
  };

  return (
    <div data-shape-avatar-panel="" className="mt-3 space-y-3 rounded-xl border border-hairline/40 bg-inset/40 p-3">
      <div className="text-[12px] font-medium text-ink">{t("mascot.shape.objects")}</div>
      <p className="text-[11.5px] leading-relaxed text-ink-secondary">{t("mascot.shape.generateHint")}</p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          data-shape-export-json=""
          onClick={exportJson}
          className="inline-flex items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-2.5 py-1.5 text-[11.5px] text-ink hover:bg-inset disabled:opacity-50"
        >
          <Download size={12} /> {t("mascot.shape.exportJson")}
        </button>
        <button
          type="button"
          disabled={disabled}
          data-shape-export-svg=""
          onClick={exportSvg}
          className="inline-flex items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-2.5 py-1.5 text-[11.5px] text-ink hover:bg-inset disabled:opacity-50"
        >
          <Download size={12} /> {t("mascot.shape.exportSvg")}
        </button>
        <button
          type="button"
          disabled={disabled}
          data-shape-share=""
          onClick={() => void copyShare()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-2.5 py-1.5 text-[11.5px] text-ink hover:bg-inset disabled:opacity-50"
        >
          <Link2 size={12} /> {t("mascot.shape.shareLink")}
        </button>
        <button
          type="button"
          disabled={disabled}
          data-shape-import=""
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-hairline/50 bg-panel px-2.5 py-1.5 text-[11.5px] text-ink hover:bg-inset disabled:opacity-50"
        >
          <Upload size={12} /> {t("mascot.shape.import")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json,text/plain"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void file.text().then(onImportText);
            event.target.value = "";
          }}
        />
      </div>

      <div
        data-shape-drop=""
        tabIndex={0}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files?.[0];
          if (file) void file.text().then(onImportText);
          else onImportText(event.dataTransfer.getData("text/plain"));
        }}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text/plain");
          if (text.trim()) {
            event.preventDefault();
            onImportText(text);
          }
        }}
        className="rounded-lg border border-dashed border-hairline/60 px-3 py-2 text-[11px] text-ink-secondary"
      >
        {t("mascot.shape.import")}
      </div>

      <label className="block space-y-1.5">
        <span className="text-[11.5px] font-medium text-ink">{t("mascot.shape.generate")}</span>
        <textarea
          data-shape-generate-input=""
          value={direction}
          disabled={disabled}
          maxLength={400}
          onChange={(event) => setDirection(event.target.value.slice(0, 400))}
          placeholder={t("mascot.shape.generatePlaceholder")}
          className="min-h-[64px] w-full resize-none rounded-lg border border-hairline/40 bg-panel px-3 py-2 text-[12px] text-ink placeholder:text-ink-secondary focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          data-shape-generate=""
          disabled={disabled || generating || !direction.trim()}
          onClick={() => { void generateFromDirection(direction); }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50",
          )}
        >
          <Sparkles size={13} /> {t("mascot.shape.generate")}
        </button>
      </label>

      {share && (
        <input
          readOnly
          data-shape-share-url=""
          value={share}
          className="w-full truncate rounded-lg border border-hairline/40 bg-panel px-2 py-1 text-[11px] text-ink"
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
      {error && <p role="alert" className="text-[11.5px] text-danger">{error}</p>}
      {notice && !error && <p className="text-[11.5px] text-ink-secondary">{notice}</p>}
    </div>
  );
}
