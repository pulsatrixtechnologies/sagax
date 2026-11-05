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
import { useStore, useStreaming, type Bot } from "@/state/store";
import { activeLocale, t } from "@/lib/i18n";
import { useRetroSkin } from "@/components/RetroChromeHost";
import {
  floatingBotPrefs,
  floatingBots,
  floatingShown,
  nextFloatingReturn,
  switchFloatingBot,
  subscribeFloatingBots,
  unfloatBot,
  type FloatingBotEntry,
} from "@/lib/floating-bots";
import {
  buildFloatingSnapshot,
  floatingStatus,
  floatingTask,
  newFloatingSession,
  withHistory,
  type FloatingSession,
} from "./brain";
import { floatingContext } from "./context";
import { useAppTheme } from "./theme";
import { moodNow, raiseMood, readMoods, writeMoods, type MoodGain, type MoodRecord } from "./mood";
import { isFloatingEvent, type FloatingAvatar, type FloatingEvent } from "./protocol";
import { useVoiceModeAvailable } from "@/lib/voice-mode/api";
import { voiceSettingsForBot } from "@/lib/voice-mode/settings";
import { callPose, mascotCallSnapshot } from "./mascot-call";
import { characterMoves, isMoveClip } from "./moves";
import { composerModelLabel } from "@/components/ModelPicker";
import { avatarBase, desktopBridge, labelsFor, onPageLevels, useAvatarData, useReducedMotion } from "./floating-avatars";
import { handleFloatingEvent } from "./floating-handle";
import { useFloatingCallUi } from "./use-floating-call-ui";
import { useFloatingTray } from "./use-floating-tray";
import { FloatingOverlay } from "./FloatingOverlay";

const CELEBRATE_MS = 1400;

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

  const patch = useCallback((botId: string, change: Partial<FloatingSession> | ((session: FloatingSession) => Partial<FloatingSession>)) => {
    setSessions((current) => {
      const session = current[botId] ?? newFloatingSession();
      const next = typeof change === "function" ? change(session) : change;
      return { ...current, [botId]: { ...session, ...next } };
    });
  }, []);

  // "Hide for 1 hour": a hidden mascot is left out until its time, then comes back by itself
  const [now, setNow] = useState(() => Date.now());
  const comesBack = nextFloatingReturn(entries, now);
  useEffect(() => {
    if (comesBack === null) return;
    const later = setTimeout(() => setNow(Date.now()), Math.max(0, comesBack - Date.now()) + 50);
    return () => clearTimeout(later);
  }, [comesBack]);
  const floatedIds = entries.filter((entry) => floatingShown(entry, now)).map((entry) => entry.id);
  const callable = useVoiceModeAvailable(floatedIds);

  const callUi = useFloatingCallUi({ bridge, patch, prefsHotkey: prefs.hotkey, prefsHotkeyKeys: prefs.hotkeyKeys, callable });
  const { live, onCall, voiceSettings, callSettings, callPanel, callDeps, cue, setCue, callOnMascotRef, shownIdsRef, callableRef } = callUi;

  const floated = entries
    .filter((entry) => floatingShown(entry, now))
    .map((entry) => ({ entry, bot: state.bots.find((candidate) => candidate.id === entry.id) }))
    .filter((item): item is { entry: FloatingBotEntry; bot: Bot } => Boolean(item.bot));

  useEffect(() => {
    if (state.bots.length === 0) return;
    for (const entry of entries) {
      const bot = state.bots.find((candidate) => candidate.id === entry.id);
      if (!bot || bot.hidden) unfloatBot(entry.id);
    }
  }, [entries, state.bots]);

  callableRef.current = callable;
  const callOnMascot = live && floated.some(({ bot }) => bot.id === live.botId) ? live.botId : null;
  callOnMascotRef.current = callOnMascot;
  shownIdsRef.current = floated.map(({ bot }) => bot.id);

  const tray = useFloatingTray(stateRef, state.bots);
  const { trayFor, setTrayFor, trayTargets, applyTray } = tray;

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

  const opened = useRef(new Map<string, boolean>());
  const sent = useRef(new Map<string, string>());

  /** "Switch bot": the same mascot, in the same spot, now for another of the person's bots. */
  const switchMascot = useCallback((fromId: string, toId: string) => {
    const target = stateRef.current.bots.find((candidate) => candidate.id === toId && !candidate.hidden);
    if (!target || floatingBots().some((entry) => entry.id === toId)) return;
    const move = () => {
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

  const handle = useCallback((botId: string, event: FloatingEvent) => {
    handleFloatingEvent(botId, event, {
      stateRef, sessionsRef, showThreadsRef, dispatch, patch, send, cheer, callDeps,
      switchMascot, trayFor, setTrayFor, trayTargets, setCue, setNow, reducedRef, bridge,
    });
  }, [bridge, callDeps, cheer, dispatch, patch, send, switchMascot, trayFor, setTrayFor, trayTargets, setCue]);

  const avatarUrls = floated.map(({ bot }) => avatarBase(bot)?.url).filter((url): url is string => Boolean(url));
  const avatarData = useAvatarData(avatarUrls, Boolean(bridge));

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
          moves: characterMoves(bot.mascotLook ?? undefined).filter((move) => isMoveClip(move.clip)).map((move) => ({ clip: move.clip, label: t(move.label) })),
        },
      }),
    };
    if (theme) item.snapshot.theme = theme;
    if (canCall) item.snapshot.hints = { ...item.snapshot.hints, call: t("floatingBots.call", { name: bot.name }) };
    if (thisCall) {
      item.snapshot.call = mascotCallSnapshot(thisCall, callPanel, voiceSettingsForBot(voiceSettings, bot.id), callSettings);
      item.snapshot.pose = callPose(thisCall.state.phase, item.snapshot.pose);
    }
    item.snapshot = applyTray(bot.id, item.snapshot);
    return item;
  });

  /* ------------------------------------------------------------ desktop */
  const floatedKey = floated.map(({ entry }) => `${entry.id}:${entry.top}`).join("|");
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!bridge?.onShown) return;
    return bridge.onShown(() => {
      opened.current.clear();
      sent.current.clear();
      setShown((n) => n + 1);
    });
  }, [bridge]);
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
  }, [bridge, floatedKey, shown]);

  useEffect(() => () => {
    if (!bridge) return;
    for (const id of opened.current.keys()) void bridge.close(id).catch(() => undefined);
    opened.current.clear();
    sent.current.clear();
  }, [bridge]);

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

  return (
    <>
      {snapshots.map(({ bot, entry, snapshot }, index) => (
        <FloatingOverlay key={bot.id} botId={bot.id} index={index} saved={entry?.pos} snapshot={snapshot} onEvent={(event) => handle(bot.id, event)} onLevels={onPageLevels} />
      ))}
    </>
  );
}

export default FloatingBots;
