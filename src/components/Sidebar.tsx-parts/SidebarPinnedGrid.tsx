import type { SidebarState } from "./types";
import type { Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { isViewersPrimaryBot } from "@/lib/primary-bot";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { openBotConversationActions } from "../thread-home";
import { SidebarMascotAvatar } from "../SidebarMascotAvatar";
import { BotRoleTag } from "../LabelTag";
import { BotShareIcon, botShareLabel } from "../BotShareIcon";
import { botShareState } from "@/lib/bot-share-state";
import type { MenuState } from "./types";

export function SidebarPinnedGrid({
  pinnedBots,
  density,
  state,
  viewerId,
  showThreads,
  dispatch,
  setMenu,
}: {
  pinnedBots: Bot[];
  density: SidebarDensity;
  state: SidebarState;
  viewerId: string;
  showThreads: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatch: (action: any) => void;
  setMenu: (menu: MenuState) => void;
}) {
  if (pinnedBots.length === 0) return null;
  return (
    // The reference window's tiles: 95 x 115, 4px apart and centred as
    // a group, the first 16px under the head's row.
    <div className={cn("grid", density === "icons" ? "mb-2 grid-cols-1 gap-1 py-1.5" : "mb-4 grid-cols-[repeat(auto-fit,95px)] justify-center gap-x-1 gap-y-3 pb-1.5 pt-3")}>
      {pinnedBots.map((bot) => {
        const selected = state.activeView === "chat" && state.selectedId === bot.id;
        const title = bot.title.trim();
        const share = botShareState(bot, state.groups, viewerId);
        return (
          <button
            key={bot.id}
            type="button"
            onClick={() => { for (const action of openBotConversationActions(bot, showThreads)) dispatch(action); }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMenu({ botId: bot.id, x: event.clientX, y: event.clientY });
            }}
            aria-current={selected ? "page" : undefined}
            title={density === "icons" && share ? [bot.name, botShareLabel(share)].join("\n") : undefined}
            className={cn(
              density === "icons"
                ? "mx-auto flex w-full min-w-0 flex-col items-center gap-1.5 rounded-xl px-1 pb-1 pt-1.5"
                // Grok Bot's pinned tile: 95px wide, 10px corners,
                // 6px over a 60px portrait, 6px to the name, 4px
                // between name and role, 4px under, 8px aside
                : "flex w-[95px] shrink-0 flex-col items-center gap-1.5 rounded-[10px] px-2 pb-1 pt-1.5",
              density === "icons"
                ? selected ? "bg-sidebar-selected" : "hover:bg-sidebar-hover"
                : selected ? "bg-sidebar-card" : "hover:bg-sidebar-hover/60",
            )}
          >
            <SidebarMascotAvatar botId={bot.id} bot={bot} primary={isViewersPrimaryBot(bot, viewerId)} primaryRingClassName={selected && density !== "icons" ? "ring-sidebar-card" : "ring-sidebar"} state="idle" size={density === "icons" ? 36 : 60} animated={false} />
            {density !== "icons" && (
              <span data-sidebar-tile-labels="" className="flex w-full min-w-0 flex-col items-center gap-1">
                <span className="flex w-full min-w-0 items-center justify-center gap-1">
                  <span className="min-w-0 truncate text-center text-[12px] leading-4 text-sidebar-ink">{bot.name}</span>
                  {share ? <BotShareIcon state={share} size={12} /> : null}
                </span>
                {title ? <BotRoleTag text={title} tile /> : null}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
