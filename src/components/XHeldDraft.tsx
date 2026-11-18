// A bot's own X post call, held for the person's answer, as the X draft card (#4638).
// One component for every place the held call waits (the pinned card in the chat and
// the Approvals inbox), so it is one card with one state: Post answers that call;
// edited, it refuses the call and posts the new text through the draft route;
// Discard refuses it.
import { api, useStore, type Message } from "@/state/store";
import { heldXDraft, xDraftKey } from "../../shared/x-post";
import { XDraftCard } from "./XPostCards";

/** The draft a held call carries, when it is an X post the person answers here. */
export function heldXDraftOf(message: Message | undefined) {
  const card = message?.card;
  return card && !card.adminApproval ? heldXDraft(card.tool, card.toolInput) : null;
}

export function XHeldDraft({ message, threadId, requestId, onDecided, onDecideFailed }: {
  message: Message;
  /** where the answer goes (the conversation the call was made in) */
  threadId: string;
  requestId: string;
  onDecided?: (behavior: "allow" | "deny") => void;
  onDecideFailed?: () => void;
}) {
  const { dispatch } = useStore();
  const draft = heldXDraftOf(message);
  if (!draft) return null;
  const decide = (behavior: "allow" | "deny", denyMessage?: string) => {
    onDecided?.(behavior);
    dispatch({
      type: "decideRequest",
      threadId,
      requestId,
      behavior,
      ...(behavior === "deny" ? { message: denyMessage ?? "Denied by the user." } : {}),
      settle: { answered: behavior },
      resumes: true,
      ...(onDecideFailed ? { onError: () => onDecideFailed() } : {}),
    });
  };
  return (
    <XDraftCard
      draft={draft}
      held={{
        onDiscard: () => decide("deny"),
        onPost: (text, edited) => {
          if (!edited) return decide("allow");
          // the held call carries the old text: refuse it, and post the edited one through the draft route
          void api(`/api/threads/${encodeURIComponent(threadId)}/x-posts/post`, {
            method: "POST",
            body: JSON.stringify({ botId: message.from?.botId, messageId: message.id, draftKey: xDraftKey(draft.text), draft: { text } }),
          }).catch(() => onDecideFailed?.());
          decide("deny", "Denied by the user: they edited the post and are sending you the new text.");
        },
      }}
    />
  );
}
