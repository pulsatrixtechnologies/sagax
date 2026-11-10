// /feedback typed in a chat (#2618, #3299): the one way to send the team a
// report. It goes to the chat it is typed in, at once (never behind a
// running turn, #2955), with what the app knows attached; the server reads
// the chat, asks at most one question and shows the exact anonymized
// report there before anything leaves.
import { useCallback, useRef } from "react";
import { appVersion } from "@/lib/app-links";
import { consoleRingLines } from "@/lib/console-ring";
import { feedbackAppContext } from "@/lib/feedback-open";
import { activeLocale } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import { api, type Message } from "@/state/store";
import { useStoreDispatch, useStoreGetter } from "@/state/store-selector";

export interface SendFeedbackInput {
  botId: string;
  threadId: string;
  /** The whole command as typed, `/feedback` included. */
  text: string;
}

export function useSendFeedback(): (input: SendFeedbackInput) => Promise<void> {
  const dispatch = useStoreDispatch();
  const getState = useStoreGetter();
  const latest = useRef({ getState, dispatch });
  latest.current = { getState, dispatch };
  return useCallback(async ({ botId, threadId, text }: SendFeedbackInput) => {
    try {
      const feedback = feedbackAppContext({
        appVersion: appVersion(),
        userAgent: navigator.userAgent,
        desktop: Boolean(window.ogb),
        page: latest.current.getState().activeView,
        locale: activeLocale(),
        logs: consoleRingLines,
      });
      const body = await api<{ threadId?: string; message?: Message }>(`/api/bots/${botId}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: text.trim(), threadId, sendId: crypto.randomUUID(), feedback }),
      });
      if (body?.message && typeof body.threadId === "string") {
        latest.current.dispatch({ type: "messageAdded", threadId: body.threadId, message: body.message });
      }
    } catch (error) {
      latest.current.dispatch({ type: "error", message: readableError(error) });
    }
  }, []);
}
