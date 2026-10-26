// Environment: the computer the bot works on (its place and, when the
// transcript or the server says it, Connecting or Ready), the folder its
// shell runs in, and the git branch its own commands last moved to.
import { FolderGit2, GitBranch, Monitor, Plus, Settings } from "lucide-react";
import { t } from "@/lib/i18n";
import { effectivePlace, isComputerPlace, placeLabelKey, type EffectivePlace } from "@/lib/place";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { cn } from "@/lib/cn";
import { DEV_WINDOW } from "../detector";
import { registerDevPod, type DevPodContext } from "../registry";
import { currentBranch, folderLabel, isParallelTaskBranch } from "../sources";

export interface EnvironmentData {
  place: EffectivePlace;
  placeLabel: string;
  computer: boolean;
  state: "connecting" | "ready" | null;
  folder: string | null;
  branch: string | null;
}

export function environmentData(ctx: Pick<DevPodContext, "bot" | "task" | "messages" | "computerStart">, organization = false): EnvironmentData | null {
  const place = effectivePlace(ctx.bot, ctx.task);
  const computer = isComputerPlace(place);
  const recent = ctx.messages.slice(-DEV_WINDOW);
  // Ready only when something proves it: a screen frame, or a command that
  // ran there and succeeded, since the last start.
  const ranThere = recent.some((message) => message.kind === "screen" || (message.kind === "activity" && message.tool?.ok === true && message.tool.place !== undefined));
  const state = ctx.computerStart ? "connecting" : computer && ranThere ? "ready" : null;
  // task.cwd: undefined = not pinned yet (the bot's folder), null = the
  // private bot workspace, a string = that folder
  const pinned = ctx.task?.cwd;
  const folder = pinned === undefined ? ctx.bot.cwd ?? null : pinned;
  const branch = currentBranch(recent) ?? null;
  if (!computer && !folder && !branch) return null;
  return { place, placeLabel: t(placeLabelKey(place, organization)), computer, state, folder, branch };
}

const ROW = "flex min-h-[28px] items-center gap-2";
const ROW_ICON = "shrink-0 text-ink-secondary";
const MINI_BUTTON = "flex size-6 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-hover hover:text-ink";

/** The branch as a person reads it: Sagax's parallel-task branches are named
 * after an id, so they read as what they are (the name stays in the tooltip). */
export function environmentBranchLabel(branch: string): string {
  return isParallelTaskBranch(branch) ? t("folder.parallelBranch") : branch;
}

function EnvironmentBody({ data, ctx }: { data: EnvironmentData; ctx: DevPodContext }) {
  const openSection = (section: "worksOn" | "access") =>
    ctx.dispatch({ type: "toggleSettings", open: true, section, botId: ctx.bot.id });
  return (
    <div className="flex flex-col gap-1">
      {data.computer && (
        <div className={ROW} data-env-computer="">
          <Monitor size={14} strokeWidth={1.75} aria-hidden="true" className={ROW_ICON} />
          <span className="min-w-0 flex-1 truncate text-ink">{data.placeLabel}</span>
          {data.state && (
            <span data-env-state={data.state} className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-secondary">
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", data.state === "ready" ? "bg-success" : "animate-pulse bg-warning")} />
              {t(data.state === "ready" ? "devPods.environment.ready" : "devPods.environment.connecting")}
            </span>
          )}
          <button type="button" className={MINI_BUTTON} onClick={() => openSection("worksOn")} aria-label={t("devPods.environment.settings")} title={t("devPods.environment.settings")}>
            <Settings size={13} />
          </button>
        </div>
      )}
      <div className={ROW} data-env-folder="">
        <FolderGit2 size={14} strokeWidth={1.75} aria-hidden="true" className={ROW_ICON} />
        <span className="min-w-0 flex-1 truncate text-ink" title={data.folder ?? undefined}>
          {data.folder ? folderLabel(data.folder) : <span className="text-ink-secondary">{t("devPods.environment.ownFolder")}</span>}
        </span>
        <button type="button" className={MINI_BUTTON} onClick={() => openSection("access")} aria-label={t("devPods.environment.addFolder")} title={t("devPods.environment.addFolder")}>
          <Plus size={13} />
        </button>
      </div>
      {data.branch && (
        <div className={ROW} data-env-branch="">
          <GitBranch size={14} strokeWidth={1.75} aria-hidden="true" className={ROW_ICON} />
          <span className="sr-only">{t("devPods.environment.branch")}</span>
          <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink" title={data.branch}>{environmentBranchLabel(data.branch)}</code>
        </div>
      )}
    </div>
  );
}

registerDevPod<EnvironmentData>({
  id: "environment",
  order: 10,
  title: () => t("devPods.environment.title"),
  icon: Monitor,
  collapsible: true,
  useData: (ctx) => {
    const organization = usePerspicaxOrg() !== null;
    const data = environmentData(ctx, organization);
    return data ? { status: "ready", data } : { status: "empty" };
  },
  Body: EnvironmentBody,
});
