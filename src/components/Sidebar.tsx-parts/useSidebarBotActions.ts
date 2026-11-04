import type { SidebarState } from "./types";
import { useCallback, useEffect, useState } from "react";
import { api, openBot, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { requestPrimaryBot } from "@/lib/bot-quick-actions";
import { templatesEntryActions } from "@/lib/templates-entry";
import { currentArchivableBot, type BotConfirmKind } from "./helpers";
import type { MenuState, TeamFeedback } from "./types";

/** Confirm/archive/primary/undo/feedback/package-install/drawer Escape. */
export function useSidebarBotActions({
  state,
  dispatch,
  showThreads,
  open,
  onClose,
  remoteClient,
}: {
  state: SidebarState;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dispatch: (action: any) => void;
  showThreads: boolean;
  open: boolean;
  onClose: () => void;
  remoteClient: boolean;
}) {
  const [confirm, setConfirm] = useState<{ kind: BotConfirmKind; bot: Bot } | null>(null);
  const cancelConfirm = useCallback(() => setConfirm(null), []);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renameBotId, setRenameBotId] = useState<string | null>(null);
  const [sectionPicker, setSectionPicker] = useState<MenuState | null>(null);
  const [roomMenu, setRoomMenu] = useState<{ groupId: string; x: number; y: number } | null>(null);
  const [roomSectionPicker, setRoomSectionPicker] = useState<{ groupId: string; x: number; y: number } | null>(null);
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null);
  const [leavingRoomId, setLeavingRoomId] = useState<string | null>(null);
  const deletingRoom = deletingRoomId ? state.groups.find((g) => g.id === deletingRoomId) : undefined;
  const [teamFeedback, setTeamFeedback] = useState<TeamFeedback | null>(null);
  const [primaryPicker, setPrimaryPicker] = useState<{ currentId: string; pending: boolean; error: string | null } | null>(null);

  // Esc closes the drawer, mirroring ApiKeys.tsx:75-85. Bound only while the
  // drawer is open — on mobile, exactly when a bot/room context menu or the
  // New Room panel can be open on top of it, so the same Escape press closes
  // them together. Fine, since both directions are "get me out of here."
  useEffect(() => {
    if (!open || confirm || deletingRoom) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose, confirm, deletingRoom]);

  // An install link (openmaus://, a team's address) opens Browse Bots on
  // its Templates section, where Import previews it before anything is added.
  useEffect(() => {
    if (remoteClient) return;
    return window.ogb?.onPackageInstall?.((url) => {
      for (const action of templatesEntryActions("installLink", url)) dispatch(action);
    });
  }, [remoteClient, dispatch]);

  useEffect(() => {
    if (!teamFeedback) return;
    const timer = window.setTimeout(() => setTeamFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [teamFeedback]);

  // Archive and delete share one pending confirmation at a time.
  const requestArchive = (bot: Bot) => {
    const current = currentArchivableBot(state.bots, bot.id);
    if (current) setConfirm({ kind: "archive", bot: current });
  };

  const archiveBot = async ({ id }: Pick<Bot, "id">) => {
    const bot = currentArchivableBot(state.bots, id);
    if (!bot) return;
    const activeBots = state.bots.filter((candidate) => !candidate.hidden);
    setTeamFeedback(null);
    try {
      const response = await api(`/api/bots/${bot.id}`, {
        method: "PATCH",
        body: JSON.stringify({ hidden: true }),
      });
      dispatch({ type: "botPatched", bot: response.bot });
      if (state.selectedId === bot.id) {
        const next = activeBots.find((candidate) => candidate.id !== bot.id);
        if (next) openBot(dispatch, next, showThreads);
      }
      setTeamFeedback({
        error: false,
        text: t("sidebar.bot.archived", { name: bot.name }),
        restoreBot: { id: bot.id, name: bot.name },
      });
    } catch (cause) {
      setTeamFeedback({ error: true, text: readableError(cause) });
    }
  };

  // One Primary Bot per person: the server hands the role over from the
  // previous one (POST /api/bots/:id/primary) and sends both bots' frames.
  const makePrimaryBot = async (botId: string, fromPicker = false) => {
    if (fromPicker) setPrimaryPicker((open) => (open ? { ...open, pending: true, error: null } : open));
    try {
      const primary = await requestPrimaryBot(botId);
      dispatch({ type: "botPatched", bot: primary });
      setPrimaryPicker(null);
      setTeamFeedback({ error: false, text: t("primaryBot.made", { name: primary.name }) });
    } catch (cause) {
      const text = readableError(cause);
      if (fromPicker) setPrimaryPicker((open) => (open ? { ...open, pending: false, error: text } : open));
      else setTeamFeedback({ error: true, text });
    }
  };

  const undoBotArchive = async (bot: { id: string; name: string }) => {
    setTeamFeedback(null);
    try {
      const response = await api(`/api/bots/${bot.id}`, {
        method: "PATCH",
        body: JSON.stringify({ hidden: false }),
      });
      dispatch({ type: "botPatched", bot: response.bot });
      openBot(dispatch, response.bot, showThreads);
      setTeamFeedback({ error: false, text: t("sidebar.archived.restored", { name: bot.name }) });
    } catch (cause) {
      setTeamFeedback({ error: true, text: readableError(cause) });
    }
  };

  return {
    confirm,
    setConfirm,
    cancelConfirm,
    menu,
    setMenu,
    renameBotId,
    setRenameBotId,
    sectionPicker,
    setSectionPicker,
    roomMenu,
    setRoomMenu,
    roomSectionPicker,
    setRoomSectionPicker,
    deletingRoomId,
    setDeletingRoomId,
    leavingRoomId,
    setLeavingRoomId,
    deletingRoom,
    teamFeedback,
    setTeamFeedback,
    primaryPicker,
    setPrimaryPicker,
    requestArchive,
    archiveBot,
    makePrimaryBot,
    undoBotArchive,
  };
}
