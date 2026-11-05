// Event handler for one floating mascot: menu, tray, call, send, snooze and
// the rest of FloatingEvent, kept out of FloatingBots so that component stays thin.
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { reportAchievement } from "@/lib/achievements";
import { COMPOSER_ATTACH_EVENT } from "@/components/Composer";
import { COMPOSER_MODEL_EVENT } from "@/components/ModelPicker";
import {
  floatingBotPrefs,
  floatingBots,
  nextLiveliness,
  SNOOZE_MS,
  snoozeFloatingBot,
  setFloatingBotOnTop,
  setFloatingFlyAway,
  setFloatingLiveliness,
  unfloatBot,
} from "@/lib/floating-bots";
import { openThread, type Action, type AppState, type Bot } from "@/state/store";
import { completeMascotLook } from "../../../shared/mascot-look";
import { currentCall } from "@/lib/call";
import type { FloatingBotsBridge, FloatingCue, FloatingEvent } from "./protocol";
import { newFloatingSession, type FloatingSession } from "./brain";
import { runMascotCallEvent, type MascotCallDeps } from "./mascot-call";
import type { TrayTarget } from "./tray";
import { cueClipFor, SNOOZE_NAP_MS } from "./mascots";
import type { MoodGain } from "./mood";

export interface FloatingHandleDeps {
  stateRef: MutableRefObject<AppState>;
  sessionsRef: MutableRefObject<Record<string, FloatingSession>>;
  showThreadsRef: MutableRefObject<boolean>;
  dispatch: Dispatch<Action>;
  patch: (botId: string, change: Partial<FloatingSession> | ((session: FloatingSession) => Partial<FloatingSession>)) => void;
  send: (bot: Bot, text: string) => void;
  cheer: (botId: string, gain: MoodGain) => void;
  callDeps: (botId: string) => MascotCallDeps;
  switchMascot: (fromId: string, toId: string) => void;
  trayFor: string | null;
  setTrayFor: Dispatch<SetStateAction<string | null>>;
  trayTargets: MutableRefObject<Map<string, TrayTarget>>;
  setCue: Dispatch<SetStateAction<(FloatingCue & { botId?: string }) | null>>;
  setNow: Dispatch<SetStateAction<number>>;
  reducedRef: MutableRefObject<boolean>;
  bridge: FloatingBotsBridge | null;
}

export function handleFloatingEvent(botId: string, event: FloatingEvent, deps: FloatingHandleDeps): void {
  const {
    stateRef, sessionsRef, showThreadsRef, dispatch, patch, send, cheer, callDeps,
    switchMascot, trayFor, setTrayFor, trayTargets, setCue, setNow, reducedRef, bridge,
  } = deps;
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
}
