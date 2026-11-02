// Allowed commands as a pushed page under Permissions (2026-11-01, lot 3).
// From the bot panel or persona editor: PanelPage. From the composer: the
// shared DetailPanel at the right edge (same look, Escape closes).
import { useEffect, useId, useRef, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import type { CommandAllowRule, CommandAllowlistResponse } from "../../shared/command-allowlist";
import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { engineLabel } from "@/lib/human-label";
import { humanPath } from "@/lib/short-path";
import { ConfirmPill, FIELD, FieldRow, HelpTip, PILL, PRIMARY_PILL, SettingsGroup } from "./SettingsPrimitives";
import { readableError } from "@/lib/plain-error";
import { PanelPage } from "./bot-settings/PanelPage";
import { DetailPanel } from "./DetailPanel";

export function CommandAllowlistDialog({ botId, botName, threadId, onClose, presentation = "panel" }: {
  botId: string;
  botName: string;
  threadId?: string;
  onClose: () => void;
  /** panel = pushed page in the bot panel; detail = DetailPanel from the composer. */
  presentation?: "panel" | "detail";
}) {
  const { state, dispatch } = useStore();
  const [data, setData] = useState<CommandAllowlistResponse | null>(null);
  const [command, setCommand] = useState("");
  const [cwd, setCwd] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const mounted = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const scopeId = useId();
  const exactId = useId();
  const basePath = `/api/bots/${encodeURIComponent(botId)}/command-allowlist`;
  const query = threadId ? `?threadId=${encodeURIComponent(threadId)}` : "";
  const providerName = (id: string) => engineLabel(state.instances.find((instance) => instance.instanceId === id)?.displayName, id);
  const closePanel = () => {
    dispatch({ type: "toggleSettings", open: false });
    dispatch({ type: "toggleComputer", open: false });
  };

  useEffect(() => {
    mounted.current = true;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    bodyRef.current?.querySelector<HTMLElement>("button, input, textarea")?.focus();
    return () => {
      mounted.current = false;
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
        if (!controller.signal.aborted) setError(readableError(cause));
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [basePath, query, revision]);

  const save = async (rule?: CommandAllowRule) => {
    if (saving || !data || (!rule && (!command.trim() || !cwd.trim() || !data.supported))) return;
    setSaving(rule?.id ?? "add");
    setError(null);
    bodyRef.current?.focus();
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
      if (mounted.current) setError(readableError(cause));
    } finally {
      if (mounted.current) setSaving(null);
    }
  };

  const body = (
    <div
      ref={bodyRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      aria-describedby={scopeId}
      aria-busy={loading || Boolean(saving) || undefined}
      className="flex flex-col gap-4 px-4 py-4 outline-none"
      data-command-allowlist-body=""
    >
      <p id={titleId} className="sr-only">{t("commandAllowlist.title")}</p>
      <p className="text-[12px] text-ink-secondary">{t("commandAllowlist.forBot", { name: botName })}</p>
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
  );

  if (presentation === "detail") {
    return (
      <DetailPanel
        label={t("commandAllowlist.title")}
        title={t("commandAllowlist.title")}
        onClose={onClose}
        closeLabel={t("commandAllowlist.close")}
        data-command-allowlist=""
      >
        {body}
      </DetailPanel>
    );
  }

  return (
    <PanelPage
      name={t("commandAllowlist.title")}
      onBack={onClose}
      onClose={closePanel}
      closeLabel={t("commandAllowlist.close")}
      data-command-allowlist=""
      bodyClassName="p-0"
    >
      {body}
    </PanelPage>
  );
}
