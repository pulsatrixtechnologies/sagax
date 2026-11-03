// Priority wake for a one-way send (send_to_bot) and an agent prompt
// (send_prompt). "now" wakes an idle recipient at once, or moves the message
// to the front of its queue. It never interrupts a turn that is already
// running. At most 10 now-sends per sender per hour; past that the send is
// delivered as normal. The window is memory only and is forgotten on restart.

export const PRIORITY_NOW_PER_HOUR = 10;
const HOUR_MS = 3_600_000;

export type WakePriority = "now" | "normal";
export type ParsedWakePriority = WakePriority | "absent" | "invalid";

export function parseWakePriority(value: unknown): ParsedWakePriority {
  if (value === undefined || value === null || value === "") return "absent";
  if (value === "now" || value === "normal") return value;
  return "invalid";
}

/** The cap is per sending bot, and per person when a person sends. */
export function wakeSenderId(caller: { kind: "bot" | "person"; id: string }): string {
  return caller.kind === "bot" ? caller.id : `person:${caller.id}`;
}

const stamps = new Map<string, number[]>();

/** True when this now-send is inside the hour's cap. A refusal does not
 * consume a slot. */
export function admitPriorityNow(senderId: string, now: number): boolean {
  const kept = (stamps.get(senderId) ?? []).filter((at) => now - at < HOUR_MS);
  if (kept.length >= PRIORITY_NOW_PER_HOUR) {
    stamps.set(senderId, kept);
    return false;
  }
  kept.push(now);
  stamps.set(senderId, kept);
  return true;
}

/** Give a slot back when a now-send was admitted and then refused. */
export function releasePriorityNow(senderId: string): void {
  const list = stamps.get(senderId);
  if (!list?.length) return;
  list.pop();
  if (list.length === 0) stamps.delete(senderId);
  else stamps.set(senderId, list);
}

export function resetPriorityWakeForTests(): void {
  stamps.clear();
}

export const PRIORITY_DOWNGRADED_NOTE =
  "Priority now was past this sender's 10 per hour, so this send is normal.";

/** How a started or queued prompt should be placed. front moves it ahead of
 * what is already waiting; priorityNow alone still starts when a slot is free. */
export interface PriorityDelivery {
  front?: boolean;
  priorityNow?: boolean;
}

export interface PriorityPlan {
  reported: WakePriority | null;
  downgraded: boolean;
  wakeNow: boolean;
  queueFront: boolean;
  note: string | null;
}

export function planPriorityWake(input: {
  asked: ParsedWakePriority;
  /** False for a send this flag does not apply to (a thread on yourself). */
  applies: boolean;
  slotFree: boolean;
  needsApproval: boolean;
  senderId: string;
  now: number;
}): PriorityPlan {
  const none: PriorityPlan = { reported: null, downgraded: false, wakeNow: false, queueFront: false, note: null };
  switch (input.asked) {
    case "absent":
    case "invalid":
      return none;
    case "normal":
      return { ...none, reported: "normal" };
    case "now": {
      if (!input.applies) return none;
      // A card still has to be answered. Stay queued, and do not spend a slot.
      if (input.needsApproval) return { ...none, reported: "normal" };
      if (!admitPriorityNow(input.senderId, input.now)) {
        return { reported: "normal", downgraded: true, wakeNow: false, queueFront: false, note: PRIORITY_DOWNGRADED_NOTE };
      }
      if (input.slotFree) {
        return { reported: "now", downgraded: false, wakeNow: true, queueFront: false, note: null };
      }
      return { reported: "now", downgraded: false, wakeNow: false, queueFront: true, note: null };
    }
    default: {
      const _never: never = input.asked;
      throw new Error(`unexpected priority ${String(_never)}`);
    }
  }
}
