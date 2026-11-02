import { useCallback, useEffect, useRef, useState } from "react";
import type { Message } from "@/state/store";
import { composerShouldRefocus, composerTakesFocusOnOpen, replyTargetTakesFocus } from "@/lib/composer-attachments";
import type { ComposerModelMenuControl } from "../ModelPicker";

export function useComposerFocus({
  draftId,
  focusOnOpen,
  replyTo,
}: {
  draftId: string;
  focusOnOpen: boolean;
  replyTo?: Message | null;
}) {
  const [caret, setCaret] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null); // Esc'd this @
  const [dismissedSlashAt, setDismissedSlashAt] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const draftIdRef = useRef(draftId);
  draftIdRef.current = draftId;
  // the latest caret, readable from callbacks without re-creating them
  const caretRef = useRef(0);
  caretRef.current = caret;
  /** Returns keyboard focus to the draft, keeping the caret where it was. */
  const refocusInput = useCallback(() => {
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || input.disabled || !composerShouldRefocus(document.activeElement, input)) return;
      const at = Math.min(caretRef.current, input.value.length);
      input.focus();
      input.setSelectionRange(at, at);
    });
  }, []);
  // The composer is keyed by thread, so mounting means a thread was just
  // opened: put the caret at the end of its draft so the person can type
  // without clicking the box first. Touch screens are skipped — focusing
  // there pops the on-screen keyboard over the conversation.
  const focusOnOpenRef = useRef(focusOnOpen);
  useEffect(() => {
    if (!focusOnOpenRef.current) return;
    if (window.matchMedia?.("(hover: none) and (pointer: coarse)").matches) return;
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || input.disabled || !composerTakesFocusOnOpen(document.activeElement, input)) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  // Choosing a message to reply to means typing the reply comes next, so the
  // caret follows the new target the same way it does when a thread opens.
  // A reply restored with the thread is the open effect's; the ref starts on
  // it so the two never both run.
  const replyToId = replyTo?.id ?? null;
  const focusedReplyRef = useRef(replyToId);
  useEffect(() => {
    const previous = focusedReplyRef.current;
    focusedReplyRef.current = replyToId;
    if (!replyTargetTakesFocus(previous, replyToId)) return;
    if (window.matchMedia?.("(hover: none) and (pointer: coarse)").matches) return;
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || input.disabled || !composerTakesFocusOnOpen(document.activeElement, input)) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    return () => cancelAnimationFrame(frame);
  }, [replyToId]);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const commandListRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // A headless model picker stays mounted here: the desktop mascot's model
  // chip opens it (the + menu has no Model row, as in the reference design).
  const modelMenu = useRef<ComposerModelMenuControl | null>(null);
  const composerRowRef = useRef<HTMLDivElement>(null);

  return {
    caret, setCaret,
    dismissedAt, setDismissedAt,
    dismissedSlashAt, setDismissedSlashAt,
    inputRef, draftIdRef, caretRef, refocusInput,
    mentionListRef, commandListRef, fileInput, modelMenu, composerRowRef,
  };
}
