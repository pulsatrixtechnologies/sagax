// Which Heavy run's Thoughts panel is open (#4901): the id of the row's
// message, shared by the row that opens it and the host that draws the panel
// in the right-hand slot (src/components/ThoughtsPanel.tsx). One at a time.
import { useSyncExternalStore } from "react";

let openId: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function openThoughts(messageId: string): void {
  if (openId === messageId) return;
  openId = messageId;
  emit();
}

export function closeThoughts(): void {
  if (openId === null) return;
  openId = null;
  emit();
}

export function toggleThoughts(messageId: string): void {
  if (openId === messageId) closeThoughts();
  else openThoughts(messageId);
}

export function useOpenThoughts(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    () => openId,
    () => null,
  );
}
