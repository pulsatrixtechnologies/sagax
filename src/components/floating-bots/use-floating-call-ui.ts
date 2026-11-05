// Voice call wiring for FloatingBots: call panel, callDeps, levels and hotkey.
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { t } from "@/lib/i18n";
import { currentCall, endCall, startCall, useOnCall } from "@/lib/call";
import { speaker } from "@/lib/tts";
import { fetchVoiceModeVoices } from "@/lib/voice-mode/api";
import { notifyCallSettings, readCallSettings, useCallSettings, writeCallSettings } from "@/lib/voice-mode/call-settings";
import { liveCallNow, useLiveCall } from "@/lib/voice-mode/live-call-store";
import { readVoiceModeSettings, useVoiceModeSettings, voiceSettingsForBot, writeVoiceForBot, writeVoiceModeSettings } from "@/lib/voice-mode/settings";
import { forgetVoiceprint } from "@/lib/voice-mode/speaker-id";
import { readableOr } from "../../../shared/human-id";
import { readableError } from "@/lib/plain-error";
import { ACHIEVEMENT_UNLOCKED_EVENT } from "@/lib/achievements";
import { NUDGE_RECEIVED_EVENT } from "@/lib/desktop-nudge";
import { floatingBotPrefs } from "@/lib/floating-bots";
import { callLevels, NO_PANEL, runMascotCallEvent, type MascotCallDeps, type MascotCallPanel } from "./mascot-call";
import { hotkeyAction, hotkeyBot, hotkeyConfig, type HotkeyKind } from "./hotkey";
import type { FloatingBotsBridge, FloatingCallLevels, FloatingCue } from "./protocol";
import type { FloatingSession } from "./brain";
import { LEVEL_MS, pageLevels } from "./floating-avatars";

export interface FloatingCallUi {
  live: ReturnType<typeof useLiveCall>;
  onCall: ReturnType<typeof useOnCall>;
  voiceSettings: ReturnType<typeof useVoiceModeSettings>;
  callSettings: ReturnType<typeof useCallSettings>;
  callPanel: MascotCallPanel;
  callDeps: (botId: string) => MascotCallDeps;
  cue: (FloatingCue & { botId?: string }) | null;
  setCue: React.Dispatch<React.SetStateAction<(FloatingCue & { botId?: string }) | null>>;
  /** Parent sets which mascot is on the line (levels). */
  callOnMascotRef: MutableRefObject<string | null>;
  /** Parent sets the floated bot ids (hotkey). */
  shownIdsRef: MutableRefObject<string[]>;
  /** Parent sets per-bot voice availability (hotkey). */
  callableRef: MutableRefObject<Record<string, boolean | undefined>>;
}

export function useFloatingCallUi({
  bridge,
  patch,
  prefsHotkey,
  prefsHotkeyKeys,
  callable,
}: {
  bridge: FloatingBotsBridge | null;
  patch: (botId: string, change: Partial<FloatingSession> | ((session: FloatingSession) => Partial<FloatingSession>)) => void;
  prefsHotkey: boolean;
  prefsHotkeyKeys: string;
  callable: Record<string, boolean | undefined>;
}): FloatingCallUi {
  const live = useLiveCall();
  const onCall = useOnCall();
  const voiceSettings = useVoiceModeSettings();
  const callSettings = useCallSettings();
  const [callPanel, setCallPanel] = useState<MascotCallPanel>(NO_PANEL);
  const callPanelRef = useRef(callPanel);
  callPanelRef.current = callPanel;
  useEffect(() => setCallPanel(NO_PANEL), [live?.call]);

  const callOnMascotRef = useRef<string | null>(null);
  const shownIdsRef = useRef<string[]>([]);
  const callableRef = useRef(callable);
  callableRef.current = callable;

  const [cue, setCue] = useState<(FloatingCue & { botId?: string }) | null>(null);
  useEffect(() => {
    const nudge = () => setCue({ kind: "nudge", at: Date.now() });
    const achievement = () => setCue({ kind: "achievement", at: Date.now() });
    window.addEventListener(NUDGE_RECEIVED_EVENT, nudge);
    window.addEventListener(ACHIEVEMENT_UNLOCKED_EVENT, achievement);
    return () => {
      window.removeEventListener(NUDGE_RECEIVED_EVENT, nudge);
      window.removeEventListener(ACHIEVEMENT_UNLOCKED_EVENT, achievement);
    };
  }, []);

  // the call's levels, a few times a frame-second, to the mascot on the line
  useEffect(() => {
    const data = new Uint8Array(1024);
    let last = "";
    let lastId: string | null = null;
    const send = (id: string, levels: FloatingCallLevels) => {
      bridge?.level?.(id, levels);
      for (const listener of Array.from(pageLevels)) listener(levels);
    };
    const timer = setInterval(() => {
      const id = callOnMascotRef.current;
      if (!id) {
        if (lastId) {
          send(lastId, { bot: 0, mic: 0 });
          lastId = null;
          last = "";
        }
        return;
      }
      lastId = id;
      const levels = callLevels(liveCallNow(), data);
      const key = `${levels.bot}:${levels.mic}`;
      if (key === last) return;
      last = key;
      send(id, levels);
    }, LEVEL_MS);
    return () => {
      clearInterval(timer);
      if (lastId) send(lastId, { bot: 0, mic: 0 });
    };
  }, [bridge]);

  const callDeps = useCallback((botId: string): MascotCallDeps => {
    const liveNow = liveCallNow();
    const setPanel = (change: Partial<MascotCallPanel>) => setCallPanel((current) => ({ ...current, ...change }));
    return {
      available: callableRef.current[botId] === true,
      live: liveNow,
      current: currentCall,
      start: startCall,
      end: endCall,
      closeBalloon: () => patch(botId, { open: false }),
      voices: () => {
        if (callPanelRef.current.voices) return;
        fetchVoiceModeVoices(botId).then(
          (voices) => setPanel({ voices, voicesError: null }),
          (error: unknown) => setPanel({ voicesError: readableError(error) }),
        );
      },
      preview: (voiceId) => {
        if (callPanelRef.current.previewing?.id === voiceId) {
          speaker.stop();
          setPanel({ previewing: null });
          return;
        }
        liveNow?.call.interrupt();
        setPanel({ previewing: { id: voiceId, loading: true } });
        const label = readableOr(callPanelRef.current.voices?.find((voice) => voice.id === voiceId)?.label ?? voiceId, t("ids.customVoice"));
        const unsubscribe = speaker.subscribe((snapshot) => {
          if (snapshot.status === "speaking") setCallPanel((current) => (current.previewing?.id === voiceId ? { ...current, previewing: { id: voiceId, loading: false } } : current));
        });
        void speaker
          .speak(t("voiceMode.previewLine", { voice: label }), { botId, voiceMode: { settings: { ...voiceSettingsForBot(readVoiceModeSettings(), botId), voice: voiceId } } })
          .finally(() => {
            unsubscribe();
            setCallPanel((current) => (current.previewing?.id === voiceId ? { ...current, previewing: null } : current));
          });
      },
      enroll: () => {
        if (!liveNow) return;
        setPanel({ enrollment: { state: "recording", share: 0 } });
        void liveNow.call.enroll((share) => setPanel({ enrollment: { state: "recording", share } })).then((ok) => {
          setPanel({ enrollment: ok ? { state: "enrolled" } : { state: "failed" } });
          if (ok) writeCallSettings({ onlyMyVoice: true });
          notifyCallSettings();
        });
      },
      forget: () => {
        forgetVoiceprint();
        liveNow?.call.forgetVoice();
        setPanel({ enrollment: { state: "none" } });
        notifyCallSettings();
      },
      writeSettings: ({ voice, ...rest }) => {
        if (voice !== undefined) writeVoiceForBot(botId, voice);
        if (Object.keys(rest).length) writeVoiceModeSettings(rest);
      },
      writeCallSettings: (change) => void writeCallSettings(change),
    };
  }, [patch]);

  /* ------------------------------------------------- the call hotkey */
  const keyBot = hotkeyBot(shownIdsRef.current, onCall);
  const hotkeyWish = hotkeyConfig({
    enabled: prefsHotkey,
    accelerator: prefsHotkeyKeys,
    botId: keyBot && callable[keyBot] === true ? keyBot : null,
    callBot: onCall,
    push: callSettings.input === "push",
  });
  const hotkeyKey = `${hotkeyWish.enabled}:${hotkeyWish.accelerator}:${hotkeyWish.hold}:${shownIdsRef.current.join(",")}:${Object.entries(callable).map(([id, ok]) => `${id}:${ok ? 1 : 0}`).join("|")}`;
  useEffect(() => {
    if (!bridge?.hotkey) return;
    const wish = hotkeyConfig({
      enabled: prefsHotkey,
      accelerator: prefsHotkeyKeys,
      botId: (() => {
        const bot = hotkeyBot(shownIdsRef.current, onCall);
        return bot && callableRef.current[bot] === true ? bot : null;
      })(),
      callBot: onCall,
      push: callSettings.input === "push",
    });
    void bridge.hotkey(wish).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, hotkeyKey, prefsHotkey, prefsHotkeyKeys, onCall, callSettings.input]);
  useEffect(() => () => void bridge?.hotkey?.({ enabled: false, accelerator: prefsHotkeyKeys, hold: false }).catch(() => undefined), [bridge, prefsHotkeyKeys]);
  const talking = useRef<string | null>(null);
  useEffect(() => {
    if (!bridge?.onHotkey) return;
    return bridge.onHotkey((value) => {
      const kind = value?.kind as HotkeyKind | undefined;
      if (kind !== "tap" && kind !== "hold" && kind !== "release") return;
      const callBot = currentCall();
      const botId = hotkeyBot(shownIdsRef.current, callBot);
      const liveNow = liveCallNow();
      const action = hotkeyAction(kind, {
        enabled: floatingBotPrefs().hotkey,
        botId,
        canCall: botId ? callableRef.current[botId] === true : false,
        callBot,
        muted: Boolean(liveNow && liveNow.botId === callBot && liveNow.state.muted),
        push: readCallSettings().input === "push",
        talking: talking.current !== null,
      });
      if (action === "release") {
        const bot = talking.current;
        talking.current = null;
        if (bot) runMascotCallEvent(bot, "release", {}, callDeps(bot));
        return;
      }
      if (action === "none" || !botId) return;
      if (action === "talk") talking.current = botId;
      runMascotCallEvent(botId, action, {}, callDeps(botId));
    });
  }, [bridge, callDeps]);

  return { live, onCall, voiceSettings, callSettings, callPanel, callDeps, cue, setCue, callOnMascotRef, shownIdsRef, callableRef };
}
