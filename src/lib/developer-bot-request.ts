// #2658 (lot 2 of Settings > Developer): the bot page's discreet "Advanced
// options are in Developer" link asks the Developer page to show that bot's
// technical cards. The request waits here until the page mounts and takes
// it, so it works whether Settings was open or not (provider-row-request
// does the same for Settings > Providers).
import { useSyncExternalStore } from "react";

let pending: string | null = null;
const listeners = new Set<() => void>();

export function requestDeveloperBot(botId: string): void {
  pending = botId;
  for (const listener of listeners) listener();
}

/** The waiting request, if any; `takeDeveloperBot` clears it once honoured. */
export function useDeveloperBotRequest(): string | null {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => pending,
    () => null,
  );
}

export function takeDeveloperBot(): void {
  if (pending === null) return;
  pending = null;
  for (const listener of listeners) listener();
}
