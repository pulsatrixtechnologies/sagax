import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Loader2, Trash2, X } from "lucide-react";
import type { CommandAllowRule, CommandAllowlistResponse } from "../../shared/command-allowlist";
import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { engineLabel } from "@/lib/human-label";
import { humanPath } from "@/lib/short-path";
import { cn } from "@/lib/cn";
import { ConfirmPill, FIELD, FieldRow, HelpTip, PILL, PRIMARY_PILL, SettingsGroup, DIALOG } from "./SettingsPrimitives";

// Electron collects -webkit-app-region from layout boxes and ignores z-index,
// so the chat header's drag strip swallows clicks that land on top of it.
// This dialog's close button is in that band whenever the list is tall.
const overlayStyle = { WebkitAppRegion: "no-drag" } as CSSProperties;

/** Mounted for one captured bot/thread, so switching conversations cannot
 * redirect an in-flight save or reuse another bot's working folder. */
export function CommandAllowlistDialog({ botId, botName, threadId, onClose }: {
  botId: string;
  botName: string;
  threadId?: string;
  onClose: () => void;
}) {
  const { state } = useStore();
  const [data, setData] = useState<CommandAllowlistResponse | null>(null);
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const mounted = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const scopeId = useId();
  const exactId = useId();
  const basePath = `/api/bots/${encodeURIComponent(botId)}/command-allowlist`;
  const query = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
  const providerName = (id: string) => engineLabel(state.instances.find((instance) => instance.instanceId === id)?.displayName, id);

  useEffect(() => {
    mounted.current = true;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    // The opener keeps focus, and a drag-region click can blur the close
    // button. Bot settings then sees this dialog and leaves Escape alone, so
    // the key has to be taken here, before that parent handler runs.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      mounted.current = false;
      window.removeEventListener("keydown", onKey, true);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void api<CommandAllowlistResponse>(basePath + query, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setCwd(result.context.cwd ?? "");
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [basePath, query, revision]);

  const save = async (rule?: CommandAllowRule) => {
    if (saving || !data || (!rule && (!command.trim() || !cwd.trim() || !data.supported))) return;
    setSaving(rule?.id ?? "add");
    setError(null);
    // Keep focus inside the dialog when the clicked control becomes disabled
    // or its row disappears after a successful deletion.
    dialogRef.current?.focus();
    try {
      const result = await api<CommandAllowlistResponse>(
        basePath + (rule ? `/${encodeURIComponent(rule.id)}` : "") + query,
        rule ? { method: "DELETE" } : {
          method: "POST",
          body: JSON.stringify({ command, cwd: cwd.trim(), providerInstanceId: data.context.providerInstanceId }),
        },
      );
      if (!mounted.current) return;
      setData(result);
      if (!rule) setCommand("");
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (mounted.current) {
        setSaving(null);
        closeRef.current?.focus();
      }
    }
  };

  // Portaled to the document so the overlay is after every drag region and is
  // not trapped in the composer dock (pointer-events none, z-index 2).
  const overlay = (
    <div
      data-thread-overlay
      style={overlayStyle}
      className={cn(DIALOG.backdrop, "z-50")}
      onMouseDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex='0']",
        );
        if (!controls?.length) return;
        const first = controls[0]!;
        const last = controls[controls.length - 1]!;
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={scopeId}
        aria-busy={loading || Boolean(saving) || undefined}
        tabIndex={-1}
        className={`${DIALOG.frame} max-w-[540px]`}
      >
        <div className={DIALOG.header}>
          <div className="min-w-0">
            <h2 id={titleId} className={DIALOG.title}>{t("commandAllowlist.title")}</h2>
            <p className={DIALOG.subtitle}>{t("commandAllowlist.forBot", { name: botName })}</p>
          </div>
          <button ref={closeRef} type="button" onMouseDown={(event) => event.stopPropagation()} onClick={onClose} aria-label={t("commandAllowlist.close")}
            className={cn(DIALOG.close, "disabled:opacity-40")}><X size={18} className="pointer-events-none" /></button>
        </div>
        <div className={DIALOG.body}>
          {loading && <p role="status" className="flex items-center gap-2 px-1 text-[13px] text-ink-secondary">
            <Loader2 size={15} className="animate-spin" aria-hidden="true" />{t("commandAllowlist.loading")}
          </p>}
          {error && <div role="alert" className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-[12.5px] text-danger">
            <p>{error}</p>
            {!data && !loading && <button type="button" onClick={() => setRevision((value) => value + 1)}
              className={`${PILL} mt-2`}>{t("commandAllowlist.retry")}</button>}
          </div>}
          <SettingsGroup
            groupId="command-allowlist-rules"
            title={t("commandAllowlist.saved")}
            accessory={<>
              <HelpTip label={t("settings.moreAbout", { title: t("commandAllowlist.title") })}><span id={scopeId}>{t("commandAllowlist.scope")}</span></HelpTip>
              {data && !loading && data.rules.length > 0 && <span className="ml-auto text-[12.5px] tabular-nums text-ink-secondary">{data.rules.length}</span>}
            </>}
          >
            {data && !loading && (data.rules.length ? data.rules.map((rule) => <div key={rule.id} className="flex items-start gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <pre tabIndex={0} className="max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink">{rule.command}</pre>
                <p className="mt-1 break-all text-[12px] leading-4 text-ink-secondary">{providerName(rule.providerInstanceId)} · <span className="font-mono" title={rule.cwd}>{humanPath(rule.cwd)}</span></p>
              </div>
              <ConfirmPill
                disabled={Boolean(saving)}
                onConfirm={() => void save(rule)}
                label={t(saving === rule.id ? "commandAllowlist.removing" : "commandAllowlist.remove")}
                ariaLabel={t("commandAllowlist.removeAria", { command: rule.command })}
                confirmLabel={t("common.confirmRemove")}
              >
                {saving === rule.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
              </ConfirmPill>
            </div>) : <p className="px-3.5 py-2.5 text-[13px] text-ink-secondary">{t("commandAllowlist.empty")}</p>)}
          </SettingsGroup>
          {data && !loading && (data.supported ? <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <SettingsGroup
              groupId="command-allowlist-add"
              title={t("commandAllowlist.add")}
              accessory={<span className="ml-auto min-w-0 truncate text-[12.5px] text-ink-secondary">{providerName(data.context.providerInstanceId)}</span>}
            >
              <FieldRow label={t("commandAllowlist.command")} hint={t("commandAllowlist.exact")} hintId={exactId}>
                <textarea value={command} onChange={(event) => setCommand(event.target.value)} disabled={Boolean(saving)} required rows={2} spellCheck={false}
                  aria-describedby={exactId}
                  onKeyDown={(event) => {
                    // Enter adds; Shift+Enter keeps a line break for a multi-line command.
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void save(); }
                  }}
                  className={`${FIELD} resize-y font-mono text-[12px]`} />
              </FieldRow>
              <FieldRow label={t("commandAllowlist.folder")}>
                <input value={cwd} onChange={(event) => setCwd(event.target.value)} disabled={Boolean(saving)} required spellCheck={false}
                  className={`${FIELD} font-mono text-[12px]`} />
              </FieldRow>
              <div className="flex justify-end px-3.5 pb-1.5 pt-1">
                <button type="submit" disabled={Boolean(saving) || !command.trim() || !cwd.trim()} className={PRIMARY_PILL}>
                  {t(saving === "add" ? "commandAllowlist.adding" : "commandAllowlist.add")}
                </button>
              </div>
            </SettingsGroup>
          </form> : <p className="px-1 text-[12px] text-ink-secondary">{t("commandAllowlist.unsupported")}</p>)}
        </div>
      </div>
    </div>
  );
  return createPortal(overlay, document.body);
}
