// A pointer elsewhere in the app (a claude.ai card's "Reconnect the account")
// asks Settings > Providers to open one provider row. The request waits here
// until the page mounts and takes it, so it works whether the page was open.
import { useSyncExternalStore } from "react";

export type ProviderRowRequest = "claude";

let pending: ProviderRowRequest | null = null;
const listeners = new Set<() => void>();

export function requestProviderRow(kind: ProviderRowRequest): void {
  pending = kind;
  for (const listener of listeners) listener();
}

/** The waiting request, if any; `takeProviderRow` clears it once honoured. */
export function useProviderRowRequest(): ProviderRowRequest | null {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => pending,
    () => null,
  );
}

export function takeProviderRow(): void {
  if (pending === null) return;
  pending = null;
  for (const listener of listeners) listener();
}
