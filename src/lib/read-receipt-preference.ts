import { useSyncExternalStore } from "react";

// Settings > Privacy > "Send read receipts" (server/messages/read-receipts.ts). On by
// default. Off hides this person's read position in conversations between
// people, and hides the other person's from them (like iMessage). Rooms and
// bots always show. One of USER_PREFERENCE_KEYS: on an organization server
// it follows the person to the server, which applies it.
export const READ_RECEIPTS_KEY = "sagax.readReceipts.v1";

const listeners = new Set<() => void>();
let sessionChoice: boolean | undefined;

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readSendReadReceipts(): boolean {
  if (sessionChoice !== undefined) return sessionChoice;
  try {
    return storage()?.getItem(READ_RECEIPTS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSendReadReceipts(on: boolean): void {
  sessionChoice = on;
  try {
    const store = storage();
    if (on) store?.removeItem(READ_RECEIPTS_KEY);
    else store?.setItem(READ_RECEIPTS_KEY, "off");
  } catch {
    /* storage refused: this session keeps the choice */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== READ_RECEIPTS_KEY) return;
    sessionChoice = undefined;
    listener();
  };
  globalThis.addEventListener?.("storage", onStorage);
  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener?.("storage", onStorage);
  };
}

export function useSendReadReceipts(): boolean {
  return useSyncExternalStore(subscribe, readSendReadReceipts, () => true);
}
