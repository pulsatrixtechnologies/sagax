// The floating bots' brain, in the main app page (lazy: fetched only once a
// bot floats). For every bot put "on the desktop" it follows that bot's
// thread in the store, turns it into a pose and a balloon (brain.ts), and
// either sends the snapshot to the bot's own desktop window through main
// (electron/floating-bot-window.mjs) or, in a browser and on a phone, draws
// the bot over the app itself as a draggable overlay. Every API call happens
// here, through the store, exactly as if the message had been typed in the
// app: the floating windows never hold a session.
import { useShowThreads } from "@/lib/thread-preferences";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ACHIEVEMENT_UNLOCKED_EVENT, reportAchievement } from "@/lib/achievements";
import { NUDGE_RECEIVED_EVENT } from "@/lib/desktop-nudge";
import { api, openThread, useStore, useStreaming, type Bot } from "@/state/store";
import { loadBotActivity, type BotActivityList } from "@/lib/bot-activity";
import { pendingApprovals } from "@/components/PendingApproval";
import { activeLocale, t } from "@/lib/i18n";
import { brand } from "@/lib/brand";
import { useRetroSkin } from "@/components/RetroChromeHost";
import { botAvatarProfile } from "../../../shared/bot-avatar";
import { completeMascotLook } from "../../../shared/mascot-look";
import {
  floatingBotPrefs,
  floatingBots,
  floatingShown,
  nextFloatingReturn,
  nextLiveliness,
  SNOOZE_MS,
  snoozeFloatingBot,
  switchFloatingBot,
  setFloatingBotOnTop,
  setFloatingFlyAway,
  setFloatingLiveliness,
  type FloatingLiveliness,
  setFloatingBotPosition,
  subscribeFloatingBots,
  unfloatBot,
  type FloatingBotEntry,
} from "@/lib/floating-bots";
import {
  buildFloatingSnapshot,
  clampOverlayPosition,
  defaultOverlayPosition,
  floatingStatus,
  floatingTask,
  newFloatingSession,
  withHistory,
  type FloatingLabels,
  type FloatingSession,
} from "./brain";
import { FloatingBotView, MASCOT_SIZE, type FloatingMover } from "./FloatingBotView";
import { floatingContext } from "./context";
import { useAppTheme } from "./theme";
import { moodNow, raiseMood, readMoods, writeMoods, type MoodGain, type MoodRecord } from "./mood";
import { isFloatingEvent, type FloatingAvatar, type FloatingBotsBridge, type FloatingCallLevels, type FloatingCue, type FloatingEvent, type FloatingSnapshot } from "./protocol";
import { currentCall, endCall, startCall, useOnCall } from "@/lib/call";
import { speaker } from "@/lib/tts";
import { fetchVoiceModeVoices, useVoiceModeAvailable } from "@/lib/voice-mode/api";
import { notifyCallSettings, readCallSettings, useCallSettings, writeCallSettings } from "@/lib/voice-mode/call-settings";
import { liveCallNow, useLiveCall } from "@/lib/voice-mode/live-call-store";
import { readVoiceModeSettings, useVoiceModeSettings, writeVoiceModeSettings } from "@/lib/voice-mode/settings";
import { forgetVoiceprint } from "@/lib/voice-mode/speaker-id";
import { callLevels, callPose, mascotCallSnapshot, NO_PANEL, runMascotCallEvent, type MascotCallDeps, type MascotCallPanel } from "./mascot-call";
import { hotkeyAction, hotkeyBot, hotkeyConfig, type HotkeyKind } from "./hotkey";
import { buildTray, type TrayApproval, type TrayTarget } from "./tray";
import { characterMoves, isMoveClip } from "./moves";
import { cueClipFor, SNOOZE_NAP_MS } from "./mascots";
import { COMPOSER_ATTACH_EVENT } from "@/components/Composer";
import { COMPOSER_MODEL_EVENT, composerModelLabel } from "@/components/ModelPicker";
import { readableOr } from "../../../shared/human-id";

/** A picture bigger than this stays in the app; the window shows the owl instead. */
const AVATAR_BYTES_MAX = 280_000;
const CELEBRATE_MS = 1400;

function labelsFor(bot: Pick<Bot, "name">, liveliness: FloatingLiveliness = "normal"): FloatingLabels {
  const name = bot.name;
  const labels: FloatingLabels = {
    character: t("floatingBots.aria", { name }),
    inputLabel: t("floatingBots.input.label", { name }),
    placeholder: t("floatingBots.input.placeholder", { name }),
    send: t("floatingBots.send"),
    open: t("floatingBots.open", { app: brand().name }),
    close: t("floatingBots.menu.hide"),
    hello: t("floatingBots.hello"),
    thinking: t("floatingBots.thinking"),
    approvalTitle: t("floatingBots.approval.title"),
    approval: t("floatingBots.approval", { name }),
    errorTitle: t("floatingBots.error.title"),
    error: t("floatingBots.error"),
    menuOpen: t("floatingBots.menu.openThread"),
    menuHide: t("floatingBots.menu.hide"),
    menuShow: t("floatingBots.menu.show"),
    menuTop: t("floatingBots.menu.top"),
    menuDock: t("floatingBots.menu.dock"),
    menuFly: t("floatingBots.menu.fly"),
    moodLow: t("floatingBots.mood.low", { name }),
    moodOk: t("floatingBots.mood.ok", { name }),
    moodHappy: t("floatingBots.mood.happy", { name }),
    working: t("floatingBots.working", { name }),
    hoot: t("floatingBots.hoot"),
    pin: t("floatingBots.pin"),
    menuLively: t("floatingBots.menu.lively", { level: t(`floatingBots.lively.${liveliness}`) }),
    menuTalk: t("floatingBots.menu.talk"),
    menuCloseChat: t("floatingBots.menu.closeChat"),
    menuCall: t("floatingBots.menu.startCall"),
    menuHangUp: t("floatingBots.menu.hangUp"),
    menuSwitch: t("floatingBots.menu.switch"),
    menuMoves: t("floatingBots.menu.moves"),
    menuSnooze: t("floatingBots.menu.snooze"),
    menuHideMascot: t("floatingBots.menu.hideMascot"),
    menuOptions: t("floatingBots.menu.options"),
    menuSettings: t("floatingBots.menu.settings"),
    attach: t("composer.attach"),
  };
  // "Open in Sagax" (the brand's name), the item that focuses the app on this bot
  return { ...labels, menuOpen: t("floatingBots.menu.openIn", { app: brand().name }) };
}

function useReducedMotion(): boolean {
  const query = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const [reduced, setReduced] = useState(() => Boolean(query?.matches));
  useEffect(() => {
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, [query]);
  return reduced;
}

/** The bot's own picture, when it has one: the app URL in the overlay, a data: URL for a desktop window. */
function avatarBase(bot: Bot): Omit<FloatingAvatar, "src"> & { url: string } | null {
  const profile = botAvatarProfile(bot);
  if (!profile.avatarUrl || profile.avatarCrop === "mascot") return null;
  return {
    url: profile.avatarUrl,
    crop: profile.avatarCrop,
    zoom: bot.avatarZoom ?? 1,
    focusX: bot.avatarFocusX ?? 0.5,
    focusY: bot.avatarFocusY ?? 0.5,
  };
}

/** Reads each picture once, same-origin with the page's own session, into a bounded data: URL. */
function useAvatarData(urls: string[], enabled: boolean): Record<string, string> {
  const [data, setData] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  const key = urls.join("|");
  useEffect(() => {
    if (!enabled) return;
    for (const url of urls) {
      if (asked.current.has(url)) continue;
      asked.current.add(url);
      void fetch(url, { credentials: "same-origin" })
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => {
          if (!blob || blob.size > AVATAR_BYTES_MAX || !/^image\/(png|jpeg|gif|webp)$/.test(blob.type)) return null;
          return new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        })
        .then((src) => {
          if (src) setData((current) => ({ ...current, [url]: src }));
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return data;
}

/** The call's levels for a mascot drawn in this page (the browser overlay); a desktop window gets them through main. */
const pageLevels = new Set<(levels: FloatingCallLevels) => void>();
const onPageLevels = (listener: (levels: FloatingCallLevels) => void) => {
  pageLevels.add(listener);
  return () => void pageLevels.delete(listener);
};
/** How often the call's levels reach the mascot (its waveform and its bounce). */
const LEVEL_MS = 50;

function desktopBridge(): FloatingBotsBridge | null {
  if (typeof window === "undefined") return null;
  return (window.ogb?.floatingBots as FloatingBotsBridge | undefined) ?? null;
}

export function FloatingBots() {
  const { state, dispatch } = useStore();
  const { streaming } = useStreaming();
  const entries = useSyncExternalStore(subscribeFloatingBots, floatingBots, floatingBots);
  const prefs = useSyncExternalStore(subscribeFloatingBots, floatingBotPrefs, floatingBotPrefs);
  // each mascot's mood, kept on this device (mood.ts); refreshed now and then so it drifts down
  const [moods, setMoods] = useState<Record<string, MoodRecord>>(() => readMoods());
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 5 * 60_000);
    return () => clearInterval(timer);
  }, []);
  const cheer = useCallback((botId: string, gain: MoodGain) => {
    setMoods((current) => {
      const next = { ...current, [botId]: raiseMood(current[botId], gain, Date.now()) };
      writeMoods(next);
      return next;
    });
  }, []);
  const retro = useRetroSkin();
  // the desktop balloon wears the app's skin and accent, and follows a change at once
  const theme = useAppTheme();
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const bridge = useMemo(desktopBridge, []);
  const [sessions, setSessions] = useState<Record<string, FloatingSession>>({});
  const stateRef = useRef(state);
  const showThreads = useShowThreads();
  const showThreadsRef = useRef(showThreads);
  showThreadsRef.current = showThreads;
  stateRef.current = state;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const locale = activeLocale();

  /* ------------------------------------------------------- voice calls */

  // the app's call (voice mode), whoever started it: the mascot of that bot shows it
  const live = useLiveCall();
  const onCall = useOnCall();
  const voiceSettings = useVoiceModeSettings();
  const callSettings = useCallSettings();
  const [callPanel, setCallPanel] = useState<MascotCallPanel>(NO_PANEL);
  const callPanelRef = useRef(callPanel);
  callPanelRef.current = callPanel;
  // a new call (or none) starts with a closed settings card
  useEffect(() => setCallPanel(NO_PANEL), [live?.call]);

  // a nudge or an achievement reaches every mascot shown (a Shiba barks, or turns in circles)
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

  // "Hide for 1 hour": a hidden mascot is left out until its time, then comes back by itself
  const [now, setNow] = useState(() => Date.now());
  const comesBack = nextFloatingReturn(entries, now);
  useEffect(() => {
    if (comesBack === null) return;
    const later = setTimeout(() => setNow(Date.now()), Math.max(0, comesBack - Date.now()) + 50);
    return () => clearTimeout(later);
  }, [comesBack]);
  const floated = entries
    .filter((entry) => floatingShown(entry, now))
    .map((entry) => ({ entry, bot: state.bots.find((candidate) => candidate.id === entry.id) }))
    .filter((item): item is { entry: FloatingBotEntry; bot: Bot } => Boolean(item.bot));

  // A bot deleted or hidden since it was floated goes back (once the bots are loaded).
  useEffect(() => {
    if (state.bots.length === 0) return;
    for (const entry of entries) {
      const bot = state.bots.find((candidate) => candidate.id === entry.id);
      if (!bot || bot.hidden) unfloatBot(entry.id);
    }
  }, [entries, state.bots]);

  const patch = useCallback((botId: string, change: Partial<FloatingSession> | ((session: FloatingSession) => Partial<FloatingSession>)) => {
    setSessions((current) => {
      const session = current[botId] ?? newFloatingSession();
      const next = typeof change === "function" ? change(session) : change;
      return { ...current, [botId]: { ...session, ...next } };
    });
  }, []);

  const callable = useVoiceModeAvailable(floated.map(({ bot }) => bot.id));
  const callableRef = useRef(callable);
  callableRef.current = callable;
  const callOnMascot = live && floated.some(({ bot }) => bot.id === live.botId) ? live.botId : null;

  /* ---------------------------------------------- the activity tray */

  // One tray at a time (the hover controls' bell): this bot's running work and the approvals it waits on
  const [trayFor, setTrayFor] = useState<string | null>(null);
  const [trayData, setTrayData] = useState<{ botId: string; list: BotActivityList | null; approvals: TrayApproval[]; loading: boolean } | null>(null);
  const trayTargets = useRef(new Map<string, TrayTarget>());
  const trayBot = trayFor ? state.bots.find((candidate) => candidate.id === trayFor) : undefined;
  const traySignature = trayBot ? `${trayBot.threadId}:${(trayBot.tasks ?? []).map((task) => `${task.threadId}:${task.busy ? 1 : 0}:${task.activity ?? ""}:${task.updatedAt ?? 0}`).join("|")}:${trayBot.messages.length}` : "";
  useEffect(() => {
    if (!trayFor) {
      setTrayData(null);
      return;
    }
    let alive = true;
    setTrayData((current) => (current?.botId === trayFor ? current : { botId: trayFor, list: null, approvals: [], loading: true }));
    const load = async () => {
      const bot = stateRef.current.bots.find((candidate) => candidate.id === trayFor);
      if (!bot) return;
      // approvals on the thread on screen (already loaded), then the other threads that wait on the person
      const approvals: TrayApproval[] = pendingApprovals(bot.messages).map((pending) => ({ threadId: bot.threadId, requestId: pending.requestId, tool: pending.tool, detail: pending.detail ?? "" }));
      const waiting = (bot.tasks ?? []).filter((task) => task.activity === "waiting-on-you" && task.threadId !== bot.threadId).slice(0, 4);
      const pages = await Promise.all(waiting.map((task) => api<{ messages?: Parameters<typeof pendingApprovals>[0] }>(`/api/threads/${encodeURIComponent(task.threadId)}/messages?limit=60`).then(
        (page) => pendingApprovals(page.messages ?? []).map((pending) => ({ threadId: task.threadId, requestId: pending.requestId, tool: pending.tool, detail: pending.detail ?? "" })),
        () => [] as TrayApproval[],
      )));
      const list = await loadBotActivity(api, trayFor, { limit: 50 }).catch(() => null);
      if (alive) setTrayData({ botId: trayFor, list, approvals: [...approvals, ...pages.flat()], loading: false });
    };
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [trayFor, traySignature]);
  // the call's levels, a few times a frame-second, to the mascot on the line (its waveform and bounce)
  useEffect(() => {
    if (!callOnMascot) return;
    const data = new Uint8Array(1024);
    let last = "";
    const send = (levels: FloatingCallLevels) => {
      bridge?.level?.(callOnMascot, levels);
      for (const listener of Array.from(pageLevels)) listener(levels);
    };
    const timer = setInterval(() => {
      const levels = callLevels(liveCallNow(), data);
      const key = `${levels.bot}:${levels.mic}`;
      if (key === last) return;
      last = key;
      send(levels);
    }, LEVEL_MS);
    return () => {
      clearInterval(timer);
      send({ bot: 0, mic: 0 });
    };
  }, [bridge, callOnMascot]);

  const statuses = floated.map(({ bot }) => {
    const session = sessions[bot.id] ?? newFloatingSession();
    const threadId = session.threadId ?? bot.threadId;
    return { bot, session, status: floatingStatus(bot, session, streaming[threadId]) };
  });

  // A reply that settles: remember it, sparkle, hop; an approval opens the balloon.
  const previous = useRef<Record<string, { busy: boolean; waiting: boolean }>>({});
  const previousTask = useRef<Record<string, string>>({});
  const statusKey = statuses
    .map(({ bot, session, status }) => `${bot.id}:${status.busy}:${status.waiting}:${status.streaming}:${status.reply.length}:${floatingTask(bot, session, status)}`)
    .join("|");
  useEffect(() => {
    for (const { bot, session, status } of statuses) {
      const before = previous.current[bot.id];
      previous.current[bot.id] = { busy: status.busy, waiting: status.waiting };
      const task = floatingTask(bot, session, status);
      if (!before) previousTask.current[bot.id] = task;
      if (!status.streaming && status.reply && status.reply !== session.lastReply) patch(bot.id, { lastReply: status.reply });
      if (!before) continue;
      // a finished piece of work makes the mascot happier
      const wasWorking = previousTask.current[bot.id] === "working";
      previousTask.current[bot.id] = task;
      if (wasWorking && task === "idle") cheer(bot.id, "task");
      if (before.busy && !status.busy && session.sendId && status.reply && !status.waiting) {
        patch(bot.id, (current) => ({ sparkle: current.sparkle + 1, celebrate: true }));
        setTimeout(() => patch(bot.id, { celebrate: false }), CELEBRATE_MS);
      }
      if (!before.waiting && status.waiting && session.sendId) patch(bot.id, { open: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKey]);

  const send = useCallback((bot: Bot, text: string) => {
    const threadId = bot.threadId;
    const sendId = crypto.randomUUID();
    patch(bot.id, (current) => ({ open: true, threadId, sendId, asked: text, error: false, lastReply: "", celebrate: false, history: withHistory(current) }));
    dispatch({ type: "send", botId: bot.id, text, threadId, sendId, onError: () => patch(bot.id, { error: true, open: true }) });
  }, [dispatch, patch]);

  // Open a window per floated bot, close the ones taken back (the effect below).
  const opened = useRef(new Map<string, boolean>());
  const sent = useRef(new Map<string, string>());

  /** "Switch bot": the same mascot, in the same spot, now for another of the person's bots. */
  const switchMascot = useCallback((fromId: string, toId: string) => {
    const target = stateRef.current.bots.find((candidate) => candidate.id === toId && !candidate.hidden);
    if (!target || floatingBots().some((entry) => entry.id === toId)) return;
    const move = () => {
      // the window (if any) is already that bot's: it neither closes nor opens
      const top = opened.current.get(fromId);
      opened.current.delete(fromId);
      sent.current.delete(fromId);
      sent.current.delete(toId);
      if (top !== undefined) opened.current.set(toId, top);
      switchFloatingBot(fromId, toId);
    };
    if (bridge?.rekey && opened.current.has(fromId)) void bridge.rekey(fromId, toId).then((ok) => (ok ? move() : switchFloatingBot(fromId, toId)), () => switchFloatingBot(fromId, toId));
    else switchFloatingBot(fromId, toId);
  }, [bridge]);

  /** What the mascot's call controls do: on the app's call (mascot-call.ts). */
  const callDeps = useCallback((botId: string): MascotCallDeps => {
    const live = liveCallNow();
    const setPanel = (change: Partial<MascotCallPanel>) => setCallPanel((current) => ({ ...current, ...change }));
    return {
      available: callableRef.current[botId] === true,
      live,
      current: currentCall,
      start: startCall,
      end: endCall,
      closeBalloon: () => patch(botId, { open: false }),
      voices: () => {
        if (callPanelRef.current.voices) return;
        fetchVoiceModeVoices(botId).then(
          (voices) => setPanel({ voices, voicesError: null }),
          (error: unknown) => setPanel({ voicesError: error instanceof Error ? error.message : String(error) }),
        );
      },
      preview: (voiceId) => {
        if (callPanelRef.current.previewing?.id === voiceId) {
          speaker.stop();
          setPanel({ previewing: null });
          return;
        }
        live?.call.interrupt();
        setPanel({ previewing: { id: voiceId, loading: true } });
        const label = readableOr(callPanelRef.current.voices?.find((voice) => voice.id === voiceId)?.label ?? voiceId, t("ids.customVoice"));
        const unsubscribe = speaker.subscribe((snapshot) => {
          if (snapshot.status === "speaking") setCallPanel((current) => (current.previewing?.id === voiceId ? { ...current, previewing: { id: voiceId, loading: false } } : current));
        });
        void speaker
          .speak(t("voiceMode.previewLine", { voice: label }), { botId, voiceMode: { settings: { ...readVoiceModeSettings(), voice: voiceId } } })
          .finally(() => {
            unsubscribe();
            setCallPanel((current) => (current.previewing?.id === voiceId ? { ...current, previewing: null } : current));
          });
      },
      enroll: () => {
        if (!live) return;
        setPanel({ enrollment: { state: "recording", share: 0 } });
        void live.call.enroll((share) => setPanel({ enrollment: { state: "recording", share } })).then((ok) => {
          setPanel({ enrollment: ok ? { state: "enrolled" } : { state: "failed" } });
          if (ok) writeCallSettings({ onlyMyVoice: true });
          notifyCallSettings();
        });
      },
      forget: () => {
        forgetVoiceprint();
        live?.call.forgetVoice();
        setPanel({ enrollment: { state: "none" } });
        notifyCallSettings();
      },
      writeSettings: (change) => void writeVoiceModeSettings(change),
      writeCallSettings: (change) => void writeCallSettings(change),
    };
  }, [patch]);

  const handle = useCallback((botId: string, event: FloatingEvent) => {
    const bot = stateRef.current.bots.find((candidate) => candidate.id === botId);
    if (!bot) return;
    if (event.type === "call") {
      runMascotCallEvent(botId, event.action, event, callDeps(botId));
      return;
    }
    if (event.type === "tray") {
      // the tray opens where the chat goes: one or the other
      if (event.open) patch(botId, { open: false });
      setTrayFor((current) => (event.open ? botId : current === botId ? null : current));
      return;
    }
    if (event.type === "work") {
      // only what the brain listed for this bot's tray
      const target = trayFor === botId ? trayTargets.current.get(event.id) : undefined;
      if (!target) return;
      if (event.action === "open" && target.threadId) {
        setTrayFor(null);
        openThread(dispatch, { botId: target.botId, threadId: target.threadId }, stateRef.current, showThreadsRef.current);
      } else if (target.kind === "approval" && (event.action === "allow" || event.action === "stop")) {
        dispatch({ type: "decideRequest", threadId: target.threadId, requestId: target.requestId, behavior: event.action === "allow" ? "allow" : "deny", message: event.action === "stop" ? "Denied by the user." : undefined });
        // a refusal: the bot's mascot reacts (a Grump hisses)
        if (event.action === "stop") setCue({ kind: "refusal", at: Date.now(), botId: target.botId });
      } else if (target.kind === "running" && event.action === "stop" && target.canStop && target.threadId) {
        dispatch({ type: "interrupt", botId: target.botId, threadId: target.threadId });
      }
      return;
    }
    const session = sessionsRef.current[botId] ?? newFloatingSession();
    const openInApp = () => openThread(dispatch, { botId, threadId: session.threadId ?? bot.threadId }, stateRef.current, showThreadsRef.current);
    // the chat opening puts this bot's tray away (they share the room above the mascot)
    if ((event.type === "click" && !session.open) || (event.type === "menu" && event.id === "balloon" && !session.open)) setTrayFor((current) => (current === botId ? null : current));
    switch (event.type) {
      case "click":
        patch(botId, { open: !session.open });
        break;
      case "play":
        cheer(botId, "play");
        break;
      case "pet":
        cheer(botId, "pet");
        reportAchievement("mascot.pet");
        break;
      case "dismiss":
        patch(botId, { open: false });
        break;
      case "open":
        openInApp();
        break;
      case "send":
        send(bot, event.text);
        // a word to the mascot between midnight and 1 a.m. (a secret)
        if (new Date().getHours() === 0) reportAchievement("mascot.midnight");
        break;
      case "menu": {
        if (event.id === "call") runMascotCallEvent(botId, currentCall() === botId ? "end" : "start", {}, callDeps(botId));
        else if (event.id === "open") openInApp();
        else if (event.id === "balloon") patch(botId, { open: !session.open });
        else if (event.id === "dock") unfloatBot(botId);
        else if (event.id === "snooze") {
          const hide = () => {
            setNow(Date.now());
            snoozeFloatingBot(botId, Date.now() + SNOOZE_MS);
          };
          // a Shiba lies down and falls asleep first, then goes
          const naps = cueClipFor(completeMascotLook(bot.mascotLook).character, "snooze") !== null && !reducedRef.current;
          if (naps) {
            setCue({ kind: "snooze", at: Date.now(), botId });
            setTimeout(hide, SNOOZE_NAP_MS);
          } else hide();
        } else if (event.id === "settings") dispatch({ type: "toggleAppSettings", open: true, section: "appearance" });
        else if (event.id.startsWith("switch:")) switchMascot(botId, event.id.slice("switch:".length));
        // the balloon's clip and model chip: the app comes forward (main focused it) on this thread, and its own composer does the rest
        else if (event.id === "attach" || event.id === "model") {
          openInApp();
          const name = event.id === "attach" ? COMPOSER_ATTACH_EVENT : COMPOSER_MODEL_EVENT;
          // once the thread's composer is drawn
          setTimeout(() => window.dispatchEvent(new CustomEvent(name, { detail: { botId } })), 120);
        }
        else if (event.id === "fly") setFloatingFlyAway(!floatingBotPrefs().flyAway);
        else if (event.id === "lively") setFloatingLiveliness(nextLiveliness(floatingBotPrefs().liveliness));
        else if (event.id === "top") {
          const entry = floatingBots().find((candidate) => candidate.id === botId);
          const top = !(entry?.top ?? true);
          setFloatingBotOnTop(botId, top);
          void bridge?.setAlwaysOnTop(botId, top).catch(() => undefined);
        }
        break;
      }
      default:
        break;
    }
  }, [bridge, callDeps, cheer, dispatch, patch, send, switchMascot, trayFor]);

  /* ------------------------------------------------- the call hotkey */

  // Main owns the key (electron/mascot-hotkey.mjs): on while the setting is and a mascot is shown,
  // reading holds only when they mean push to talk on this mascot's call
  const shownIds = floated.map(({ bot }) => bot.id);
  const shownRef = useRef(shownIds);
  shownRef.current = shownIds;
  // a key nobody can use is not taken from other apps: only while voice mode serves that mascot's bot
  const keyBot = hotkeyBot(shownIds, onCall);
  const hotkeyWish = hotkeyConfig({ enabled: prefs.hotkey, accelerator: prefs.hotkeyKeys, botId: keyBot && callable[keyBot] === true ? keyBot : null, callBot: onCall, push: callSettings.input === "push" });
  const hotkeyKey = `${hotkeyWish.enabled}:${hotkeyWish.accelerator}:${hotkeyWish.hold}`;
  useEffect(() => {
    if (!bridge?.hotkey) return;
    void bridge.hotkey(hotkeyWish).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, hotkeyKey]);
  useEffect(() => () => void bridge?.hotkey?.({ enabled: false, accelerator: prefs.hotkeyKeys, hold: false }).catch(() => undefined), [bridge]);
  const talking = useRef<string | null>(null);
  useEffect(() => {
    if (!bridge?.onHotkey) return;
    return bridge.onHotkey((value) => {
      const kind = value?.kind as HotkeyKind | undefined;
      if (kind !== "tap" && kind !== "hold" && kind !== "release") return;
      const callBot = currentCall();
      const botId = hotkeyBot(shownRef.current, callBot);
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

  /* ------------------------------------------------------------ desktop */

  const avatarUrls = floated.map(({ bot }) => avatarBase(bot)?.url).filter((url): url is string => Boolean(url));
  const avatarData = useAvatarData(avatarUrls, Boolean(bridge));

  // "Switch bot": the person's bots (not hidden), the ones already on the desktop marked
  const floatingIds = new Set(entries.map((entry) => entry.id));
  const switchable = state.bots.filter((candidate) => !candidate.hidden).map((candidate) => ({ id: candidate.id, name: candidate.name, floating: floatingIds.has(candidate.id) }));
  const snapshots = statuses.map(({ bot, session, status }) => {
    const base = avatarBase(bot);
    const entry = entries.find((candidate) => candidate.id === bot.id);
    const src = base ? (bridge ? avatarData[base.url] : base.url) : undefined;
    const avatar: FloatingAvatar | null = base && src ? { src, crop: base.crop, zoom: base.zoom, focusX: base.focusX, focusY: base.focusY } : null;
    const canCall = callable[bot.id] === true;
    const thisCall = live && live.botId === bot.id && onCall === bot.id ? live : null;
    const item = {
      bot,
      entry,
      snapshot: buildFloatingSnapshot({
        bot,
        session,
        status,
        labels: labelsFor(bot, prefs.liveliness),
        avatar,
        retro,
        reduced,
        locale,
        alwaysOnTop: bridge ? (entry?.top ?? true) : null,
        mood: moodNow(moods[bot.id], clock),
        flyAway: prefs.flyAway,
        liveliness: prefs.liveliness,
        mascot: bot.mascotLook ?? undefined,
        cue: cue && (!cue.botId || cue.botId === bot.id) ? { kind: cue.kind, at: cue.at } : null,
        context: floatingContext(bot.tasks?.find((task) => task.threadId === (session.threadId ?? bot.threadId))?.usage),
        model: { label: composerModelLabel(state.instances, bot.modelSelection), title: t("floatingBots.modelChip") },
        menu: {
          call: thisCall ? "end" : canCall ? "start" : null,
          bots: switchable,
          // only the moves the desktop mascot can play (a behavior clip; Shapes moves play in the popover preview)
          moves: characterMoves(bot.mascotLook ?? undefined).filter((move) => isMoveClip(move.clip)).map((move) => ({ clip: move.clip, label: t(move.label) })),
        },
      }),
    };
    if (theme) item.snapshot.theme = theme;
    // voice calls: the button where voice mode serves this bot, and the call itself when it is this bot's
    if (canCall) item.snapshot.hints = { ...item.snapshot.hints, call: t("floatingBots.call", { name: bot.name }) };
    if (thisCall) {
      item.snapshot.call = mascotCallSnapshot(thisCall, callPanel, voiceSettings, callSettings);
      // the mascot takes the pose of the call's phase (its status chip names it)
      item.snapshot.pose = callPose(thisCall.state.phase, item.snapshot.pose);
    }
    if (trayFor === bot.id && trayData?.botId === bot.id) {
      const built = buildTray({ botId: bot.id, list: trayData.list, approvals: trayData.approvals, loading: trayData.loading, now: Date.now(), title: (tool) => t("floatingBots.tray.needsYou", { tool }) });
      trayTargets.current = built.targets;
      item.snapshot.tray = built.tray;
    } else if (trayFor === bot.id) item.snapshot.tray = { loading: true, items: [] };
    return item;
  });

  const floatedKey = floated.map(({ entry }) => `${entry.id}:${entry.top}`).join("|");
  useEffect(() => {
    if (!bridge) return;
    const wanted = new Map(floated.map(({ entry }) => [entry.id, entry.top] as const));
    for (const [id, top] of wanted) {
      if (opened.current.get(id) === top) continue;
      opened.current.set(id, top);
      void bridge.open(id, top).catch(() => undefined);
    }
    for (const id of opened.current.keys()) {
      if (wanted.has(id)) continue;
      opened.current.delete(id);
      sent.current.delete(id);
      void bridge.close(id).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, floatedKey]);

  // Close them all when the brain goes away (the app page reloads or unmounts this).
  // Forget what was sent too: a window opened again (React mounts twice in
  // development, a hot reload remounts) must be sent its state again.
  useEffect(() => () => {
    if (!bridge) return;
    for (const id of opened.current.keys()) void bridge.close(id).catch(() => undefined);
    opened.current.clear();
    sent.current.clear();
  }, [bridge]);

  // A window that is ready with no state asks for it (main relays): send it again.
  const [, resend] = useState(0);
  useEffect(() => {
    if (!bridge?.onWant) return;
    return bridge.onWant((value) => {
      if (!value || typeof value.botId !== "string") return;
      sent.current.delete(value.botId);
      resend((n) => n + 1);
    });
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    for (const { bot, snapshot } of snapshots) {
      const json = JSON.stringify(snapshot);
      if (sent.current.get(bot.id) === json) continue;
      sent.current.set(bot.id, json);
      bridge.update(bot.id, snapshot);
    }
  });

  useEffect(() => {
    if (!bridge) return;
    const offEvent = bridge.onEvent((value) => {
      if (value && typeof value.botId === "string" && isFloatingEvent(value.event)) handle(value.botId, value.event);
    });
    const offClosed = bridge.onClosed((value) => {
      if (!value || typeof value.botId !== "string") return;
      opened.current.delete(value.botId);
      sent.current.delete(value.botId);
      unfloatBot(value.botId);
    });
    return () => {
      offEvent();
      offClosed();
    };
  }, [bridge, handle]);

  if (bridge) return null;

  /* ------------------------------------------------ browser and phone */

  return (
    <>
      {snapshots.map(({ bot, entry, snapshot }, index) => (
        <FloatingOverlay key={bot.id} botId={bot.id} index={index} saved={entry?.pos} snapshot={snapshot} onEvent={(event) => handle(bot.id, event)} onLevels={onPageLevels} />
      ))}
    </>
  );
}

const STAGE = { width: MASCOT_SIZE.width + 8, height: MASCOT_SIZE.height + 8 };

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** Browser and phone: the bot floats inside the app window, dragged with the pointer. */
function FloatingOverlay({ botId, index, saved, snapshot, onEvent, onLevels }: {
  botId: string;
  index: number;
  saved?: { right: number; bottom: number };
  snapshot: FloatingSnapshot;
  onEvent: (event: FloatingEvent) => void;
  onLevels: (listener: (levels: FloatingCallLevels) => void) => () => void;
}) {
  const [pos, setPos] = useState(() => clampOverlayPosition(saved ?? defaultOverlayPosition(index, STAGE), viewport(), STAGE));
  const [view, setView] = useState(viewport);
  const posRef = useRef(pos);
  posRef.current = pos;

  useEffect(() => {
    const onResize = () => {
      setView(viewport());
      setPos((current) => clampOverlayPosition(current, viewport(), STAGE));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const mover = useMemo<FloatingMover>(() => ({
    coords: "client",
    moveBy: (dx, dy) => setPos((current) => clampOverlayPosition({ right: current.right - dx, bottom: current.bottom - dy }, viewport(), STAGE)),
    moved: () => setFloatingBotPosition(botId, posRef.current),
  }), [botId]);

  // Near the top the balloon folds under the bot; near the left edge it opens to the right.
  const top = view.height - pos.bottom - STAGE.height;
  const left = view.width - pos.right - STAGE.width;
  const below = top < 300;
  const onLeft = left + STAGE.width / 2 < view.width / 2;
  const style: React.CSSProperties = {
    ...(below ? { top } : { bottom: pos.bottom }),
    ...(onLeft ? { left, alignItems: "flex-start" } : { right: pos.right }),
  };
  return (
    <FloatingBotView
      className={onLeft ? "fb-overlay fb-left" : "fb-overlay"}
      style={style}
      below={below}
      snapshot={snapshot}
      onEvent={onEvent}
      mover={mover}
      onLevels={onLevels}
    />
  );
}

export default FloatingBots;
