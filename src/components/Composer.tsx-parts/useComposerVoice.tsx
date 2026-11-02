import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Action, Bot, Group } from "@/state/store";
import { t } from "@/lib/i18n";
import { markDraftEdited } from "@/lib/drafts";
import { type Attachment } from "@/lib/composer-attachments";
import { ATTACH_ICON, RecordMark, type PlusMenuItem } from "../ComposerControls";
import { useComposerDictation } from "../useComposerDictation";
import { useVoiceNoteRecorder } from "../useVoiceNoteRecorder";
import { dictationEngine, isDictationHold, joinDictated } from "@/lib/composer-dictation";
import { botCtaColors } from "@/lib/voice-cta";
import { useVoiceModeCheck } from "@/lib/voice-mode/api";
import { openProviderKeyDialog } from "../settings/ProviderKeys";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";

export function useComposerVoice({
  bot,
  group,
  remoteClient,
  capabilities,
  threadId,
  draftId,
  text,
  caret,
  setCaret,
  editText,
  editAttachments,
  setChannelMode,
  typedGoalText,
  effectiveChannelMode,
  learnAvailable,
  browserTeach,
  myChromeOffered,
  setTeachChooser,
  setMyChromeRecord,
  showInBrowser,
  fileInput,
  inputRef,
  dispatch,
  send,
}: {
  bot?: Bot;
  group?: Group;
  remoteClient: boolean;
  capabilities: ReturnType<typeof import("@/lib/desktop").desktopCapabilitiesNow>;
  threadId: string;
  draftId: string;
  text: string;
  caret: number;
  setCaret: Dispatch<SetStateAction<number>>;
  editText: (next: string) => void;
  editAttachments: (next: SetStateAction<Attachment[]>) => void;
  setChannelMode: (mode: "chat" | "goal") => void;
  typedGoalText: string | null;
  effectiveChannelMode: "chat" | "goal";
  learnAvailable: boolean;
  browserTeach: boolean;
  myChromeOffered: boolean;
  setTeachChooser: Dispatch<SetStateAction<boolean>>;
  setMyChromeRecord: Dispatch<SetStateAction<boolean>>;
  showInBrowser: () => void;
  fileInput: RefObject<HTMLInputElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  dispatch: Dispatch<Action>;
  send: () => void;
}) {
  // Dictation (the grey mic): the Mac's own, else voice mode's speech to
  // text for this bot, else the mic opens the Keys card (lib/composer-dictation).
  const voiceCheck = useVoiceModeCheck(!group && bot && !remoteClient ? bot.id : "");
  const engine = dictationEngine({
    native: capabilities.dictation.available && Boolean(window.ogb),
    xai: Boolean(!group && bot && voiceCheck.state === "ready" && voiceCheck.status.available),
  });
  const dictation = useComposerDictation({ engine, botId: bot?.id, threadId, text, editText });
  const recording = dictation.phase === "recording";
  const dictating = dictation.phase !== "idle";
  // A voice note (+ > Record a voice note): the clip goes as an audio
  // attachment, its words (this bot's speech to text) as the text, then it
  // sends like the dictation pill's Send (sendAfterDictation below).
  const voiceNote = useVoiceNoteRecorder({
    botId: !group ? bot?.id : undefined,
    threadId,
    transcribe: Boolean(!group && bot && voiceCheck.state === "ready" && voiceCheck.status.available),
    onReady: ({ attachment, transcript }) => {
      editAttachments((prev) => [...prev, attachment]);
      if (transcript) editText(joinDictated(text.trim(), transcript));
      sendAfterDictation.current = true;
    },
  });
  const voiceNoting = voiceNote.phase !== "idle";
  const openDictationSetup = () => {
    dispatch({ type: "toggleAppSettings", open: true, section: "providers" });
    // the xAI key carries voice and dictation (2026-10-14)
    openProviderKeyDialog("xai");
  };
  const toggleMic = () => {
    // one microphone at a time: a voice note keeps it until sent or cancelled
    if (voiceNoting) return;
    if (dictating) {
      dictation.stop();
      return;
    }
    if (!engine) {
      openDictationSetup();
      return;
    }
    void dictation.start();
  };
  // Hold to dictate: a press that starts the mic and is kept down (the mic
  // button, or the shortcut) stops it on release; a tap keeps listening.
  const micHold = useRef<{ at: number; started: boolean } | null>(null);
  const pressMic = () => {
    const started = !dictating && !voiceNoting && Boolean(engine);
    micHold.current = { at: Date.now(), started };
    if (started) void dictation.start();
  };
  const releaseMic = () => {
    const hold = micHold.current;
    if (hold?.started && isDictationHold(hold.at, Date.now())) dictation.stop();
    // the click that follows a pointer press must not toggle it back
    if (hold) window.setTimeout(() => { if (micHold.current === hold) micHold.current = null; }, 0);
  };
  const clickMic = () => {
    if (micHold.current?.started) {
      micHold.current = null;
      return;
    }
    toggleMic();
  };
  // Send from the dictation pill: stop listening, then send what was heard
  // once the field holds it (a transcript lands as the recording settles).
  const sendAfterDictation = useRef(false);
  useEffect(() => {
    if (dictation.phase !== "idle" || voiceNoting || !sendAfterDictation.current) return;
    sendAfterDictation.current = false;
    send();
  });
  const dictationShortcut = isMacPlatform() ? "⌘D" : "Ctrl+D";
  // The CTA (Voice, or Send once typed) wears the open bot's color.
  const ctaTone = !group && bot ? botCtaColors(bot.color) : null;
  // Put a command at the start of the draft, keeping what follows it.
  const startDraftWith = (command: "/learn " | "/setup ") => {
    const rest = text.replace(/^\/(?:learn|setup)\s*/, "");
    editText(`${command}${rest}`);
    setChannelMode("chat");
    const at = command.length;
    setCaret(at);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(at, at);
    });
  };
  const goalModeOn = effectiveChannelMode === "goal";
  // Goal mode off: also what the chip does (a typed /goal loses its token).
  const leaveGoalMode = () => {
    markDraftEdited(draftId);
    if (typedGoalText !== null) {
      const nextCaret = Math.max(0, caret - (text.length - typedGoalText.length));
      editText(typedGoalText);
      setCaret(nextCaret);
      setChannelMode("chat");
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(nextCaret, nextCaret);
      });
      return;
    }
    setChannelMode("chat");
  };
  // The + menu, as in the reference design: attach files and teach a task,
  // (Loop and Goal mode are reached from the "/" menu). The model and the approval level live in the
  // bot's settings; typing /setup still sets the bot up.
  const plusItems: PlusMenuItem[] = [
    { id: "attach", group: "add", label: t("composer.plus.attach"), icon: ATTACH_ICON, onSelect: () => fileInput.current?.click() },
    ...(learnAvailable || browserTeach || myChromeOffered ? [{
      id: "teach",
      group: "add" as const,
      label: t("composer.plus.teach"),
      icon: <RecordMark />,
      ...(learnAvailable ? { hint: "/learn" } : {}),
      // in words, the same as picking /learn in the "/" menu; with a
      // browser, a choice between that and showing it there
      onSelect: () => [learnAvailable, browserTeach, myChromeOffered].filter(Boolean).length > 1 ? setTeachChooser(true)
        : browserTeach ? showInBrowser() : myChromeOffered ? setMyChromeRecord(true) : startDraftWith("/learn "),
    }] : []),
  ];

  return {
    voiceCheck, engine, dictation, recording, dictating, voiceNote, voiceNoting,
    openDictationSetup, toggleMic, micHold, pressMic, releaseMic, clickMic,
    sendAfterDictation, dictationShortcut, ctaTone, startDraftWith,
    goalModeOn, leaveGoalMode, plusItems,
  };
}
