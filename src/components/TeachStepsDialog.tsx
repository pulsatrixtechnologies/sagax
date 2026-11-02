// Teach by demonstration, after the recording: the steps as an editable
// list, then saved as a skill of the bot (added turned off, through the same
// upload route as Skills > Upload, so the person turns it on after reading
// it). The list lives only in this panel: closing it without saving drops
// it, and the raw recording is downloaded only when the person asks to keep
// it. Also the small chooser the composer's "Teach a task" opens when the
// bot has a browser: show it there, or describe it in words (/learn).
// 2026-11-01 lot 7: steps in DetailPanel beside the thread; chooser as an
// anchored popover on the composer +.
import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowDown, ArrowUp, Globe, MousePointerClick, MessageSquareText, Plus, Trash2, X } from "lucide-react";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { api } from "@/state/store";
import { TEACH_TEXT_MAX, type TeachReplay, type TeachStep } from "../../shared/teach-recording";
import { readableError } from "@/lib/plain-error";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { AnchoredPopover, useAnchoredDismissRoot } from "./AnchoredPopover";
import { DetailPanel } from "./DetailPanel";
import { PILL, PRIMARY_PILL } from "./SettingsPrimitives";

const input = "min-w-0 flex-1 rounded-md bg-inset px-2 py-1 text-[12px] outline-none focus:ring-1 focus:ring-accent";
const iconButton = "rounded-md p-1 text-ink-secondary hover:bg-inset hover:text-ink disabled:opacity-30";

const KIND_LABEL: Record<TeachStep["kind"], LocaleKey> = {
  open: "teach.step.open", click: "teach.step.click", type: "teach.step.type", press: "teach.step.press",
  back: "teach.step.back", forward: "teach.step.forward", reload: "teach.step.reload", tab: "teach.step.tab", note: "teach.step.note",
};

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** A screen step's window title: recorded from the computer, the person
 * may change it or take it out before saving (parity R7 review). */
function WindowField({ step, onChange }: { step: TeachStep; onChange: (next: TeachStep) => void }) {
  if (!step.window) return <span className="truncate text-[11px] text-ink-secondary">{t("teach.field.screen")}{step.point ? ` · ${Math.round(step.point.x * 100)}%, ${Math.round(step.point.y * 100)}%` : ""}</span>;
  return <span className="flex min-w-0 items-center gap-1" data-teach-window="">
    <input className={`${input} text-[11px]`} aria-label={t("teach.field.window")} value={step.window} maxLength={120} onChange={(e) => onChange({ ...step, window: e.target.value })} />
    {step.point && <span className="shrink-0 text-[11px] tabular-nums text-ink-secondary">{Math.round(step.point.x * 100)}%, {Math.round(step.point.y * 100)}%</span>}
    <button type="button" className={iconButton} aria-label={t("teach.field.removeWindow")} title={t("teach.field.removeWindow")} data-teach-window-remove=""
      onClick={() => { const next = { ...step }; delete next.window; onChange(next); }}><X size={12} /></button>
  </span>;
}

/** One step's editable fields: what the bot will do there. */
function StepFields({ step, onChange }: { step: TeachStep; onChange: (next: TeachStep) => void }) {
  if (step.kind === "open" || step.kind === "tab") {
    return <input className={input} aria-label={t("teach.field.url")} value={step.url ?? ""} spellCheck={false} onChange={(e) => onChange({ ...step, url: e.target.value })} />;
  }
  if (step.kind === "click" && step.screen) {
    return <span className="flex min-w-0 flex-1 flex-col gap-1">
      <WindowField step={step} onChange={onChange} />
      <input className={input} aria-label={t("teach.field.element")} value={step.target?.name ?? ""} placeholder={t("teach.field.screenSpot")}
        onChange={(e) => onChange({ ...step, target: { role: step.target?.role ?? "", tag: step.target?.tag ?? "", name: e.target.value } })} />
    </span>;
  }
  if (step.kind === "click") {
    return <input className={input} aria-label={t("teach.field.element")} value={step.target?.name ?? ""} placeholder={step.target?.role || t("teach.field.element")}
      onChange={(e) => onChange({ ...step, target: { role: step.target?.role ?? "", tag: step.target?.tag ?? "", name: e.target.value } })} />;
  }
  if (step.kind === "type") {
    return <span className="flex min-w-0 flex-1 flex-col gap-1">
      {step.screen ? <WindowField step={step} onChange={onChange} /> : <span className="truncate text-[11px] text-ink-secondary">{step.target?.name || step.target?.role || t("teach.field.field")}</span>}
      {step.secret
        ? <span data-teach-secret="" className="text-[12px] text-ink-secondary">{t(step.screen ? "teach.screenTyped" : "teach.secret")}</span>
        : <input className={input} aria-label={t("teach.field.text")} value={step.text ?? ""} maxLength={TEACH_TEXT_MAX} onChange={(e) => onChange({ ...step, text: e.target.value })} />}
    </span>;
  }
  if (step.kind === "press") {
    return <select className={input} aria-label={t("teach.field.key")} value={step.key ?? "Enter"} onChange={(e) => onChange({ ...step, key: e.target.value })}>
      {["Enter", "Tab", "Escape"].map((key) => <option key={key} value={key}>{key}</option>)}
    </select>;
  }
  if (step.kind === "note") {
    return <input className={input} aria-label={t("teach.field.note")} value={step.text ?? ""} maxLength={TEACH_TEXT_MAX} placeholder={t("teach.field.notePlaceholder")} onChange={(e) => onChange({ ...step, text: e.target.value })} />;
  }
  return <span className="flex-1" />;
}

export function TeachStepsDialog({ botId, botName, steps: recorded, recordedAt, replay: recordedReplay, onClose }: {
  botId: string; botName: string; steps: TeachStep[]; recordedAt: string;
  /** Shown in the person's own Chrome: where the bot replays it (the
   * person picks; the recorder's guess comes first). */
  replay?: TeachReplay;
  onClose: () => void;
}) {
  const [replay, setReplay] = useState<TeachReplay | undefined>(recordedReplay);
  const [steps, setSteps] = useState<TeachStep[]>(recorded);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [keepRaw, setKeepRaw] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const [savedName, setSavedName] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);

  const move = (index: number, by: number) => setSteps((list) => {
    const next = [...list];
    const [step] = next.splice(index, 1);
    next.splice(index + by, 0, step!);
    return next;
  });
  const save = async (replace = false) => {
    setError("");
    if (!title.trim()) { setError(t("teach.titleRequired")); return; }
    if (!steps.length) { setError(t("teach.noSteps")); return; }
    setPhase("saving");
    try {
      const result = await api(`/api/bots/${encodeURIComponent(botId)}/shown-path`, {
        method: "POST",
        body: JSON.stringify({ mode: "save", title, description, steps, recordedAt, replace, ...(replay ? { replay } : {}) }),
      }) as { ok?: boolean; code?: string; name?: string; installed?: string };
      if (result.code === "exists") {
        setPhase("idle");
        setConfirmReplace(true);
        setSavedName(result.name ?? "");
        return;
      }
      const name = result.installed || result.name || "";
      if (keepRaw) download(`${name}-recording.json`, JSON.stringify({ recordedAt, steps }, null, 2));
      setSavedName(name);
      setConfirmReplace(false);
      setPhase("saved");
    } catch (cause) {
      setPhase("idle");
      setError(t("teach.saveFailed", { detail: readableError(cause) }));
    }
  };
  const refuse = () => {
    if (phase === "saving") return;
    void api(`/api/bots/${encodeURIComponent(botId)}/shown-path`, {
      method: "POST",
      body: JSON.stringify({ mode: "refuse", title, description, steps, recordedAt }),
    }).catch(() => undefined);
    onClose();
  };

  return (
    <DetailPanel
      label={t("teach.title")}
      title={t("teach.title")}
      closeLabel={t("teach.close")}
      onClose={() => { if (phase !== "saving") onClose(); }}
      data-teach-steps=""
      footer={phase === "saved" ? (
        <button type="button" className={PRIMARY_PILL} onClick={onClose}>{t("teach.done")}</button>
      ) : (
        <>
          <button type="button" className={PILL} disabled={phase === "saving"} onClick={refuse}>{t("teach.discard")}</button>
          {confirmReplace && <button type="button" data-teach-replace="" className={PILL} disabled={phase === "saving"} onClick={() => void save(true)}>{t("teach.replace")}</button>}
          <button type="button" data-teach-save="" className={`${PRIMARY_PILL} ml-auto`} disabled={phase === "saving"} onClick={() => void save(false)}>
            {phase === "saving" ? t("teach.saving") : t("teach.save")}
          </button>
        </>
      )}
    >
      {phase === "saved" ? (
        <div className="flex flex-col gap-3 px-4 py-5 text-[13px]" role="status">
          <p>{t("teach.saved", { name: savedName, bot: botName })}</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
          <p className="text-[12px] leading-relaxed text-ink-secondary">{t(steps.some((step) => step.screen) ? "teach.introScreen" : "teach.intro", { bot: botName })}</p>
          <label className="flex flex-col gap-1 text-[12px]"><span className="font-medium">{t("teach.name")}</span>
            <input className={input} value={title} maxLength={80} placeholder={t("teach.namePlaceholder")} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-[12px]"><span className="font-medium">{t("teach.description")}</span>
            <input className={input} value={description} maxLength={300} placeholder={t("teach.descriptionPlaceholder")} onChange={(e) => setDescription(e.target.value)} /></label>
          <ol className="flex flex-col gap-1.5" aria-label={t("teach.steps")}>
            {steps.map((step, index) => <li key={step.id} data-teach-step={step.kind} className="flex items-center gap-2 rounded-lg border border-hairline/40 px-2 py-1.5">
              <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-ink-secondary">{index + 1}</span>
              <span className="w-24 shrink-0 text-[12px] font-medium">{t(KIND_LABEL[step.kind])}</span>
              <StepFields step={step} onChange={(next) => setSteps((list) => list.map((item) => item.id === step.id ? next : item))} />
              <button type="button" className={iconButton} aria-label={t("teach.moveUp")} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={14} /></button>
              <button type="button" className={iconButton} aria-label={t("teach.moveDown")} disabled={index === steps.length - 1} onClick={() => move(index, 1)}><ArrowDown size={14} /></button>
              <button type="button" className={iconButton} aria-label={t("teach.remove")} onClick={() => setSteps((list) => list.filter((item) => item.id !== step.id))}><Trash2 size={14} /></button>
            </li>)}
          </ol>
          {!steps.length && <p className="text-[12px] text-ink-secondary">{t("teach.empty")}</p>}
          <button type="button" className="flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-[12px] text-ink-secondary hover:bg-inset hover:text-ink"
            onClick={() => setSteps((list) => [...list, { id: crypto.randomUUID(), kind: "note", text: "" }])}><Plus size={13} />{t("teach.addNote")}</button>
          {replay && <fieldset className="flex flex-col gap-1.5 text-[12px]" data-teach-replay={replay}>
            <legend className="mb-1 font-medium">{t("teach.replay.title", { bot: botName })}</legend>
            {(["background", "my-chrome"] as const).map((where) => <label key={where} className="flex items-start gap-2">
              <input type="radio" name="teach-replay" className="mt-0.5" checked={replay === where} onChange={() => setReplay(where)} />
              <span className="flex flex-col"><span>{t(where === "background" ? "teach.replay.background" : "teach.replay.myChrome")}</span>
                <span className="text-[11px] text-ink-secondary">{t(where === "background" ? "teach.replay.backgroundHint" : "teach.replay.myChromeHint")}</span></span>
            </label>)}
          </fieldset>}
          <label className="flex items-start gap-2 text-[12px] text-ink-secondary">
            <input type="checkbox" className="mt-0.5" checked={keepRaw} onChange={(e) => setKeepRaw(e.target.checked)} />
            <span>{t("teach.keepRaw")}</span>
          </label>
          <p className="text-[11px] leading-relaxed text-ink-secondary">{t("teach.privacy")}</p>
          {confirmReplace && <p role="status" className="text-[12px] text-ink-secondary">{t("teach.replaceAsk", { name: savedName })}</p>}
          {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
        </div>
      )}
    </DetailPanel>
  );
}

/** The composer's "Teach a task" when the bot has a browser: show the task
 * there (a recording), or describe it in words (/learn, as before).
 * 2026-11-01 lot 7: anchored popover on the + (at most a choice list). */
export function TeachChooserDialog({ botName, anchorRef, onShow, onShowInMyChrome, onDescribe, onClose }: {
  botName: string;
  /** The + (or Teach row) that opened this choice. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Show it in the bot's browser; absent when this bot has none. */
  onShow?: () => void;
  /** Show it in the person's own Chrome (My Chrome's recorder). */
  onShowInMyChrome?: () => void;
  onDescribe?: () => void;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRoot = useRef<HTMLElement | null>(null);
  triggerRoot.current = anchorRef.current;
  const dismissRoot = useAnchoredDismissRoot(triggerRoot, popoverRef);
  usePopoverDismiss(true, dismissRoot, onClose);
  useEffect(() => {
    popoverRef.current?.querySelector<HTMLButtonElement>("button[data-teach-show], button[data-teach-my-chrome], button[data-teach-describe]")?.focus();
  }, []);

  const choice = "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-hover";
  return (
    <AnchoredPopover
      anchorRef={anchorRef}
      popoverRef={popoverRef}
      side="top"
      align="start"
      role="dialog"
      aria-labelledby="teach-chooser-title"
      data-teach-chooser=""
      className="w-[min(360px,calc(100vw-24px))] rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-3 text-ink shadow-xl"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <h2 id="teach-chooser-title" className="px-1 pb-2 text-[14px] font-medium">{t("teach.chooser.title")}</h2>
      <div className="flex flex-col gap-0.5">
        {onShow && <button type="button" data-teach-show="" className={choice} onClick={() => { onClose(); onShow(); }}>
          <Globe size={18} className="mt-0.5 shrink-0 text-accent-text" aria-hidden="true" />
          <span className="flex flex-col gap-0.5"><span className="text-[13px] font-medium">{t("teach.chooser.show")}</span>
            <span className="text-[12px] text-ink-secondary">{t("teach.chooser.showHint", { bot: botName })}</span></span>
        </button>}
        {onShowInMyChrome && <button type="button" data-teach-my-chrome="" className={choice} onClick={() => { onClose(); onShowInMyChrome(); }}>
          <MousePointerClick size={18} className="mt-0.5 shrink-0 text-accent-text" aria-hidden="true" />
          <span className="flex flex-col gap-0.5"><span className="text-[13px] font-medium">{t("teach.chooser.myChrome")}</span>
            <span className="text-[12px] text-ink-secondary">{t("teach.chooser.myChromeHint", { bot: botName })}</span></span>
        </button>}
        {onDescribe && <button type="button" data-teach-describe="" className={choice} onClick={() => { onClose(); onDescribe(); }}>
          <MessageSquareText size={18} className="mt-0.5 shrink-0 text-ink-secondary" aria-hidden="true" />
          <span className="flex flex-col gap-0.5"><span className="text-[13px] font-medium">{t("teach.chooser.describe")}</span>
            <span className="text-[12px] text-ink-secondary">{t("teach.chooser.describeHint")}</span></span>
        </button>}
      </div>
    </AnchoredPopover>
  );
}
