// The unlock toast: our own console-style pill (a trophy badge that pops in
// its rarity's color, "Achievement unlocked", the name, "+20", and what it
// unlocked with a small preview), sliding in at the top of the window. One at
// a time from the queue (src/lib/achievement-toasts.ts), never while the
// person types, still under reduced motion, with a short chime only when
// notification sounds are on. With the app in the background (and the
// setting on) the OS shows a notification instead.
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Trophy, X } from "lucide-react";
import { ACHIEVEMENTS } from "../../../shared/achievements-catalog";
import { rarityForPoints } from "../../../shared/achievements";
import { achievementToasts, TOAST_SHOW_MS } from "@/lib/achievement-toasts";
import { achievementsState, displayReward, flushAchievementEvents, loadAchievements, localized, reportAchievement, saveAchievementSettings } from "@/lib/achievements";
import { grokAccountLinked, setGrokAccountLinked } from "@/lib/grok-account";
import { useMyEngines } from "@/lib/perspicax-org";
import { readRetroUnlocked } from "@/lib/retro98";
import { useStore } from "@/state/store";
import { notificationSoundsEnabled } from "@/lib/notification-preferences";
import { t } from "@/lib/i18n";
import { achievementIcon } from "./icons";
import "./achievements.css";
import { webAudioAllowed } from "@/lib/audio-gate";

const RewardPreview = lazy(() => import("./RewardPreview"));

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/** A short rising chime (three soft notes), made on the spot: no audio file to ship. */
export function playUnlockChime(): void {
  try {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass || !webAudioAllowed()) return;
    const context = new AudioContextClass();
    const start = context.currentTime + 0.02;
    [659.25, 987.77, 1318.51].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const at = start + index * 0.09;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.06, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.5);
    });
    setTimeout(() => void context.close().catch(() => undefined), 1_200);
  } catch {
    /* no audio here: the toast still shows */
  }
}

function inBackground(): boolean {
  return typeof document !== "undefined" && (document.hidden || !document.hasFocus());
}

function nativeNotification(id: string): boolean {
  const item = ACHIEVEMENTS.find((candidate) => candidate.id === id);
  const settings = achievementsState().snapshot?.settings;
  if (!item || !settings?.native || typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  const reward = item.rewards[0];
  const line = reward ? displayReward(reward, achievementsState().unlocks, { revealing: true }) : null;
  try {
    new Notification(t("achievements.toast.title", { points: item.points }), {
      body: [localized(item.name), line ?? ""].filter(Boolean).join("\n"),
      tag: `sagax-achievement:${id}`,
      ...(notificationSoundsEnabled() ? {} : { silent: true }),
    });
    return true;
  } catch {
    return false;
  }
}

export function AchievementToast({ id, leaving, onDismiss }: { id: string; leaving: boolean; onDismiss: () => void }) {
  const item = ACHIEVEMENTS.find((candidate) => candidate.id === id);
  if (!item) return null;
  const tier = rarityForPoints(item.points);
  const Icon = achievementIcon(item.icon);
  const reward = item.rewards[0];
  const line = reward ? displayReward(reward, achievementsState().unlocks, { revealing: true }) : null;
  return (
    <div className="achievement-toast" data-tier={tier} data-leaving={leaving ? "" : undefined} data-achievement-toast={id} role="status" aria-live="polite">
      <span className="achievement-toast-badge" aria-hidden="true">
        <Icon size={20} strokeWidth={2.2} />
      </span>
      <span className="achievement-toast-text">
        <span className="achievement-toast-kicker">
          <Trophy size={11} aria-hidden="true" />
          {t("achievements.toast.kicker")}
          <span className="achievement-toast-points">+{item.points}</span>
        </span>
        <span className="achievement-toast-name">{localized(item.name)}</span>
        {line && <span className="achievement-toast-reward">{line}</span>}
      </span>
      {line && reward && (reward.kind === "skin" || reward.kind === "character") && (
        <span className="achievement-toast-preview" aria-hidden="true">
          <Suspense fallback={null}>
            <RewardPreview reward={reward} size={34} />
          </Suspense>
        </span>
      )}
      <button type="button" className="achievement-toast-close" aria-label={t("achievements.toast.dismiss")} onClick={onDismiss}>
        <X size={12} />
      </button>
    </div>
  );
}

/**
 * Once per person signed in here: read their trophies, count the day, keep
 * their time zone for streaks, and credit Trombi to whoever already found
 * its command before achievements existed.
 */
function useAchievementsBoot(person: string): void {
  useEffect(() => {
    let live = true;
    void loadAchievements().then(() => {
      if (!live) return;
      const snapshot = achievementsState().snapshot;
      if (!snapshot) return;
      const offset = -new Date().getTimezoneOffset();
      if (snapshot.settings.tzOffset !== offset) void saveAchievementSettings({ tzOffset: offset });
      reportAchievement("app.opened");
      if (readRetroUnlocked() && !snapshot.rewards.includes("character:trombi")) reportAchievement("trombi.summoned");
      void flushAchievementEvents();
    });
    return () => {
      live = false;
    };
  }, [person]);
}

export function AchievementToaster() {
  const { state } = useStore();
  const engines = useMyEngines();
  const person = state.config?.viewer?.principalId ?? state.config?.profile?.email ?? "";
  useAchievementsBoot(person);
  const grokLinked = grokAccountLinked({
    xaiConfigured: state.config?.xai?.configured === true,
    instances: state.instances,
    engines,
  });
  useEffect(() => {
    setGrokAccountLinked(grokLinked);
    if (!grokLinked || achievementsState().status === "unavailable") return;
    if (achievementsState().snapshot?.rewards.includes("character:shape")) return;
    reportAchievement("grok.linked");
  }, [grokLinked, person]);
  const queue = useSyncExternalStore(achievementToasts.subscribe.bind(achievementToasts), () => achievementToasts.snapshot());
  const lastTyped = useRef(0);
  const [leaving, setLeaving] = useState(false);

  // the keyboard's last keystroke in a field: a toast waits for quiet
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isEditable(event.target)) lastTyped.current = Date.now();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // advance when ready; poll gently while a toast waits on typing
  useEffect(() => {
    if (queue.current !== null || queue.queue.length === 0) return;
    const tryNext = () => {
      if (!achievementToasts.ready(Date.now(), lastTyped.current)) return false;
      const next = achievementToasts.advance();
      if (next && inBackground() && nativeNotification(next)) {
        // the OS showed it; the in-app pill still greets the person on return
      } else if (next && notificationSoundsEnabled()) {
        playUnlockChime();
      }
      return true;
    };
    if (tryNext()) return;
    const timer = setInterval(() => {
      if (tryNext()) clearInterval(timer);
    }, 400);
    return () => clearInterval(timer);
  }, [queue]);

  // each toast stays a few seconds, then slides out
  useEffect(() => {
    if (queue.current === null) return;
    setLeaving(false);
    const out = setTimeout(() => setLeaving(true), TOAST_SHOW_MS);
    const gone = setTimeout(() => achievementToasts.dismiss(), TOAST_SHOW_MS + 320);
    return () => {
      clearTimeout(out);
      clearTimeout(gone);
    };
  }, [queue.current]);

  if (queue.current === null) return null;
  return (
    <div className="achievement-toaster" data-achievement-toaster="">
      <AchievementToast key={queue.current} id={queue.current} leaving={leaving} onDismiss={() => achievementToasts.dismiss()} />
    </div>
  );
}
