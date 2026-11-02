import type { KeyboardEvent } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { imeComposing, sendsMessage, type SendKey } from "@/lib/send-key";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import { escapeCancelsReply } from "@/lib/replies";
import { doubleEnterSteersQueue } from "../ComposerQueuedMessages";
import type { ComposerMenuItem } from "@/lib/composer-commands";
import type { MentionChoice } from "./types";

export function useComposerKeyDown({
  commandPickerOpen,
  mentionPickerOpen,
  commandCandidates,
  candidates,
  highlight,
  setHighlight,
  pickCommand,
  pickMention,
  slash,
  mention,
  setDismissedSlashAt,
  setDismissedAt,
  onClearReply,
  replyTo,
  recording,
  busy,
  locked,
  hasContent,
  onEditLast,
  interruptTurn,
  sendKey,
  canSteer,
  steerAgainUntilRef,
  pendingCount,
  steerQueued,
  send,
  dictation,
  micHold,
  pressMic,
  toggleMic,
}: {
  commandPickerOpen: boolean;
  mentionPickerOpen: boolean;
  commandCandidates: ComposerMenuItem[];
  candidates: MentionChoice[];
  highlight: number;
  setHighlight: Dispatch<SetStateAction<number>>;
  pickCommand: (item: ComposerMenuItem | undefined) => void;
  pickMention: (peer: MentionChoice) => void;
  slash: { start: number } | null;
  mention: { start: number } | null;
  setDismissedSlashAt: Dispatch<SetStateAction<number | null>>;
  setDismissedAt: Dispatch<SetStateAction<number | null>>;
  onClearReply?: () => void;
  replyTo?: { id: string } | null;
  recording: boolean;
  busy: boolean;
  locked: boolean;
  hasContent: boolean;
  onEditLast?: () => void;
  interruptTurn: () => void;
  sendKey: SendKey;
  canSteer: boolean;
  steerAgainUntilRef: MutableRefObject<number>;
  pendingCount: number;
  steerQueued: () => void;
  send: () => void;
  dictation: { stop: () => void };
  micHold: MutableRefObject<{ at: number; started: boolean } | null>;
  pressMic: () => void;
  toggleMic: () => void;
}) {
  return (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // an input method's keys pick its own candidates: its confirming
    // Enter must not pick a mention or command, nor its arrows move them
    if (imeComposing(e.nativeEvent)) return;
    // ⌘D / Ctrl+D dictates (Grok Bot's shortcut), and stops it
    if ((isMacPlatform() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      // a key held down repeats: the first press only decides
      if (e.repeat) return;
      pressMic();
      if (!micHold.current?.started) {
        micHold.current = null;
        toggleMic();
      }
      return;
    }
    if (commandPickerOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setHighlight((current) =>
          (current + delta + commandCandidates.length) % commandCandidates.length,
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickCommand(commandCandidates[highlight]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedSlashAt(slash?.start ?? null);
        return;
      }
    }
    if (mentionPickerOpen) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setHighlight((h) => (h + delta + candidates.length) % candidates.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(candidates[highlight]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedAt(mention?.start ?? null);
        return;
      }
    }
    // Escape drops the reply target, the strip's x from the keyboard
    if (onClearReply && escapeCancelsReply(e.nativeEvent, { replying: Boolean(replyTo), recording })) {
      e.preventDefault();
      onClearReply();
      return;
    }
    // Escape in an empty composer stops the running turn (there is no
    // Stop button: typing "stop" works too)
    if (e.key === "Escape" && busy && !locked && !recording && !hasContent) {
      e.preventDefault();
      interruptTurn();
      return;
    }
    // an empty composer + ArrowUp = edit your last message (like a chat app)
    if (e.key === "ArrowUp" && !hasContent && onEditLast) {
      e.preventDefault();
      onEditLast();
      return;
    }
    // the chosen send key sends; any other Enter is a new line
    if (sendsMessage(e.nativeEvent, sendKey)) {
      e.preventDefault();
      // The second Enter of the gesture: the chip above is waiting,
      // the composer is empty, and the window is open — steer the
      // queue into the running turn instead of waiting it out.
      if (
        canSteer &&
        doubleEnterSteersQueue(steerAgainUntilRef.current, Date.now(), pendingCount, hasContent)
      ) {
        steerAgainUntilRef.current = 0;
        steerQueued();
        return;
      }
      send();
    }
    // handled here: an open page's Escape-to-close leaves it alone
    if (e.key === "Escape" && recording) { e.preventDefault(); dictation.stop(); }
  };
}
