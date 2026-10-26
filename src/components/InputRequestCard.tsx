// A teammate parked on a question for the person (server park and remind,
// 2026-10-19). The whole question, never cut, in the conversation the person
// reads, answered in place: the answer is the person's own message into the
// waiting work's conversation, which the runtime takes as the answer
// (coordinator.answer). "Open the conversation" shows that conversation.
import { useState } from "react";

import { api, openThread, useStore, type Message } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { t } from "@/lib/i18n";

export function InputRequestCard({ message }: { message: Message }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const request = message.inputRequest;
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!request) return null;
  const done = sent || request.answered === true;
  const send = async () => {
    const text = answer.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      await api(`/api/bots/${request.botId}/messages`, {
        method: "POST",
        body: JSON.stringify({ text, threadId: request.threadId, sendId: crypto.randomUUID() }),
      });
      setSent(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="flex justify-start py-1" data-testid="input-request-card">
      <div className="w-full max-w-xl rounded-xl border border-border bg-card p-3 text-sm shadow-sm">
        <div className="mb-1 font-medium">
          {t(request.reminder ? "chat.inputRequest.reminder" : "chat.inputRequest.title", { bot: request.botName })}
        </div>
        <div className="whitespace-pre-wrap break-words text-foreground" data-testid="input-request-question">{request.question}</div>
        {done ? (
          <div className="mt-2 text-xs text-muted-foreground">{t("chat.inputRequest.answered")}</div>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            <textarea
              className="min-h-[3rem] w-full resize-y rounded-md border border-border bg-background p-2 text-sm"
              value={answer}
              placeholder={t("chat.inputRequest.placeholder")}
              aria-label={t("chat.inputRequest.placeholder")}
              onChange={(event) => setAnswer(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
              }}
            />
            {error ? <div className="text-xs text-destructive">{error}</div> : null}
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
                disabled={!answer.trim() || sending}
                onClick={() => void send()}
              >
                {t("chat.inputRequest.send")}
              </button>
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1 text-xs"
                onClick={() => openThread(dispatch, { botId: request.botId, threadId: request.threadId }, state, showThreads)}
              >
                {t("chat.inputRequest.open")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
