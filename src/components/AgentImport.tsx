// Import an agent the person already uses (docs/import-agent.md): Grok Bot
// (its own export, through the existing GrokImportBox), a Claude Code
// folder or a Hermes home folder (shared/claude-code-import.ts). Both become an ordinary Sagax
// package made here, then go through the bot import of New bot > Zip file
// (POST /api/bots/import/upload, member scope: anyone who may create bots),
// so the bot arrives inert: skills off, routines paused, connections as
// empty slots, no key, token or sign-in. Offered in New bot and in the
// guided first run.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, Loader2, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readClaudeCodeFolder, type PickedFile } from "@/lib/claude-code-folder";
import type { PendingTeamImport } from "@/lib/team-import";
import { teamImportPreview } from "@/lib/team-import";
import { claudeCodeToPackage, CLAUDE_CODE_SOURCE, HERMES_SOURCE } from "../../shared/claude-code-import";
import type { BotZipImportResult } from "../../shared/bot-zip";
import type { GrokLeftOut } from "../../shared/grok-import";
import { BotZipImportPanel } from "./BotZipImport";
import { GrokImportBox, GrokLeftOutList } from "./GrokImportBox";
import { readableError } from "@/lib/plain-error";

export type AgentSource = "grok" | "claude" | "hermes";

interface Prepared {
  source: AgentSource;
  file: Blob;
  pending: PendingTeamImport;
  leftOut: GrokLeftOut[];
}

function timeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

/** The package as the file the bot import reads. Exported for tests. */
export function packageFile(manifest: unknown): Blob {
  return new Blob([JSON.stringify(manifest)], { type: "application/json" });
}

/** What the import creates, from the package itself. Exported for tests. */
export function AgentImportSummary({ pending }: { pending: PendingTeamImport }) {
  // Apps the source used (requirements) and MCP servers kept as empty slots (connections).
  const connections = ((pending.manifest as { package?: { connections?: Array<{ label: string }> } }).package?.connections ?? []).map((connection) => connection.label);
  const apps = [...new Set([...pending.apps.map((app) => app.label), ...connections])];
  const lines = [
    t("agentImport.summary.bots", { count: pending.members.length, names: pending.members.map((member) => member.name).join(", ") }),
    ...(pending.skills?.length ? [t("agentImport.summary.skills", { count: pending.skills.length })] : []),
    ...(pending.routines ? [t("agentImport.summary.routines", { count: pending.routines })] : []),
    ...(apps.length ? [t("agentImport.summary.apps", { count: apps.length, names: apps.join(", ") })] : []),
  ];
  return (
    <section className="flex flex-col gap-1" data-agent-import-summary="">
      <h4 className="text-[12.5px] font-medium text-ink">{t("botZip.created")}</h4>
      <ul className="flex flex-col gap-0.5 rounded-lg bg-hover px-3 py-2 text-[12.5px] leading-[18px] text-ink-secondary">
        {lines.map((line, index) => <li key={index}>{line}</li>)}
      </ul>
      <p className="text-[12px] text-ink-secondary">{t("agentImport.inert")}</p>
    </section>
  );
}

/** A picked folder: a Claude Code project (or ~/.claude), or a Hermes home (or one of its profiles). */
function ClaudeCodePicker({ source, onPrepared }: { source: "claude" | "hermes"; onPrepared: (prepared: Prepared) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const choose = async (list: FileList | null) => {
    if (!list?.length || busy) return;
    setBusy(true);
    setError("");
    try {
      const folder = await readClaudeCodeFolder(list as unknown as ArrayLike<PickedFile>);
      const { document, leftOut } = claudeCodeToPackage(folder.files, { folderName: folder.folderName, skippedSecrets: folder.skippedSecrets, timeZone: timeZone() });
      onPrepared({ source, file: packageFile(document), pending: teamImportPreview(document), leftOut });
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="flex flex-col gap-3" data-agent-import-claude={source}>
      <p className="text-[12.5px] leading-relaxed text-ink-secondary">{t(source === "hermes" ? "agentImport.hermesIntro" : "agentImport.claudeIntro")}</p>
      <p className="text-[12px] leading-relaxed text-ink-secondary">{t("agentImport.claudeSecrets")}</p>
      <input ref={input} type="file" multiple className="hidden" data-agent-import-folder=""
        {...{ webkitdirectory: "", directory: "" }}
        onChange={(event) => void choose(event.target.files)} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} data-agent-import-pick=""
        className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-7 text-ink-secondary hover:bg-hover hover:text-ink disabled:opacity-60">
        {busy ? <Loader2 size={20} className="animate-spin" /> : <FolderOpen size={20} />}
        <span className="text-[13px] text-ink">{busy ? t("agentImport.reading") : t("agentImport.chooseFolder")}</span>
      </button>
      {error ? <p role="alert" className="text-[12px] text-danger">{error}</p> : null}
    </div>
  );
}

export function AgentImportPanel({ initialSource = "grok", onImported, onCancel }: {
  initialSource?: AgentSource;
  onImported?: (result: BotZipImportResult) => void;
  onCancel?: () => void;
}) {
  const [source, setSource] = useState<AgentSource>(initialSource);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const sourceName = (value: AgentSource) => (value === "grok" ? t("agentImport.grok") : value === "hermes" ? HERMES_SOURCE : CLAUDE_CODE_SOURCE);

  if (prepared) {
    return (
      <div data-agent-import-preview={prepared.source}>
        <BotZipImportPanel
          file={prepared.file}
          sourceLabel={t("agentImport.from", { source: sourceName(prepared.source) })}
          summary={<AgentImportSummary pending={prepared.pending} />}
          extra={<GrokLeftOutList leftOut={prepared.leftOut} />}
          onCancel={() => setPrepared(null)}
          onImported={onImported}
        />
      </div>
    );
  }
  const tab = (value: AgentSource) => (
    <button type="button" role="tab" aria-selected={source === value} onClick={() => setSource(value)} data-agent-import-tab={value}
      className={cn("rounded-md px-3 py-1.5 text-[12.5px]", source === value ? "bg-elevated text-ink shadow-sm" : "text-ink-secondary hover:text-ink")}>
      {sourceName(value)}
    </button>
  );
  return (
    <div className="flex flex-col gap-3 text-[13px]" data-agent-import="">
      <p className="text-[12.5px] leading-relaxed text-ink-secondary">{t("agentImport.intro")}</p>
      <div role="tablist" aria-label={t("agentImport.sourceLabel")} className="inline-flex self-start rounded-lg bg-control p-0.5">
        {tab("grok")}
        {tab("claude")}
        {tab("hermes")}
      </div>
      {source === "grok"
        ? <GrokImportBox onPreview={(pending, leftOut) => setPrepared({ source: "grok", file: packageFile(pending.manifest), pending, leftOut })} />
        : <ClaudeCodePicker key={source} source={source} onPrepared={setPrepared} />}
      {onCancel ? (
        <div className="flex justify-end">
          <button type="button" className="ui-button" onClick={onCancel} data-agent-import-cancel="">{t("common.cancel")}</button>
        </div>
      ) : null}
    </div>
  );
}

/** The panel over the page (New bot, the guided first run). */
export function AgentImportDialog({ onClose, onImported, initialSource }: {
  onClose: () => void;
  onImported?: (result: BotZipImportResult) => void;
  initialSource?: AgentSource;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  // On the body: the guided first run's card must not clip or move it.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3 sm:p-5" data-agent-import-dialog=""
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={t("agentImport.title")}
        className="flex max-h-[min(760px,94dvh)] w-full max-w-[600px] flex-col overflow-hidden rounded-[14px] border border-border bg-elevated">
        <div className="flex shrink-0 items-center justify-between border-b border-hairline/40 px-5 py-4">
          <h2 className="text-[16px] font-semibold text-ink">{t("agentImport.title")}</h2>
          <button type="button" onClick={onClose} aria-label={t("common.close")}
            className="flex size-8 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink-secondary"><X size={18} /></button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <AgentImportPanel initialSource={initialSource} onCancel={onClose} onImported={(result) => { onImported?.(result); onClose(); }} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
