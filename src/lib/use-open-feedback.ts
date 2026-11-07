// The shared "send feedback" action for the desktop and web app (#2618):
// every entry point calls this hook's function, which files nothing by
// itself. It opens a report with the Feedback bot and shows that chat.
import { useCallback, useEffect, useRef } from "react";
import type { FeedbackStartResponse } from "../../shared/feedback";
import { appVersion } from "@/lib/app-links";
import { consoleRingLines } from "@/lib/console-ring";
import { requestFeedback, type FeedbackOpenOptions } from "@/lib/feedback-open";
import { activeLocale } from "@/lib/i18n";
import { useShowThreads } from "@/lib/thread-preferences";
import { readableError } from "@/lib/plain-error";
import { api, openBot, type Bot } from "@/state/store";
import { useStoreDispatch, useStoreGetter } from "@/state/store-selector";
import { MESSAGE_PAGE_SIZE } from "@/state/store/api";

export function useOpenFeedback(): (options: FeedbackOpenOptions) => Promise<void> {
  const dispatch = useStoreDispatch();
  const getState = useStoreGetter();
  const threadsShown = useShowThreads();
  const latest = useRef({ getState, dispatch, threadsShown });
  latest.current = { getState, dispatch, threadsShown };
  const busy = useRef(false);
  return useCallback(async (options: FeedbackOpenOptions) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const now = latest.current.getState();
      const started = await requestFeedback({
        post: (body) => api<FeedbackStartResponse>("/api/feedback/start", { method: "POST", body: JSON.stringify(body) }),
        capture: window.ogb?.captureWindow,
        appVersion: appVersion(),
        userAgent: navigator.userAgent,
        desktop: Boolean(window.ogb),
        page: now.activeView,
        locale: activeLocale(),
        logs: consoleRingLines,
      }, options);
      const { bots } = await api<{ bots: Bot[] }>(`/api/bots?messages=${MESSAGE_PAGE_SIZE}`);
      const bot = bots.find((candidate) => candidate.id === started.botId);
      const { dispatch: send, threadsShown } = latest.current;
      if (!bot) return;
      if (latest.current.getState().bots.some((known) => known.id === bot.id)) send({ type: "botPatched", bot });
      else send({ type: "botAdded", bot });
      openBot(send, bot, threadsShown, { landing: false });
    } catch (error) {
      latest.current.dispatch({ type: "error", message: readableError(error) });
    } finally {
      busy.current = false;
    }
  }, []);
}

/** Help > Send Feedback… on desktop; Cmd/Ctrl+Shift+F in a browser. */
export function useFeedbackShortcut(open: (options: FeedbackOpenOptions) => Promise<void>): void {
  useEffect(() => {
    const listen = window.ogb?.onSendFeedback;
    if (listen) return listen(() => void open({ source: "menu" }));
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      void open({ source: "shortcut" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}

/** Mounted once in the shell: Help > Send Feedback… and the shortcut. */
export function FeedbackShortcut(): null {
  useFeedbackShortcut(useOpenFeedback());
  return null;
}
