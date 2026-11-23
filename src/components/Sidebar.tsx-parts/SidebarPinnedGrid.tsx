import type { MouseEvent } from "react";
import type { SidebarState } from "./types";
import { api, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { readableError } from "@/lib/plain-error";
import { isViewersPrimaryBot } from "@/lib/primary-bot";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { openBotConversationActions } from "../thread-home";
import { SidebarMascotAvatar } from "../SidebarMascotAvatar";
import { BotRoleTag } from "../LabelTag";
import { BotShareIcon, botShareLabel } from "../BotShareIcon";
import { botShareState } from "@/lib/bot-share-state";
import { RenameTitle } from "../RenameTitle";
import type { MenuState } from "./types";

function commitTileName(botId: string, name: string, dispatch: (action: { type: string; botId?: string; patch?: { name: string }; bot?: Bot; message?: string }) => void) {
  if (typeof window !== "undefined" && window.ogb?.remoteClient?.active === true) {
    void api(`/api/bots/${botId}/profile`, { method: "PATCH", body: JSON.stringify({ name }) })
      .then(({ bot: updated }) => dispatch({ type: "botPatched", bot: updated }))
      .catch((cause) => dispatch({ type: "error", message: readableError(cause) }));
    return;
  }
  dispatch({ type: "updateBot", botId, patch: { name } });
}

export function SidebarPinnedGrid({
  pinnedBots,
  density,
  state,
  viewerId,
  showThreads,
  dispatch,
  setMenu,
  renameBotId = null,
  onRenameStarted,
}: {
  pinnedBots: Bot[];
  density: SidebarDensity;
  state: SidebarState;
  viewerId: string;
  showThreads: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatch: (action: any) => void;
  setMenu: (menu: MenuState) => void;
  /** The bot whose tile should open its name field (Rename the bot, #4847). */
  renameBotId?: string | null;
  onRenameStarted?: () => void;
}) {
  if (pinnedBots.length === 0) return null;
  return (
    // The reference window's tiles: 95px wide (112px tall with a role,
    // 92px without), 4px apart and centred as a group, 12px under the head.
    <div className={cn("grid", density === "icons" ? "mb-2 grid-cols-1 gap-1 py-1.5" : "mb-4 grid-cols-[repeat(auto-fit,95px)] justify-center gap-x-1 gap-y-3 pb-1.5 pt-3")}>
      {pinnedBots.map((bot) => {
        const selected = state.activeView === "chat" && state.selectedId === bot.id;
        const title = (bot.title ?? "").trim();
        const share = botShareState(bot, state.groups, viewerId);
        const renaming = renameBotId === bot.id;
        const tileClass = cn(
          density === "icons"
            ? "mx-auto flex w-full min-w-0 flex-col items-center gap-1.5 rounded-xl px-1 pb-1 pt-1.5"
            // Grok Bot's pinned tile: 95px wide, 12px corners (the
            // owner's configuration, #4093),
            // 6px over a 60px portrait, 6px to the name, 4px
            // between name and role, 4px under, 8px aside
            : "flex w-[95px] shrink-0 flex-col items-center gap-1.5 rounded-[12px] px-2 pb-1 pt-1.5",
          density === "icons"
            ? selected ? "bg-sidebar-selected" : "hover:bg-sidebar-hover"
            : selected ? "bg-sidebar-card" : "hover:bg-sidebar-hover/60",
        );
        const labels = (density !== "icons" || renaming) && (
          <span data-sidebar-tile-labels="" className="flex w-full min-w-0 flex-col items-center gap-1">
            <span className="flex w-full min-w-0 items-center justify-center gap-1">
              {renaming ? (
                <RenameTitle
                  value={bot.name}
                  forceEditing
                  onCommit={(name) => commitTileName(bot.id, name, dispatch)}
                  onEditingChange={(editing) => { if (!editing) onRenameStarted?.(); }}
                  className="min-w-0 truncate text-center text-[12px] leading-4"
                  inputClassName="w-full rounded bg-inset px-1 py-0.5 text-center text-[12px]"
                />
              ) : (
                <span className="min-w-0 truncate text-center text-[12px] leading-4 text-sidebar-ink">{bot.name}</span>
              )}
              {share && !renaming ? <BotShareIcon state={share} size={12} /> : null}
            </span>
            {title && !renaming ? <BotRoleTag text={title} tile /> : null}
          </span>
        );
        const onContextMenu = (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          setMenu({ botId: bot.id, x: event.clientX, y: event.clientY });
        };
        // A field cannot sit inside the tile's button: Enter would open the
        // conversation instead of saving the name (#4847).
        if (renaming) {
          return (
            <div key={bot.id} onContextMenu={onContextMenu} className={tileClass}>
              <SidebarMascotAvatar botId={bot.id} bot={bot} primary={isViewersPrimaryBot(bot, viewerId)} primaryRingClassName={selected && density !== "icons" ? "ring-sidebar-card" : "ring-sidebar"} state="idle" size={density === "icons" ? 36 : 60} animated={false} />
              {labels}
            </div>
          );
        }
        return (
          <button
            key={bot.id}
            type="button"
            onClick={() => { for (const action of openBotConversationActions(bot, showThreads)) dispatch(action); }}
            onContextMenu={onContextMenu}
            aria-current={selected ? "page" : undefined}
            title={density === "icons" && share ? [bot.name, botShareLabel(share)].join("\n") : undefined}
            className={tileClass}
          >
            <SidebarMascotAvatar botId={bot.id} bot={bot} primary={isViewersPrimaryBot(bot, viewerId)} primaryRingClassName={selected && density !== "icons" ? "ring-sidebar-card" : "ring-sidebar"} state="idle" size={density === "icons" ? 36 : 60} animated={false} />
            {labels}
          </button>
        );
      })}
    </div>
  );
}
