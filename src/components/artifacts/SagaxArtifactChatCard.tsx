// Chat card after save_artifact / update_artifact (#5462, R7): title, Open on
// the side, Window, and a compact toolbar (versions, Updated flash, Share and
// Open in tab disabled until a publish path exists). One card per artifact id;
// the server patches title/rev in place. Not the ```artifact fence card
// (ArtifactCard) or ClaudeArtifactCard.
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Columns2, AppWindow, Share2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { openArtifact, openArtifactWindow } from "@/lib/artifact-events";
import { api, type Message } from "@/state/store";

const FLASH_MS = 2_500;
const TOOL =
  "flex size-7 shrink-0 items-center justify-center rounded-full text-ink-tertiary transition-colors hover:bg-ink/[0.07] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40";
const CHIP =
  "inline-flex h-7 items-center gap-1.5 rounded-full border border-hairline/50 bg-raised px-2.5 text-[12.5px] font-medium text-ink hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40";

type VersionRow = { rev: number };

function useUpdatedFlash(rev: number): boolean {
  const [flash, setFlash] = useState(false);
  const seen = useRef(rev);
  useEffect(() => {
    if (rev <= seen.current) return undefined;
    seen.current = rev;
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(timer);
  }, [rev]);
  return flash;
}

export function SagaxArtifactChatCard({ message, botId }: { message: Message; botId: string }) {
  const ref = message.artifactCard!;
  const flash = useUpdatedFlash(ref.rev);
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");

  useEffect(() => {
    let live = true;
    setVersions(null);
    setViewing(null);
    api<{ artifact: { rev: number }; versions?: VersionRow[] }>(
      `/api/bots/${encodeURIComponent(botId)}/artifacts/${encodeURIComponent(ref.artifactId)}?versions=1`,
    )
      .then((answer) => {
        if (!live) return;
        const earlier = answer.versions ?? [];
        setVersions([...earlier.map((row) => ({ rev: row.rev })), { rev: answer.artifact.rev }]);
      })
      .catch(() => {
        if (live) setVersions([{ rev: ref.rev }]);
      });
    return () => {
      live = false;
    };
  }, [botId, ref.artifactId, ref.rev]);

  const revs = versions?.map((row) => row.rev) ?? [ref.rev];
  const lastIndex = Math.max(0, revs.length - 1);
  const index = viewing === null ? lastIndex : Math.min(lastIndex, Math.max(0, viewing));
  const shown = revs[index] ?? ref.rev;
  const latest = index === lastIndex;
  const title = ref.title;

  const openBeside = () => openArtifact({ botId, artifactId: ref.artifactId, title });
  const openWindow = () => openArtifactWindow({ botId, artifactId: ref.artifactId, title });

  const stepTo = async (nextIndex: number) => {
    const clamped = Math.min(lastIndex, Math.max(0, nextIndex));
    const rev = revs[clamped];
    if (rev === undefined || restoring) return;
    if (clamped === lastIndex) {
      setViewing(null);
      return;
    }
    setRestoring(true);
    setRestoreError("");
    try {
      await api(`/api/bots/${encodeURIComponent(botId)}/artifacts/${encodeURIComponent(ref.artifactId)}`, {
        method: "POST",
        body: JSON.stringify({ restoreRev: rev }),
      });
      setViewing(null);
      setVersions(null);
      const answer = await api<{ artifact: { rev: number }; versions?: VersionRow[] }>(
        `/api/bots/${encodeURIComponent(botId)}/artifacts/${encodeURIComponent(ref.artifactId)}?versions=1`,
      );
      const earlier = answer.versions ?? [];
      setVersions([...earlier.map((row) => ({ rev: row.rev })), { rev: answer.artifact.rev }]);
    } catch {
      setRestoreError(t("artifacts.chatCard.restoreFailed"));
      setViewing(clamped);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <article
      data-artifact-chat-card={ref.artifactId}
      data-artifact-chat-card-rev={ref.rev}
      aria-label={t("artifacts.chatCard.aria", { title })}
      className="my-2 w-full max-w-[420px] overflow-hidden rounded-2xl border border-hairline/50 bg-card shadow-sm"
    >
      <div className="flex items-start gap-3 px-3 pb-2 pt-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-ink">{title}</span>
          <span className="block truncate text-[12px] text-ink-secondary">
            {t("artifacts.chatCard.label")}
            {flash ? (
              <span role="status" data-artifact-chat-updated="" className="ms-1.5 rounded-full bg-accent/15 px-2 py-px font-medium text-accent-text">
                {t("artifacts.chatCard.updated")}
              </span>
            ) : null}
          </span>
        </span>
      </div>
      <div data-artifact-chat-tools="" className="flex flex-wrap items-center gap-x-1.5 gap-y-2 px-3 pb-3">
        <div className="flex items-center gap-0.5 text-[13px] text-ink-secondary">
          <button
            type="button"
            className={TOOL}
            aria-label={t("artifacts.chatCard.older")}
            title={t("artifacts.chatCard.older")}
            disabled={restoring || index <= 0}
            onClick={() => void stepTo(index - 1)}
          >
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          <span data-artifact-chat-version="" className="min-w-6 text-center tabular-nums">
            {t("artifacts.chatCard.version", { n: String(shown) })}
          </span>
          <button
            type="button"
            className={TOOL}
            aria-label={t("artifacts.chatCard.newer")}
            title={t("artifacts.chatCard.newer")}
            disabled={restoring || latest}
            onClick={() => void stepTo(index + 1)}
          >
            <ChevronRight size={15} aria-hidden="true" />
          </button>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-1.5">
          <button type="button" data-artifact-chat-beside="" className={CHIP} onClick={openBeside}>
            <Columns2 size={14} aria-hidden="true" />
            {t("artifacts.openBeside")}
          </button>
          <button type="button" data-artifact-chat-window="" className={CHIP} onClick={openWindow}>
            <AppWindow size={14} aria-hidden="true" />
            {t("artifacts.chatCard.window")}
          </button>
          <button
            type="button"
            className={TOOL}
            disabled
            aria-label={t("artifacts.chatCard.share")}
            title={t("artifacts.chatCard.shareNeedsPublish")}
          >
            <Share2 size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className={cn(TOOL)}
            disabled
            aria-label={t("artifacts.chatCard.openTab")}
            title={t("artifacts.chatCard.openTabNeedsLink")}
          >
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
      {restoreError ? (
        <p role="alert" className="px-3 pb-3 text-[12px] text-danger">{restoreError}</p>
      ) : null}
    </article>
  );
}
