import type { Action } from "@/state/store";
import { composeMessage } from "./composer-attachments";
import { appendComposerDraft, appendDraftAttachments } from "./drafts";
import { withCitationComment, type CitationAttachment } from "./citations";

/** A reply sends to the current conversation; its quote keeps its original source. */
export function citationReplyAction(citation: CitationAttachment, ownerType: "bot" | "group", ownerId: string, threadId: string): Action {
  const text = citation.comment?.trim() ?? "";
  const quote = withCitationComment(citation, "");
  const draftId = `${ownerType}:${ownerId}:${threadId}`;
  const send = {
    text: composeMessage(text, [quote]), threadId, sendId: crypto.randomUUID(),
    onError: () => { appendComposerDraft(draftId, text); appendDraftAttachments(draftId, [quote]); },
  };
  return ownerType === "bot" ? { type: "send", botId: ownerId, ...send } : { type: "sendGroup", groupId: ownerId, mode: "chat", ...send };
}
