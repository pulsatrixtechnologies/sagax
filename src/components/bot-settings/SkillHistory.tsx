// A skill's history (#2610): every change the bot or the person made to
// SKILL.md, newest first, each one folding open to its line diff. Undo on the
// newest change puts the text from before it back; Restore on an older one
// puts that version back. Either is itself a new version, so nothing is lost.
// Shown folded on the skill's own page (SkillEditorPage), next to its source.
import { useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { whenLabel } from "@/lib/schedule-label";
import { InlineFold, PILL } from "../SettingsPrimitives";
import { useBotEditor } from "./BotEditorContext";
import { lineDiff } from "./HistorySection";

export interface SkillHistoryVersion {
  id: string;
  at: number;
  by: "bot" | "person" | "restore";
  gist: string;
  before: string | null;
  after: string;
}

function who(version: SkillHistoryVersion): string {
  if (version.by === "person") return t("botPanel.history.actor.user");
  if (version.by === "restore") return t("botPanel.skills.historyByRestore");
  return t("botPanel.history.actor.bot");
}

export function SkillHistory({
  basePath,
  stamp,
  disabled,
  onRestored,
}: {
  /** The bot skill's route, `/api/bots/<id>/skills/<name>`. */
  basePath: string;
  /** Changes when the skill's text changes, so the list reloads. */
  stamp: string;
  disabled?: boolean;
  onRestored: () => void;
}) {
  const [versions, setVersions] = useState<SkillHistoryVersion[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const baseId = useId();
  const { request: api } = useBotEditor();

  useEffect(() => {
    let cancelled = false;
    void api(`${basePath}/history`)
      .then((raw) => {
        const result = raw as { versions?: SkillHistoryVersion[] } | null;
        if (!cancelled) setVersions(Array.isArray(result?.versions) ? result.versions : []);
      })
      .catch(() => {
        if (!cancelled) setVersions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api, basePath, stamp]);

  if (versions.length === 0) return null;

  const restore = async (version: SkillHistoryVersion, side: "before" | "after") => {
    setBusy(version.id);
    setError("");
    try {
      await api(`${basePath}/history/restore`, { method: "POST", body: JSON.stringify({ id: version.id, side }) });
      onRestored();
    } catch (cause) {
      setError(readableError(cause) || t("botPanel.skills.updateError"));
    } finally {
      setBusy("");
    }
  };

  return (
    <InlineFold label={t("botPanel.skills.history", { count: String(versions.length) })}>
      <ol data-skill-history="" className="flex flex-col divide-y divide-hairline/40 overflow-clip rounded-xl border-[0.5px] border-border bg-elevated">
        {versions.map((version, index) => {
          const newest = index === 0;
          const expanded = open === version.id;
          const foldId = `${baseId}-${version.id}`;
          const toggle = () => setOpen(expanded ? null : version.id);
          const action = newest ? (version.before === null ? null : "before") : "after";
          return (
            <li key={version.id} data-skill-history-version={version.id}>
              <div className="flex min-h-[44px] items-center gap-2 px-2.5 py-1.5">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={expanded ? foldId : undefined}
                  onClick={toggle}
                  className="flex min-w-0 flex-1 flex-col rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                >
                  <span className="truncate text-[12.5px] leading-5 text-ink">
                    {version.gist || (version.before === null ? t("botPanel.skills.historyCreated") : t("botPanel.skills.historyChanged"))}
                  </span>
                  <span className="truncate text-[11.5px] leading-4 text-ink-secondary">
                    {who(version)} · {whenLabel(version.at)}
                  </span>
                </button>
                {action && (
                  <button
                    type="button"
                    data-skill-history-restore={action}
                    disabled={disabled || Boolean(busy)}
                    onClick={() => void restore(version, action)}
                    className={PILL}
                  >
                    {newest ? t("botPanel.skills.historyUndo") : t("botPanel.skills.historyRestore")}
                  </button>
                )}
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={toggle}
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-hover hover:text-ink motion-reduce:transition-none"
                >
                  <ChevronDown size={14} className={cn("transition-transform motion-reduce:transition-none", expanded && "rotate-180")} />
                </button>
              </div>
              {expanded && (
                <pre id={foldId} data-skill-history-diff="" className="mx-2.5 mb-2 max-h-[280px] overflow-auto whitespace-pre-wrap rounded-lg bg-inset px-3 py-2 font-sans text-[12px] leading-relaxed">
                  {lineDiff(version.before ?? "", version.after).map((line, lineIndex) => (
                    <div
                      key={lineIndex}
                      data-diff={line.kind}
                      className={line.kind === "removed" ? "rounded-sm bg-danger/10 text-ink line-through decoration-danger/50" : line.kind === "added" ? "rounded-sm bg-success/10 text-ink" : "text-ink-secondary"}
                    >
                      {line.kind === "removed" ? "- " : line.kind === "added" ? "+ " : "  "}{line.text || " "}
                    </div>
                  ))}
                </pre>
              )}
            </li>
          );
        })}
      </ol>
      {error && <p role="alert" className="mt-1 text-[12px] text-danger">{error}</p>}
    </InlineFold>
  );
}
