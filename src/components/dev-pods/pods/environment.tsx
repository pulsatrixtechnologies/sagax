// Environment: where the bot works, on one line (the server, this computer
// or the person's server environment, with Connecting or Ready when the
// transcript or the server proves it), the folder its shell runs in, and the
// repository and branch the server read there. Each line has its own menu.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Cloud, FolderGit2, GitBranch, Monitor, MoreHorizontal, Plus } from "lucide-react";
import { t } from "@/lib/i18n";
import { api, type Bot } from "@/state/store";
import { copyText } from "@/lib/copy-text";
import { effectivePlace, isComputerPlace, placeLabelKey, type EffectivePlace } from "@/lib/place";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { cn } from "@/lib/cn";
import { approvalModeFor } from "../../../../shared/approval-mode";
import { LocalComputerAutoWarning } from "../../LocalComputerAutoWarning";
import { DEV_WINDOW } from "../detector";
import { DEV_MENU_ITEM, DevMenu } from "../DevMenu";
import { registerDevPod, type DevPodContext } from "../registry";
import { currentBranch, folderLabel, isParallelTaskBranch } from "../sources";
import { readableError } from "@/lib/plain-error";

export interface EnvironmentData {
  place: EffectivePlace;
  placeLabel: string;
  computer: boolean;
  state: "connecting" | "ready" | null;
  folder: string | null;
  branch: string | null;
}

/** owner/name of a repository, as the server reports it (shared/bot-activity.ts). */
export interface EnvironmentRepo {
  name: string;
  url?: string;
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

/** What GET /api/bots/:id/activity says about this conversation's folder:
 * the repository and the branch checked out there. Absent fields stay
 * absent (the pod then keeps what the transcript already proved). */
export function environmentWork(payload: unknown, threadId: string): { repo?: EnvironmentRepo; branch?: string } {
  const items = (payload as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return {};
  const item = items.find((entry) => (entry as { threadId?: unknown }).threadId === threadId) as
    { code?: { repo?: unknown; repoUrl?: unknown; branch?: unknown } } | undefined;
  const code = item?.code;
  const repo = typeof code?.repo === "string" && code.repo.trim()
    ? { name: code.repo.trim(), ...(typeof code.repoUrl === "string" && code.repoUrl.trim() ? { url: code.repoUrl.trim() } : {}) }
    : undefined;
  const branch = typeof code?.branch === "string" && code.branch.trim() ? code.branch.trim() : undefined;
  return { ...(repo ? { repo } : {}), ...(branch ? { branch } : {}) };
}

/** A "..." button and its menu, drawn outside the card (DevMenu). */
function RowMenu({ open, label, onToggle, onClose, children, testId = "" }: { open: boolean; label: string; onToggle: () => void; onClose: () => void; children: ReactNode; testId?: string }) {
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={onToggle}
        className={MINI_BUTTON}
        data-env-menu={testId}
      >
        <MoreHorizontal size={14} />
      </button>
      <DevMenu open={open} anchorRef={button} label={label} onClose={onClose}>{children}</DevMenu>
    </>
  );
}

const ROW = "flex min-h-[28px] items-center gap-2";
const ROW_ICON = "shrink-0 text-ink-secondary";
const MINI_BUTTON = "flex size-6 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-hover hover:text-ink";
/** Wraps instead of cutting: a place or a folder is read whole. */
const ROW_TEXT = "min-w-0 flex-1 break-words text-ink [overflow-wrap:anywhere]";

/** The branch as a person reads it: Sagax's parallel-task branches are named
 * after an id, so they read as what they are (the name stays in the tooltip). */
export function environmentBranchLabel(branch: string): string {
  return isParallelTaskBranch(branch) ? t("folder.parallelBranch") : branch;
}

/** A folder the desktop bridge may act on: an absolute path, nothing else. */
function localFolder(folder: string | null): string | null {
  return folder && folder.startsWith("/") ? folder : null;
}

/** The folder the bot works in, as the server keeps it: null is its own
 * private folder (bot-settings/AccessSection.tsx). */
async function saveFolder(bot: Bot, cwd: string | null): Promise<void> {
  await api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ cwd }) });
}

/** The places a person picks here, on the bot's own Works on setting. */
const PLACE_CHOICES = ["cloud", "local", "vm"] as const;

function PlaceIcon({ place }: { place: EffectivePlace }) {
  const Icon = place === "cloud" ? Cloud : Monitor;
  return <Icon size={14} strokeWidth={1.75} aria-hidden="true" className={ROW_ICON} />;
}

function EnvironmentBody({ data, ctx }: { data: EnvironmentData; ctx: DevPodContext }) {
  const [menu, setMenu] = useState<"place" | "folder" | "branch" | null>(null);
  const [work, setWork] = useState<{ repo?: EnvironmentRepo; branch?: string }>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [placeWarning, setPlaceWarning] = useState(false);
  const organization = usePerspicaxOrg() !== null;
  const close = useCallback(() => setMenu(null), []);
  const toggle = (which: "place" | "folder" | "branch") => () => setMenu((current) => (current === which ? null : which));
  const savePlace = (place: "local" | "cloud" | "vm", acknowledged = false) => {
    if (ctx.bot.computer === place) return;
    if (place === "local" && !acknowledged && approvalModeFor(ctx.bot) === "auto") {
      setPlaceWarning(true);
      return;
    }
    ctx.dispatch({
      type: "updateBot",
      botId: ctx.bot.id,
      patch: { computer: place, ...(place === "local" && acknowledged ? { acknowledgeLocalAuto: true } : {}) },
    });
  };
  const folder = data.folder;
  const local = localFolder(folder);
  const branch = work.branch ?? data.branch;

  useEffect(() => {
    if (!folder) return;
    let live = true;
    api(`/api/bots/${ctx.bot.id}/activity?filter=coding`)
      .then((payload) => { if (live) setWork(environmentWork(payload, ctx.bot.threadId)); })
      .catch(() => { /* the transcript's branch stays; the repo simply is not shown */ });
    return () => { live = false; };
  }, [ctx.bot.id, ctx.bot.threadId, folder]);

  const pickFolder = async (mode: "change" | "add") => {
    const chosen = await window.ogb?.pickFolder?.(mode === "change" ? folder ?? undefined : undefined);
    if (!chosen || chosen === folder) return;
    try {
      await saveFolder(ctx.bot, chosen);
      setNotice(null);
    } catch (error) {
      setNotice(readableError(error));
    }
  };
  const reveal = async () => {
    if (!local) return;
    const result = await window.ogb?.revealInFolder?.(local);
    if (result && result !== "shown") setNotice(t("devPods.environment.folderMissing"));
  };
  const openTerminal = async (cwd: string) => {
    const opened = await window.ogb?.openTerminalAt?.(cwd);
    if (opened === false) setNotice(t("devPods.environment.terminalUnavailable"));
  };
  const run = (action: () => void) => () => { close(); action(); };

  return (
    <div className="flex flex-col gap-1">
      <div className={ROW} data-env-place="">
        <PlaceIcon place={data.place} />
        <span className="sr-only">{t("devPods.environment.where")}</span>
        <span data-env-place-label="" className={ROW_TEXT}>{data.placeLabel}</span>
        {data.state && (
          <span data-env-state={data.state} className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-secondary">
            <span aria-hidden="true" className={cn("size-1.5 rounded-full", data.state === "ready" ? "bg-success" : "animate-pulse bg-warning")} />
            {t(data.state === "ready" ? "devPods.environment.ready" : "devPods.environment.connecting")}
          </span>
        )}
        <RowMenu open={menu === "place"} label={t("devPods.environment.placeMenu")} onToggle={toggle("place")} onClose={close} testId="place">
          {PLACE_CHOICES.map((place) => (
            <button
              key={place}
              type="button"
              role="menuitemradio"
              aria-checked={ctx.bot.computer === place}
              data-env-place-choice={place}
              className={DEV_MENU_ITEM}
              onClick={run(() => savePlace(place))}
            >
              <span className="min-w-0 flex-1">{t(placeLabelKey(place, organization))}</span>
              {ctx.bot.computer === place && <Check size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
            </button>
          ))}
          <div aria-hidden="true" className="mx-2 my-0.5 h-px bg-hairline-weak" />
          <button type="button" role="menuitem" className={DEV_MENU_ITEM} onClick={run(() => ctx.dispatch({ type: "toggleSettings", open: true, section: "worksOn", botId: ctx.bot.id }))}>
            {t("devPods.environment.settings")}
          </button>
        </RowMenu>
      </div>
      <div className={ROW} data-env-folder="">
        <FolderGit2 size={14} strokeWidth={1.75} aria-hidden="true" className={ROW_ICON} />
        <span className="sr-only">{t("devPods.environment.folder")}</span>
        <span className={ROW_TEXT} title={folder ?? undefined}>
          {folder ? folderLabel(folder) : <span className="text-ink-secondary">{t("devPods.environment.ownFolder")}</span>}
        </span>
        <RowMenu open={menu === "folder"} label={t("devPods.environment.folderMenu")} onToggle={toggle("folder")} onClose={close} testId="folder">
          {local && <button type="button" role="menuitem" className={DEV_MENU_ITEM} onClick={run(() => void reveal())}>{t("devPods.environment.showInFinder")}</button>}
          {folder && <button type="button" role="menuitem" className={DEV_MENU_ITEM} onClick={run(() => void copyText(folder))}>{t("devPods.environment.copyPath")}</button>}
          {local && <button type="button" role="menuitem" className={DEV_MENU_ITEM} onClick={run(() => void pickFolder("change"))}>{t("devPods.environment.changeFolder")}</button>}
          <button type="button" role="menuitem" className={DEV_MENU_ITEM} onClick={run(() => void pickFolder("add"))}>{t("devPods.environment.addFolder")}</button>
          {local && <button type="button" role="menuitem" className={DEV_MENU_ITEM} onClick={run(() => void openTerminal(local))}>{t("devPods.environment.openTerminal")}</button>}
        </RowMenu>
      </div>
      {work.repo && (
        <div className={cn(ROW, "pl-[22px]")} data-env-repo="">
          <span className="sr-only">{t("devPods.environment.repository")}</span>
          <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink-secondary" title={work.repo.name}>{work.repo.name}</code>
        </div>
      )}
      {branch && (
        <div className={ROW} data-env-branch="">
          <GitBranch size={14} strokeWidth={1.75} aria-hidden="true" className={ROW_ICON} />
          <span className="sr-only">{t("devPods.environment.branch")}</span>
          <code className="min-w-0 flex-1 break-all font-mono text-[12px] text-ink" title={branch}>{environmentBranchLabel(branch)}</code>
          <RowMenu open={menu === "branch"} label={t("devPods.environment.branchMenu")} onToggle={toggle("branch")} onClose={close} testId="branch">
            <button type="button" role="menuitem" className={DEV_MENU_ITEM} onClick={run(() => void copyText(branch))}>{t("devPods.environment.copyBranch")}</button>
            {local && <button type="button" role="menuitem" className={DEV_MENU_ITEM} onClick={run(() => void openTerminal(local))}>{t("devPods.environment.openTerminal")}</button>}
          </RowMenu>
        </div>
      )}
      {notice && <p data-env-notice="" className="px-1 text-[12px] text-danger">{notice}</p>}
      {!folder && (
        <button type="button" data-env-add="" onClick={() => void pickFolder("add")} className={cn(ROW, "rounded-md px-1 text-ink-secondary hover:bg-hover hover:text-ink")}>
          <Plus size={14} strokeWidth={1.75} aria-hidden="true" className={ROW_ICON} />
          <span className="min-w-0 flex-1">{t("devPods.environment.addFolder")}</span>
        </button>
      )}
      <LocalComputerAutoWarning
        open={placeWarning}
        onCancel={() => setPlaceWarning(false)}
        onConfirm={() => { setPlaceWarning(false); savePlace("local", true); }}
      />
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
