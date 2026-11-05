import { classifyFile, type FileKind } from "@/lib/chat-files";
import { formatMemoryBytes, relativeTime } from "@/lib/memory";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import {
  entryName,
  workspaceDownloadUrl,
  type WorkspaceEntry,
  type WorkspaceLoad,
} from "@/lib/workspace-files";
import type { LocaleKey } from "@/locales";
import { cn } from "@/lib/cn";
import { PILL } from "../../SettingsPrimitives";

export const buttonCls = PILL;
export const iconButtonCls = "rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50";
export const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export const WORKSPACE_DRAG = "application/x-sagax-workspace-paths";

export const LOAD_LABEL: Record<WorkspaceLoad, LocaleKey> = {
  "every-turn": "persona.files.load.everyTurn",
  "on-demand": "persona.files.load.onDemand",
  never: "persona.files.load.never",
};
export const LOAD_DETAIL: Record<WorkspaceLoad, LocaleKey> = {
  "every-turn": "persona.files.load.everyTurnDetail",
  "on-demand": "persona.files.load.onDemandDetail",
  never: "persona.files.load.neverDetail",
};
export const LOAD_TONE: Record<WorkspaceLoad, string> = {
  "every-turn": "bg-accent/15 text-ink",
  "on-demand": "bg-raised text-ink-secondary",
  never: "bg-transparent text-ink-tertiary border border-hairline/40",
};

export interface Open {
  path: string;
  text: string;
  hash: string;
  dirty: boolean;
  readOnly: boolean;
}

export type Creating = "file" | "folder" | "topic" | null;

export interface UploadState {
  name: string;
  percent: number;
}

export const errorText = (reason: unknown) => readableError(reason);

export function LoadBadge({ load, detailed }: { load: WorkspaceLoad; detailed: boolean }) {
  return (
    <span
      data-load-badge={load}
      title={detailed ? t(LOAD_DETAIL[load]) : undefined}
      className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] leading-4", LOAD_TONE[load])}
    >
      {t(LOAD_LABEL[load])}
    </span>
  );
}

function budgetText(entry: WorkspaceEntry): string | null {
  const budget = entry.budget;
  if (!budget) return null;
  return budget.maxLines
    ? t("persona.files.budgetLines", { lines: budget.lines, maxLines: budget.maxLines, bytes: formatMemoryBytes(budget.bytes), maxBytes: formatMemoryBytes(budget.maxBytes) })
    : t("persona.files.budgetBytes", { bytes: formatMemoryBytes(budget.bytes), maxBytes: formatMemoryBytes(budget.maxBytes) });
}

/** One row's details line (Advanced only): size or budget, dates, last use. */
export function entryDetails(entry: WorkspaceEntry, now: number): string {
  const parts = [budgetText(entry) ?? formatMemoryBytes(entry.bytes)];
  if (entry.createdAt) parts.push(t("persona.files.created", { when: relativeTime(entry.createdAt, now) }));
  if (entry.modifiedAt) parts.push(t("persona.files.modified", { when: relativeTime(entry.modifiedAt, now) }));
  parts.push(entry.lastUsedAt ? t("persona.files.lastUsed", { when: relativeTime(entry.lastUsedAt, now) }) : t("persona.files.neverUsed"));
  return parts.join(" · ");
}

export function entryKind(entry: WorkspaceEntry): FileKind {
  return classifyFile({ name: entryName(entry.path) });
}

export function isImageEntry(entry: WorkspaceEntry): boolean {
  return entry.kind === "file" && entryKind(entry) === "image";
}

export function isPdfEntry(entry: WorkspaceEntry): boolean {
  return entry.kind === "file" && /\.pdf$/i.test(entry.path);
}

export async function downloadEntry(botId: string, path: string): Promise<void> {
  const response = await fetch(workspaceDownloadUrl(botId, path));
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? t("attach.downloadFailed"));
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = entryName(path);
  link.style.display = "none";
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function safeFileName(name: string): string | null {
  const stem = name.trim().replace(/[\\/]/g, "-").replace(/^\.+/, "");
  if (!stem || stem.length > 190) return null;
  return stem;
}
