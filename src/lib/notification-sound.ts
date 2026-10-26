// The sound a notification plays (Settings > Notifications > Notification
// sound, parity 2E). "system" leaves the platform's own alert sound to the
// notification; the others are short tones drawn here with Web Audio (no
// audio file), played by the page while the notification itself is sent
// silent. Same on-by-default switch as before: muting sounds mutes these.
import { localChoice } from "./local-choice";

export const NOTIFICATION_SOUND_CHOICES = ["system", "tick", "double-tick", "chime-a", "chime-b", "blip"] as const;
export type NotificationSound = (typeof NOTIFICATION_SOUND_CHOICES)[number];

export const notificationSoundChoice = localChoice<NotificationSound>("sagax.notificationSound.v1", NOTIFICATION_SOUND_CHOICES, "system");

/** [frequency Hz, start s, length s, peak gain] per note. */
type Note = readonly [number, number, number, number];

export const NOTIFICATION_TONES: Record<Exclude<NotificationSound, "system">, readonly Note[]> = {
  tick: [[1900, 0, 0.04, 0.25]],
  "double-tick": [[1900, 0, 0.04, 0.25], [1900, 0.11, 0.04, 0.25]],
  "chime-a": [[880, 0, 0.45, 0.22], [1318.5, 0.14, 0.6, 0.18]],
  "chime-b": [[659.25, 0, 0.45, 0.22], [987.77, 0.14, 0.45, 0.18], [1318.5, 0.28, 0.7, 0.14]],
  blip: [[520, 0, 0.12, 0.22], [780, 0.06, 0.14, 0.2]],
};

let context: AudioContext | null = null;

/** Play a tone once. Never throws; a refusal (no audio device, a plain
 * browser's autoplay policy) returns false. "system" plays nothing here. */
export function playNotificationSound(choice: NotificationSound = notificationSoundChoice.get()): boolean {
  if (choice === "system") return false;
  try {
    const Ctor: typeof AudioContext | undefined = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    context ??= new Ctor();
    const audio = context;
    if (audio.state === "suspended") void audio.resume().catch(() => {});
    const start = audio.currentTime + 0.01;
    for (const [frequency, at, length, peak] of NOTIFICATION_TONES[choice]) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + at);
      gain.gain.exponentialRampToValueAtTime(peak, start + at + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + length);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(start + at);
      oscillator.stop(start + at + length + 0.02);
    }
    return true;
  } catch {
    return false;
  }
}

/** True once the page may play a tone (a plain browser keeps its audio
 * suspended until the person has clicked). Before that, the notification
 * keeps the system sound rather than going silent. */
export function toneReady(): boolean {
  return context?.state === "running";
}

/** What a notification does about its sound: the platform sound (`system`),
 * or silence from the notification and a tone played here. */
export function notificationSoundPlan(soundsOn: boolean, choice: NotificationSound = notificationSoundChoice.get()): { platformSound: boolean; tone: NotificationSound | null } {
  if (!soundsOn) return { platformSound: false, tone: null };
  return choice === "system" ? { platformSound: true, tone: null } : { platformSound: false, tone: choice };
}
