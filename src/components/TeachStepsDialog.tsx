// Teach by demonstration, after the recording: the steps as an editable
// list, then saved as a skill of the bot (added turned off, through the same
// upload route as Skills > Upload, so the person turns it on after reading
// it). The list lives only in this window: closing it without saving drops
// it, and the raw recording is downloaded only when the person asks to keep
// it. Also the small chooser the composer's "Teach a task" opens when the
// bot has a browser: show it there, or describe it in words (/learn).
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Globe, MessageSquareText, Plus, Trash2, X } from "lucide-react";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { api, ApiError } from "@/state/store";
import { buildTeachSkill, TEACH_TEXT_MAX, type TeachStep } from "../../shared/teach-recording";

const input = "min-w-0 flex-1 rounded-md bg-inset px-2 py-1 text-[12px] outline-none focus:ring-1 focus:ring-accent";
const iconButton = "rounded-md p-1 text-ink-secondary hover:bg-inset hover:text-ink disabled:opacity-30";

const KIND_LABEL: Record<TeachStep["kind"], LocaleKey> = {
  open: "teach.step.open", click: "teach.step.click", type: "teach.step.type", press: "teach.step.press",
  back: "teach.step.back", forward: "teach.step.forward", reload: "teach.step.reload", tab: "teach.step.tab", note: "teach.step.note",
};

function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

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
    // a click on the computer's screen: name what is there, the window and position stay
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

export function TeachStepsDialog({ botId, botName, steps: recorded, recordedAt, onClose }: {
  botId: string; botName: string; steps: TeachStep[]; recordedAt: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [steps, setSteps] = useState<TeachStep[]>(recorded);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [keepRaw, setKeepRaw] = useState(false);
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const [savedName, setSavedName] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);

  const move = (index: number, by: number) => setSteps((list) => {
    const next = [...list];
    const [step] = next.splice(index, 1);
    next.splice(index + by, 0, step!);
    return next;
  });
  const save = async () => {
    setError("");
    if (!title.trim()) { setError(t("teach.titleRequired")); return; }
    if (!steps.length) { setError(t("teach.noSteps")); return; }
    setPhase("saving");
    const { name, markdown } = buildTeachSkill({ title, description, steps, recordedAt });
    try {
      await api(`/api/bots/${encodeURIComponent(botId)}/skill-upload`, {
        method: "POST",
        body: JSON.stringify({ mode: "install", files: [{ name: `${name}.md`, data: utf8Base64(markdown) }] }),
      });
      // the raw recording leaves this window only when the person asked
      if (keepRaw) download(`${name}-recording.json`, JSON.stringify({ recordedAt, steps }, null, 2));
      setSavedName(name);
      setPhase("saved");
    } catch (cause) {
      setPhase("idle");
      const body = cause instanceof ApiError ? cause.body : undefined;
      const exists = Array.isArray(body?.items) && JSON.stringify(body.items).includes('"exists"');
      setError(exists ? t("teach.exists", { name }) : t("teach.saveFailed", { detail: cause instanceof Error ? cause.message : String(cause) }));
    }
  };

  return <dialog ref={dialog} data-teach-steps="" onClose={onClose} onCancel={(e) => { if (phase === "saving") e.preventDefault(); }}
    className="m-auto flex w-[min(640px,calc(100%-32px))] max-h-[85vh] flex-col rounded-2xl border border-hairline/50 bg-card p-0 text-ink shadow-2xl backdrop:bg-black/40">
    <div className="flex items-center justify-between border-b border-hairline/40 px-5 py-3">
      <h2 className="text-[15px] font-medium">{t("teach.title")}</h2>
      <button type="button" className={iconButton} aria-label={t("teach.close")} disabled={phase === "saving"} onClick={() => dialog.current?.close()}><X size={16} /></button>
    </div>
    {phase === "saved" ? <div className="flex flex-col gap-3 px-5 py-5 text-[13px]" role="status">
      <p>{t("teach.saved", { name: savedName, bot: botName })}</p>
      <button type="button" className="self-end rounded-lg bg-accent px-4 py-2 text-[12px] font-medium text-accent-ink" onClick={() => dialog.current?.close()}>{t("teach.done")}</button>
    </div> : <>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
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
        <label className="flex items-start gap-2 text-[12px] text-ink-secondary">
          <input type="checkbox" className="mt-0.5" checked={keepRaw} onChange={(e) => setKeepRaw(e.target.checked)} />
          <span>{t("teach.keepRaw")}</span>
        </label>
        <p className="text-[11px] leading-relaxed text-ink-secondary">{t("teach.privacy")}</p>
      </div>
      {error && <p role="alert" className="px-5 pb-2 text-[12px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-hairline/40 px-5 py-3">
        <button type="button" className="rounded-lg px-4 py-2 text-[12px] hover:bg-inset" disabled={phase === "saving"} onClick={() => dialog.current?.close()}>{t("teach.discard")}</button>
        <button type="button" data-teach-save="" className="rounded-lg bg-accent px-4 py-2 text-[12px] font-medium text-accent-ink disabled:opacity-50" disabled={phase === "saving"} onClick={() => void save()}>
          {phase === "saving" ? t("teach.saving") : t("teach.save")}
        </button>
      </div>
    </>}
  </dialog>;
}

/** The composer's "Teach a task" when the bot has a browser: show the task
 * there (a recording), or describe it in words (/learn, as before). */
export function TeachChooserDialog({ botName, onShow, onDescribe, onClose }: {
  botName: string; onShow: () => void; onDescribe: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const choice = "flex w-full items-start gap-3 rounded-xl border border-hairline/50 px-3 py-3 text-left hover:bg-inset";
  return <dialog ref={dialog} data-teach-chooser="" onClose={onClose} onClick={(e) => { if (e.target === e.currentTarget) dialog.current?.close(); }}
    className="m-auto w-[min(420px,calc(100%-32px))] rounded-2xl border border-hairline/50 bg-card p-5 text-ink shadow-2xl backdrop:bg-black/40">
    <div className="mb-3 flex items-center justify-between"><h2 className="text-[15px] font-medium">{t("teach.chooser.title")}</h2>
      <button type="button" className={iconButton} aria-label={t("teach.close")} onClick={() => dialog.current?.close()}><X size={16} /></button></div>
    <div className="flex flex-col gap-2">
      <button type="button" data-teach-show="" className={choice} onClick={() => { dialog.current?.close(); onShow(); }}>
        <Globe size={18} className="mt-0.5 shrink-0 text-accent-text" aria-hidden="true" />
        <span className="flex flex-col gap-0.5"><span className="text-[13px] font-medium">{t("teach.chooser.show")}</span>
          <span className="text-[12px] text-ink-secondary">{t("teach.chooser.showHint", { bot: botName })}</span></span>
      </button>
      <button type="button" data-teach-describe="" className={choice} onClick={() => { dialog.current?.close(); onDescribe(); }}>
        <MessageSquareText size={18} className="mt-0.5 shrink-0 text-ink-secondary" aria-hidden="true" />
        <span className="flex flex-col gap-0.5"><span className="text-[13px] font-medium">{t("teach.chooser.describe")}</span>
          <span className="text-[12px] text-ink-secondary">{t("teach.chooser.describeHint")}</span></span>
      </button>
    </div>
  </dialog>;
}
