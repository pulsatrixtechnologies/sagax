// Which remote session is in focus (the one the shell opens on). The server
// keeps the same choice; this store updates the screen before the next poll.
import { useSyncExternalStore } from "react";

let focused: { botId: string; id: string } | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function focusRemoteSessionLocal(botId: string, id: string) {
  focused = { botId, id };
  emit();
}

export function clearRemoteSessionLocal(botId: string, id: string) {
  if (focused?.botId === botId && focused.id === id) {
    focused = null;
    emit();
  }
}

export function useFocusedRemoteSession(botId: string): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (focused?.botId === botId ? focused.id : null),
    () => null,
  );
}
