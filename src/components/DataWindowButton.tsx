// The bot's Data window entry (experimental, src/lib/data-window.ts): an
// item of the conversation's "..." menu (ExportTranscriptMenu), beside the
// Inspector. Absent while the experimental switch is off, on the companion
// connection, where Data is not served, and while the conversation has
// nothing the window can show (conversationHasData): it appears with the
// first result or loaded table, live, and goes with a conversation without.
import { useEffect, useMemo, useRef } from "react";
import { useStoreDispatch, useStoreSelector } from "@/state/store-selector";
import { api, type Bot, type ConfigStatus } from "@/state/store";
import { dataWindowEnabled } from "@/lib/feature-flags";
import { conversationHasData, openDataWindow, subscribeDataWindowMessages } from "@/lib/data-window";
import { t } from "@/lib/i18n";

/** The "Open the Data window" item for this bot, or null where Data is off.
 * A blocked pop-up or a refused window says so in the chat's error banner
 * (the menu is gone by then). */
export function useDataWindowItem(bot: Pick<Bot, "id" | "name" | "messages">): { label: string; onOpen: () => void } | null {
  const dispatch = useStoreDispatch();
  const config = useStoreSelector((current) => current.config);
  // One pass over the transcript the page already holds, again only when it changes.
  const hasData = useMemo(() => conversationHasData(bot.messages), [bot.messages]);
  if (!dataWindowEnabled(config) || window.ogb?.remoteClient?.active === true || !hasData) return null;
  return {
    label: t("dataWindow.open"),
    onOpen: () => {
      void openDataWindow({ botId: bot.id, title: t("dataWindow.title", { name: bot.name }) }).then((result) => {
        if (result === "blocked") dispatch({ type: "error", message: t("dataWindow.blocked") });
        // The desktop asks the page's server again before it opens anything
        // (electron/data-window.mjs). Only its "off" means the switch is off:
        // then this page's copy of the config was stale, so it is read again
        // and Settings shows the server's state, not a switch that lies.
        else if (result === "off") {
          dispatch({ type: "error", message: t("dataWindow.off") });
          void api<ConfigStatus>("/api/config").then((config) => dispatch({ type: "configStatus", config }), () => {});
        }
        // The check itself failed (signed out, no answer): not "off".
        else if (result === "unavailable") dispatch({ type: "error", message: t("dataWindow.unavailable") });
        else if (result === "refused") dispatch({ type: "error", message: t("dataWindow.refused") });
      });
    },
  };
}

/** The main page's side of the Data window: the result in view there is
 * kept here, so the composer sends it with the next message to that bot
 * (shared/data-context.ts). A window that goes clears only its own bot's. */
export function DataWindowViewSync() {
  const dispatch = useStoreDispatch();
  const dataView = useStoreSelector((current) => current.dataView);
  const current = useRef(dataView);
  current.current = dataView;
  useEffect(() => subscribeDataWindowMessages((message) => {
    if (message.type !== "view") return;
    if (message.view) dispatch({ type: "dataView", view: message.view });
    else if (current.current?.botId === message.botId) dispatch({ type: "dataView", view: null });
  }), [dispatch]);
  return null;
}
