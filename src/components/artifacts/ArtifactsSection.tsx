// The Library tab's artifacts: the widgets this bot saved for the person
// (docs/superpowers/specs/2026-10-16-artifacts-design.md). The person opens
// one beside the chat (docked panel) or in its own system window (or a
// browser tab where there is no desktop app), closes that window, pins or
// unpins it (the server's favorite flag), and deletes it; everything else
// (what it shows, its source, how often it refreshes) is the bot's, so the
// empty state tells them to ask the bot.
import { useState } from "react";
import { Trash2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { relativeTime } from "@/lib/memory";
import { openArtifact, openArtifactWindow } from "@/lib/artifact-events";
import { deleteArtifact, refreshArtifact, setArtifactFlags, type ArtifactList } from "@/lib/artifacts";
import { ConfirmDialog } from "../ConfirmDialog";
import { dockArtifactWindow } from "./artifact-windows";
import type { ArtifactSummary } from "../../../shared/artifacts";

/** "30 s", "5 min", "2 h", "1 d". */
export function intervalLabel(seconds: number): string {
  if (seconds < 60) return t("artifacts.interval.seconds", { count: seconds });
  if (seconds < 3600) return t("artifacts.interval.minutes", { count: Math.round(seconds / 60) });
  if (seconds < 86_400) return t("artifacts.interval.hours", { count: Math.round(seconds / 3600) });
  return t("artifacts.interval.days", { count: Math.round(seconds / 86_400) });
}

/** The line under an artifact's title: when its data is from, how often it
 * refreshes, or why it does not. The server's own words ride the title. */
export function artifactStatus(artifact: ArtifactSummary, now = Date.now()): { tone: "muted" | "warning" | "danger"; text: string; detail?: string } {
  const when = relativeTime(artifact.dataAt ?? artifact.updatedAt, now);
  const every = artifact.source && artifact.intervalSeconds ? intervalLabel(artifact.intervalSeconds) : null;
  const detail = artifact.refresh.error;
  switch (artifact.source ? artifact.refresh.state : "idle") {
    case "blocked":
      return { tone: "warning", text: t("artifacts.status.blocked"), ...(detail ? { detail } : {}) };
    case "paused":
      return artifact.refresh.failures > 0
        ? { tone: "danger", text: t("artifacts.status.paused", { count: artifact.refresh.failures }), ...(detail ? { detail } : {}) }
        : { tone: "muted", text: t("artifacts.status.pausedByBot") };
    case "error":
      return { tone: "warning", text: t("artifacts.status.error", { when: relativeTime(artifact.refresh.lastRunAt ?? now, now) }), ...(detail ? { detail } : {}) };
    default:
      return { tone: "muted", text: every ? t("artifacts.status.every", { when, every }) : t("artifacts.updated", { when }) };
  }
}

/** Kept for callers that only need the words. */
export function artifactMeta(artifact: ArtifactSummary, now = Date.now()): string {
  return artifactStatus(artifact, now).text;
}

const STATUS_TONE = { muted: "text-ink-secondary", warning: "text-warning", danger: "text-danger" } as const;

/** What the person can do to an artifact from a row. */
export interface ArtifactActions {
  /** Beside the chat in the shared docked panel (primary click). */
  open(artifact: ArtifactSummary): void;
  /** In its own system window (desktop app), else a new browser tab. */
  openWindow(artifact: ArtifactSummary): void;
  /** Close its system window: the artifact is docked (desktop app). */
  closeWindow(artifact: ArtifactSummary): void;
  toggleFavorite(artifact: ArtifactSummary): void;
  remove(artifact: ArtifactSummary): void;
  /** Run its source now (only offered when it has one). */
  refresh(artifact: ArtifactSummary): void;
  /** Artifact ids whose refresh is running from this window. */
  refreshing: ReadonlySet<string>;
}

export function ArtifactStatusLine({ artifact, now }: { artifact: ArtifactSummary; now?: number }) {
  const status = artifactStatus(artifact, now);
  return (
    <span data-artifact-status={artifact.source ? artifact.refresh.state : "static"} title={status.detail} className={cn("truncate text-[11px]", STATUS_TONE[status.tone])}>
      {status.text}
    </span>
  );
}

/** The person's actions, with the list patched at once and the server's
 * frame confirming. */
export function useArtifactActions(list: ArtifactList, onError: (text: string) => void): ArtifactActions & {
  confirming: ArtifactSummary | null;
  cancelDelete(): void;
  confirmDelete(): void;
  deleting: boolean;
} {
  const [confirming, setConfirming] = useState<ArtifactSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(() => new Set());
  return {
    refreshing,
    open: (artifact) => {
      openArtifact({ botId: artifact.botId, artifactId: artifact.id, title: artifact.title });
    },
    openWindow: (artifact) => {
      if (!artifact.popped) list.patch(artifact.id, { popped: true });
      openArtifactWindow({ botId: artifact.botId, artifactId: artifact.id, title: artifact.title });
    },
    closeWindow: (artifact) => {
      list.patch(artifact.id, { popped: false });
      void dockArtifactWindow(artifact).catch((reason: unknown) => {
        list.patch(artifact.id, { popped: true });
        onError(reason instanceof Error ? reason.message : t("artifacts.error"));
      });
    },
    refresh: (artifact) => {
      if (!artifact.source || refreshing.has(artifact.id)) return;
      setRefreshing((current) => new Set([...current, artifact.id]));
      void refreshArtifact(artifact.botId, artifact.id).then((next) => {
        const { html: _html, data, ...rest } = next;
        list.patch(artifact.id, data ? { ...rest, dataAt: data.at } : rest);
      }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : t("artifacts.error")))
        .finally(() => setRefreshing((current) => {
          const next = new Set(current);
          next.delete(artifact.id);
          return next;
        }));
    },
    toggleFavorite: (artifact) => {
      const favorite = !artifact.favorite;
      list.patch(artifact.id, { favorite });
      void setArtifactFlags(artifact.botId, artifact.id, { favorite }).catch((reason: unknown) => {
        list.patch(artifact.id, { favorite: !favorite });
        onError(reason instanceof Error ? reason.message : t("artifacts.error"));
      });
    },
    remove: (artifact) => setConfirming(artifact),
    confirming,
    cancelDelete: () => setConfirming(null),
    confirmDelete: () => {
      const artifact = confirming;
      if (!artifact) return;
      setDeleting(true);
      void deleteArtifact(artifact.botId, artifact.id).then(() => {
        list.patch(artifact.id, null);
        setConfirming(null);
      }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : t("artifacts.error")))
        .finally(() => setDeleting(false));
    },
    deleting,
  };
}

/** The dialog the actions open: the delete question. */
export function ArtifactDialogs({ state }: { state: ReturnType<typeof useArtifactActions> }) {
  return (
    <>
      <ConfirmDialog
        open={state.confirming !== null}
        title={t("artifacts.deleteTitle")}
        body={t("artifacts.deleteBody", { title: state.confirming?.title ?? "" })}
        confirmLabel={t("artifacts.delete")}
        tone="danger"
        icon={<Trash2 size={16} />}
        pending={state.deleting}
        onCancel={state.cancelDelete}
        onConfirm={state.confirmDelete}
      />
    </>
  );
}
